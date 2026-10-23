//! One in-memory owner for interactive submissions. Never waits on a platform or network.
use super::request_control::RequestControl;
use crate::domain::{
    account::{valid_id, Account},
    broadcast::GuestBinding,
    error::{AppError, Result},
    send_intent::{OutgoingSend, SendContext, SendOutcome, SendState, SendStatus},
};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, time::Duration};
use uuid::Uuid;

pub const MAX_SEND_RECORDS: usize = 20_000;
pub const MAX_SEND_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_OUTPUT: usize = 32_768;

#[derive(Clone)]
pub struct SendTicket {
    pub account: Account,
    pub binding: GuestBinding,
    pub request: OutgoingSend,
    pub session_generation: Option<String>,
    pub translate: bool,
    pub control: RequestControl,
    pub output: Option<String>,
    nonce: String,
}

pub enum Admission {
    Start(Box<SendTicket>),
    Status(SendStatus),
}

struct Record {
    fingerprint: [u8; 32],
    composer_revision: u64,
    account_id: String,
    nonce: String,
    status: SendStatus,
    control: RequestControl,
    output: Option<String>,
    reserved: usize,
}

pub struct SendIntents {
    records: HashMap<String, Record>,
    max_records: usize,
    max_output_bytes: usize,
    timeout: Duration,
}

impl Default for SendIntents {
    fn default() -> Self {
        Self::new()
    }
}

impl SendIntents {
    pub fn new() -> Self {
        Self {
            records: HashMap::new(),
            max_records: MAX_SEND_RECORDS,
            max_output_bytes: MAX_SEND_OUTPUT_BYTES,
            timeout: Duration::from_secs(50),
        }
    }

    #[cfg(test)]
    pub fn with_limits(records: usize, bytes: usize, timeout: Duration) -> Self {
        Self {
            max_records: records,
            max_output_bytes: bytes,
            timeout,
            ..Self::new()
        }
    }

    pub fn admit(
        &mut self,
        account: Account,
        binding: GuestBinding,
        session_generation: Option<String>,
        request: OutgoingSend,
    ) -> Result<Admission> {
        request.validate_for_platform(&account.platform_id)?;
        if account.archived
            || !valid_id(&account.id)
            || binding.account_id != account.id
            || binding.platform_id != account.platform_id
            || !valid_id(&binding.generation)
            || session_generation
                .as_deref()
                .is_some_and(|id| !valid_id(id))
        {
            return Err(AppError::SendIntentInvalid);
        }
        let policy = account.translation.policy(&request.chat_id);
        policy.validate()?;
        account.proxy.validate()?;
        if request.policy_revision != account.translation.revision {
            return Err(AppError::TranslationSettingsConflict);
        }
        let translate = policy.should_translate_outgoing(&request.text);
        if translate && session_generation.is_none() {
            return Err(AppError::SessionRequired);
        }
        let fingerprint = fingerprint(&account, &binding, session_generation.as_deref(), &request)?;
        self.expire();
        let output = if let Some(record) = self.records.get(&request.id) {
            if record.fingerprint != fingerprint {
                return Err(AppError::SendIntentConflict);
            }
            if request.attempt == record.status.attempt {
                if request.composer_revision != record.composer_revision {
                    return Err(AppError::SendIntentConflict);
                }
                return Ok(Admission::Status(record.status.clone()));
            }
            // Polling need not observe attempts cancelled entirely inside the
            // guest. Only a newer explicit attempt may replace retryable work.
            if request.attempt <= record.status.attempt
                || request.composer_revision < record.composer_revision
            {
                return Err(AppError::SendIntentConflict);
            }
            if !record.status.retryable {
                return Ok(Admission::Status(record.status.clone()));
            }
            record.output.clone()
        } else {
            // Local guest cancellation can advance attempts before the first
            // native poll. Retained tombstones make an unknown ID authoritative
            // evidence that this owner has never admitted or submitted it.
            if self.records.len() >= self.max_records {
                return Err(AppError::SendIntentLimit);
            }
            (!translate).then(|| request.text.clone())
        };
        if self.records.iter().any(|(id, record)| {
            id != &request.id && record.account_id == account.id && record.status.state.active()
        }) {
            return Err(AppError::SendIntentBusy);
        }
        let reserved = if output.is_none() { MAX_OUTPUT } else { 0 };
        let other_bytes = self
            .records
            .iter()
            .filter(|(id, _)| *id != &request.id)
            .map(|(_, record)| record.reserved + record.output.as_ref().map_or(0, String::len))
            .sum::<usize>();
        if other_bytes + reserved + output.as_ref().map_or(0, String::len) > self.max_output_bytes {
            return Err(AppError::SendIntentLimit);
        }
        let control = RequestControl::new(self.timeout);
        let nonce = Uuid::new_v4().to_string();
        let status = SendStatus {
            id: request.id.clone(),
            attempt: request.attempt,
            state: if output.is_some() {
                SendState::Ready
            } else {
                SendState::Transforming
            },
            issue: None,
            retryable: false,
            receipt: None,
            draft_cleared: None,
        };
        // A retry revokes the previous attempt before publishing its replacement.
        if let Some(old) = self.records.get(&request.id) {
            old.control.cancel();
        }
        self.records.insert(
            request.id.clone(),
            Record {
                fingerprint,
                composer_revision: request.composer_revision,
                account_id: account.id.clone(),
                nonce: nonce.clone(),
                status,
                control: control.clone(),
                output: output.clone(),
                reserved,
            },
        );
        Ok(Admission::Start(Box::new(SendTicket {
            account,
            binding,
            request,
            session_generation,
            translate,
            control,
            output,
            nonce,
        })))
    }

