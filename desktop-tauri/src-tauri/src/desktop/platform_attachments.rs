//! Attachment transport within the existing target checkpoint and commit permit.
//! One selected file is streamed to one fixed guest; no filesystem API reaches JS.
use super::platform_bridge::NativePlatform;
use crate::{
    application::{broadcast::DispatchControl, ports::BroadcastAttachmentIo},
    domain::{
        broadcast::{BroadcastIssue, DispatchOutcome, DispatchRequest, GuestBinding},
        error::AppError,
    },
    infrastructure::broadcast_attachment_source::NativeAttachmentIo,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const BUNDLE_BUDGET: Duration = Duration::from_secs(20 * 60);
const FILE_BUDGET: Duration = Duration::from_secs(5 * 60);

fn issue(error: AppError) -> BroadcastIssue {
    match error {
        AppError::BroadcastAttachmentChanged => BroadcastIssue::AttachmentChanged,
        AppError::BroadcastAttachmentUnavailable | AppError::BroadcastAttachmentInvalid => {
            BroadcastIssue::AttachmentUnavailable
        }
        _ => BroadcastIssue::RuntimeFailed,
    }
}

fn failure(control: &DispatchControl, code: BroadcastIssue) -> DispatchOutcome {
    if control.committed() {
        DispatchOutcome::Uncertain { code }
    } else {
        DispatchOutcome::NotSubmitted { code }
    }
}

impl NativePlatform {
    fn attachment_transfer(
        &self,
        binding: &GuestBinding,
        attempt_id: &str,
        payload: Value,
    ) -> std::result::Result<(), BroadcastIssue> {
        let generation = serde_json::to_string(&binding.generation)
            .map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let attempt =
            serde_json::to_string(attempt_id).map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let result = self.evaluate(
            binding,
            format!(
            "window.__geekTauriPlatform?.attachment({generation}, {attempt}, {payload}) === true"
        ),
        )?;
        if result != Value::Bool(true) {
            // A previous vendor upload may still own the guest's file slot.
            // Pause before commit; this is not evidence that the source changed.
            return Err(BroadcastIssue::AccountUnavailable);
        }
        Ok(())
    }

    pub(super) fn dispatch_attachments(
        &self,
        binding: &GuestBinding,
        request: &DispatchRequest,
        control: &DispatchControl,
    ) -> DispatchOutcome {
        let started = Instant::now();
        let check = || {
            if control.cancelled() {
                return Err(BroadcastIssue::Cancelled);
            }
            if started.elapsed() >= BUNDLE_BUDGET {
                return Err(BroadcastIssue::TimedOut);
            }
            self.guest(binding)?;
            self.account(&binding.account_id)?;
            Ok(())
        };
        if let Err(code) = check() {
            return failure(control, code);
        }
        let cleanup_guest = match self.guest(binding) {
            Ok(guest) => guest,
            Err(code) => return failure(control, code),
        };
        let result = (|| -> std::result::Result<DispatchOutcome, BroadcastIssue> {
            if request.tag_all
                || request.attachments.iter().any(|source| {
                    source.account_id != binding.account_id || source.job_id != request.job_id
                })
            {
                return Err(BroadcastIssue::AttachmentUnavailable);
            }
            // All sources are opened and fingerprint-checked before the first
            // side effect. Windows keeps these same handles read-shared only.
            let file_check = || check().map_err(|_| AppError::BroadcastAttachmentUnavailable);
            let io = NativeAttachmentIo;
            let mut readers = Vec::with_capacity(request.attachments.len());
            for source in &request.attachments {
                check()?;
                readers.push(
                    io.open_verified(source, &file_check)
                        .map_err(|error| check().err().unwrap_or_else(|| issue(error)))?,
                );
            }
            let attachments = request
                .attachments
                .iter()
                .map(|source| &source.attachment)
                .collect::<Vec<_>>();
            let payload = json!({ "attemptId": request.attempt_id, "jobId": request.job_id,
                "targetId": request.target_id, "message": request.rendered_text,
                "tagAll": false, "vcards": request.vcards, "attachments": attachments });
            self.call(
                binding,
                "prepare",
                payload,
                Duration::from_secs(18),
                Some(control),
            )?;
            for (index, reader) in readers.iter_mut().enumerate() {
                check()?;
                self.attachment_transfer(
                    binding,
                    &request.attempt_id,
                    json!({ "operation": "start", "index": index }),
                )?;
                let mut offset = 0usize;
                loop {
                    check()?;
                    let Some(chunk) = reader
                        .next_chunk(&file_check)
                        .map_err(|error| check().err().unwrap_or_else(|| issue(error)))?
                    else {
                        break;
                    };
                    self.attachment_transfer(
                        binding,
                        &request.attempt_id,
                        json!({
                            "operation": "chunk", "index": index, "offset": offset,
                            "data": STANDARD.encode(&*chunk),
                        }),
                    )?;
                    offset += chunk.len();
                }
                // EOF includes a second fingerprint verification before the
                // guest's sealed File can pass the one target commit gate.
                check()?;
                self.attachment_transfer(
                    binding,
                    &request.attempt_id,
                    json!({ "operation": "seal", "index": index }),
                )?;
                if index == 0 && !control.try_begin_commit() {
                    return Err(BroadcastIssue::Cancelled);
                }
                check()?;
                let remaining = BUNDLE_BUDGET
                    .checked_sub(started.elapsed())
                    .ok_or(BroadcastIssue::TimedOut)?;
                let value = self.call(
                    binding,
                    "dispatchAttachment",
                    json!({ "attemptId": request.attempt_id, "index": index }),
                    FILE_BUDGET.min(remaining),
                    Some(control),
                )?;
                let outcome: DispatchOutcome =
                    serde_json::from_value(value).map_err(|_| BroadcastIssue::RuntimeFailed)?;
                match outcome {
                    DispatchOutcome::Confirmed { receipt } if valid_receipt(&receipt) => {}
                    DispatchOutcome::Confirmed { .. } => {
                        return Err(BroadcastIssue::ReceiptMissing)
                    }
                    DispatchOutcome::NotSubmitted { code }
                    | DispatchOutcome::Uncertain { code } => return Err(code),
                }
            }
            check()?;
            let remaining = BUNDLE_BUDGET
                .checked_sub(started.elapsed())
                .ok_or(BroadcastIssue::TimedOut)?;
            let value = self.call(
                binding,
                "dispatch",
                json!({ "attemptId": request.attempt_id }),
                Duration::from_secs(35).min(remaining),
                Some(control),
            )?;
            serde_json::from_value(value).map_err(|_| BroadcastIssue::RuntimeFailed)
        })();
        // Cleanup targets the originally held view even after native revocation.
        // An upload already inside WA-JS remains uncertain and owns its file slot
        // until its real Promise settles; cleanup cannot authorize a replay.
        if let (Ok(generation), Ok(attempt)) = (
            serde_json::to_string(&binding.generation),
            serde_json::to_string(&request.attempt_id),
        ) {
            let _ = cleanup_guest.eval(format!(
                "window.__geekTauriPlatform?.cancelAttempt({generation}, {attempt})"
            ));
        }
        match result {
            Ok(outcome) => outcome,
            Err(code) => failure(control, code),
        }
    }
}

fn valid_receipt(value: &str) -> bool {
    !value.is_empty()
        && value != "submitted"
        && value.len() <= 500
        && !value.chars().any(char::is_control)
}