    pub fn status(&self, id: &str) -> Option<SendStatus> {
        self.records.get(id).map(|record| record.status.clone())
    }

    /// Keep a paid transform before checking its deadline. A late result can be
    /// recovered by an explicit next attempt, but cannot authorize this attempt.
    pub fn remember_output(&mut self, ticket: &SendTicket, output: String) -> Result<SendStatus> {
        let other_bytes = self
            .records
            .iter()
            .filter(|(id, _)| *id != &ticket.request.id)
            .map(|(_, record)| record.reserved + record.output.as_ref().map_or(0, String::len))
            .sum::<usize>();
        let capacity = self.max_output_bytes.saturating_sub(other_bytes);
        let record = self.record(ticket)?;
        if matches!(
            record.status.state,
            SendState::Committing | SendState::Confirmed | SendState::Uncertain
        ) {
            return Err(AppError::SendIntentState);
        }
        if ticket
            .request
            .validate_output(&ticket.account.platform_id, &output)
            .is_err()
        {
            fail_record(record, AppError::TranslationOutputInvalid);
            return Err(AppError::TranslationOutputInvalid);
        }
        if let Some(previous) = &record.output {
            if previous != &output {
                return Err(AppError::SendIntentConflict);
            }
        } else {
            // Cancellation can precede an already-paid response. Recover that
            // result using the actual bounded budget, even after its reservation
            // was released. Never attach an old attempt's output to a new nonce.
            if capacity < output.len() {
                return Err(AppError::SendIntentLimit);
            }
            record.output = Some(output);
            record.reserved = 0;
        }
        if matches!(
            record.status.state,
            SendState::Failed | SendState::Cancelled
        ) {
            return Ok(record.status.clone());
        }
        ensure_live(record, ticket)?;
        record.status.state = SendState::Ready;
        Ok(record.status.clone())
    }

    pub fn begin_commit(&mut self, ticket: &SendTicket) -> Result<bool> {
        let record = self.record(ticket)?;
        if matches!(
            record.status.state,
            SendState::Committing | SendState::Confirmed | SendState::Uncertain
        ) {
            return Ok(false);
        }
        ensure_live(record, ticket)?;
        if record.status.state != SendState::Ready || record.output.is_none() {
            return Err(AppError::SendIntentState);
        }
        record.status.state = SendState::Committing;
        Ok(true)
    }

    pub fn fail(&mut self, ticket: &SendTicket, issue: AppError) -> Result<SendStatus> {
        let record = self.record(ticket)?;
        fail_record(record, issue);
        Ok(record.status.clone())
    }

    pub fn settle(&mut self, ticket: &SendTicket, outcome: SendOutcome) -> Result<SendStatus> {
        let record = self.record(ticket)?;
        if matches!(
            record.status.state,
            SendState::Confirmed | SendState::Uncertain
        ) {
            return Ok(record.status.clone());
        }
        if record.status.state != SendState::Committing {
            return Err(AppError::SendIntentState);
        }
        match outcome {
            SendOutcome::Confirmed {
                receipt,
                draft_cleared,
            } => {
                if receipt.trim().is_empty()
                    || receipt == "submitted"
                    || receipt.len() > 500
                    || receipt.chars().any(char::is_control)
                {
                    fail_record(record, AppError::SendIntentReceiptMissing);
                } else {
                    record.status.state = SendState::Confirmed;
                    record.status.issue = None;
                    record.status.receipt = Some(receipt);
                    // Reply cleanup has no reviewed atomic platform contract yet.
                    record.status.draft_cleared = Some(
                        draft_cleared && matches!(&ticket.request.context, SendContext::Plain {}),
                    );
                }
            }
            SendOutcome::NotSubmitted { issue } => {
                // Only an explicit guest result can reopen a dispatched attempt.
                record.status.state = SendState::Failed;
                record.status.issue = Some(issue);
                record.status.retryable = retryable(issue);
            }
            SendOutcome::Uncertain { issue } => fail_record(record, issue),
        }
        record.control.cancel();
        record.reserved = 0;
        if !record.status.retryable {
            record.output = None;
        }
        Ok(record.status.clone())
    }

    pub fn cancel_all(&mut self, issue: AppError) {
        for record in self.records.values_mut() {
            fail_record(record, issue);
        }
    }

    fn expire(&mut self) {
        for record in self
            .records
            .values_mut()
            .filter(|record| record.status.state.active())
        {
            if let Err(issue) = record.control.check() {
                fail_record(record, issue);
            }
        }
    }

    fn record(&mut self, ticket: &SendTicket) -> Result<&mut Record> {
        let record = self
            .records
            .get_mut(&ticket.request.id)
            .ok_or(AppError::SendIntentState)?;
        if record.nonce != ticket.nonce
            || record.status.attempt != ticket.request.attempt
            || record.composer_revision != ticket.request.composer_revision
            || record.fingerprint
                != fingerprint(
                    &ticket.account,
                    &ticket.binding,
                    ticket.session_generation.as_deref(),
                    &ticket.request,
                )?
        {
            return Err(AppError::SendIntentConflict);
        }
        Ok(record)
    }
}

fn ensure_live(record: &mut Record, ticket: &SendTicket) -> Result<()> {
    if let Err(issue) = record.control.check().and_then(|()| ticket.control.check()) {
        fail_record(record, issue);
        return Err(issue);
    }
    Ok(())
}

fn retryable(issue: AppError) -> bool {
    !matches!(
        issue,
        AppError::TranslationOutputInvalid
            | AppError::TranslationResultUnavailable
            | AppError::SendIntentConflict
    )
}

fn fail_record(record: &mut Record, issue: AppError) {
    if !record.status.state.active() {
        return;
    }
    let committed = record.status.state == SendState::Committing;
    record.status.state = if committed {
        SendState::Uncertain
    } else if matches!(
        issue,
        AppError::TranslationCancelled | AppError::SendIntentChanged | AppError::SessionChanged
    ) {
        SendState::Cancelled
    } else {
        SendState::Failed
    };
    record.status.issue = Some(issue);
    record.status.retryable = !committed && retryable(issue);
    record.control.cancel();
    record.reserved = 0;
    if !record.status.retryable {
        record.output = None;
    }
}

fn fingerprint(
    account: &Account,
    binding: &GuestBinding,
    session: Option<&str>,
    request: &OutgoingSend,
) -> Result<[u8; 32]> {
    let policy = account.translation.policy(&request.chat_id);
    let translate = policy.should_translate_outgoing(&request.text);
    let proxy = serde_json::to_string(&account.proxy).map_err(|_| AppError::SendIntentInvalid)?;
    let context =
        serde_json::to_string(&request.context).map_err(|_| AppError::SendIntentInvalid)?;
    let mut digest = Sha256::new();
    let parts: &[&str] = &[
        &account.id,
        &binding.account_id,
        &binding.platform_id,
        &binding.generation,
        session.unwrap_or_default(),
        &request.chat_id,
        &request.text,
        &context,
        &proxy,
        if translate { "translation" } else { "identity" },
        if translate { &policy.source } else { "" },
        if translate { &policy.target } else { "" },
        if translate { &policy.provider } else { "" },
        if translate { &policy.route } else { "" },
    ];
    for part in parts {
        digest.update((part.len() as u64).to_le_bytes());
        digest.update(part.as_bytes());
    }
    Ok(digest.finalize().into())
}
