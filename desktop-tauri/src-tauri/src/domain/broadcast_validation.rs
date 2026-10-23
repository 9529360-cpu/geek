use super::{
    broadcast::*,
    broadcast_attachment::{validate_attachments, validate_sources},
    broadcast_render::{validate_template, validate_template_with_limit, validate_text},
    error::{AppError, Result},
};
use std::collections::HashSet;
use uuid::Uuid;

pub fn valid_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

fn label(value: &str, limit: usize, empty_allowed: bool) -> bool {
    (empty_allowed || !value.trim().is_empty())
        && value.encode_utf16().count() <= limit
        && !value.chars().any(char::is_control)
}

pub fn validate_draft(account: &BroadcastAccount, draft: &BroadcastDraft) -> Result<()> {
    if !valid_uuid(&draft.id)
        || !valid_uuid(&account.id)
        || draft.account_id != account.id
        || !label(&account.name, 512, false)
    {
        return Err(AppError::BroadcastInvalid);
    }
    if !matches!(
        account.platform_id.as_str(),
        "whatsapp" | "whatsapp-pure" | "telegram-k"
    ) {
        return Err(AppError::BroadcastUnsupported);
    }
    if account.platform_id == "telegram-k"
        && (draft.tag_all || !draft.vcards.is_empty() || !draft.attachments.is_empty())
    {
        return Err(AppError::BroadcastUnsupported);
    }
    if (!draft.message.trim().is_empty() && !account.capabilities.text)
        || (draft.tag_all && !account.capabilities.tag_all)
        || (!draft.vcards.is_empty() && !account.capabilities.vcards)
        || (!draft.attachments.is_empty() && !account.capabilities.attachments)
        || (!draft.attachments.is_empty() && draft.tag_all)
    {
        return Err(AppError::BroadcastUnsupported);
    }
    if draft.targets.is_empty()
        || draft.targets.len() > MAX_TARGETS
        || draft.vcards.len() > 100
        || draft.interval_min_ms < 1_000
        || draft.interval_max_ms > 3_600_000
        || draft.interval_min_ms > draft.interval_max_ms
        || draft.scheduled_at == Some(0)
        || draft.tag_all && draft.message.trim().is_empty()
        || (draft.message.trim().is_empty()
            && draft.vcards.is_empty()
            && draft.attachments.is_empty())
    {
        return Err(AppError::BroadcastInvalid);
    }
    validate_text(&draft.message)?;
    validate_attachments(&draft.attachments)?;
    let mut ids = HashSet::new();
    for target in &draft.targets {
        if !label(&target.id, 256, false)
            || (account.platform_id == "telegram-k"
                && !super::translation::valid_telegram_chat_id(&target.id))
            || target.id != target.id.trim()
            || !ids.insert(&target.id)
            || !label(&target.name, 512, true)
            || !label(&target.real_name, 512, true)
        {
            return Err(AppError::BroadcastInvalid);
        }
        if account.platform_id == "telegram-k" {
            validate_template_with_limit(&draft.message, target, 4096)?;
        } else {
            validate_template(&draft.message, target)?;
        }
    }
    let mut contacts = HashSet::new();
    for card in &draft.vcards {
        if !label(&card.id, 256, false)
            || card.id != card.id.trim()
            || !contacts.insert(&card.id)
            || !label(&card.name, 512, false)
            || card.name.trim() == card.id
        {
            return Err(AppError::BroadcastNameMissing);
        }
    }
    Ok(())
}

pub fn binding_matches(binding: &GuestBinding, job: &BroadcastJob) -> bool {
    binding.account_id == job.account_id
        && binding.platform_id == job.platform_id
        && valid_uuid(&binding.generation)
}

pub fn validate_document(document: &BroadcastDocument) -> Result<()> {
    if !matches!(document.schema_version, 1 | 2) {
        return Err(AppError::StoreVersion);
    }
    if document.schema_version == 1
        && (!document.attachment_sources.is_empty()
            || document.jobs.iter().any(|job| !job.attachments.is_empty()))
    {
        return Err(AppError::StoreInvalid);
    }
    validate_sources(document)?;
    if document.jobs.len() > MAX_JOBS || document.retired_ids.len() > MAX_RETIRED_IDS {
        return Err(AppError::StoreInvalid);
    }
    let mut ids = HashSet::new();
    for id in &document.retired_ids {
        if !valid_uuid(id) || !ids.insert(id) {
            return Err(AppError::StoreInvalid);
        }
    }
    let mut owners = HashSet::new();
    for job in &document.jobs {
        let account = BroadcastAccount {
            id: job.account_id.clone(),
            name: job.account_name.clone(),
            platform_id: job.platform_id.clone(),
            capabilities: BroadcastCapabilities {
                text: true,
                tag_all: true,
                vcards: true,
                attachments: true,
            },
        };
        validate_draft(&account, &job.draft()).map_err(|_| AppError::StoreInvalid)?;
        if !ids.insert(&job.id)
            || (job.state.owns_account() && !owners.insert(&job.account_id))
            || job.total != job.targets.len()
            || job.current > job.total
            || job
                .ok
                .checked_add(job.fail)
                .and_then(|value| value.checked_add(job.uncertain))
                != Some(job.current)
            || job.results.len() != job.current
            || job.prepare_attempts > MAX_PREPARE_ATTEMPTS
            || job.created_at == 0
            || job.updated_at < job.created_at
            || job.storage_blocked
            || job.dismissed && !job.state.terminal()
            || job.state == BroadcastState::Completed && job.current != job.total
            || job.state.terminal() != job.finished_at.is_some()
            || job.state.terminal() && job.checkpoint.is_some()
            || job
                .binding
                .as_ref()
                .is_some_and(|binding| !binding_matches(binding, job))
        {
            return Err(AppError::StoreInvalid);
        }
        if let Some(checkpoint) = &job.checkpoint {
            if !valid_uuid(&checkpoint.attempt_id)
                || checkpoint.index != job.current
                || checkpoint.index >= job.total
                || !job.state.owns_account()
                || job.binding.is_none()
            {
                return Err(AppError::StoreInvalid);
            }
        }
        if let Some(prepared) = &job.prepared {
            if prepared.index != job.current || prepared.index >= job.total || job.state.terminal()
            {
                return Err(AppError::StoreInvalid);
            }
            validate_text(&prepared.rendered_text).map_err(|_| AppError::StoreInvalid)?;
        }
        if job.checkpoint.is_some() && job.prepared.is_none() {
            return Err(AppError::StoreInvalid);
        }
        let mut counts = (0, 0, 0);
        for (index, result) in job.results.iter().enumerate() {
            if result.index != index || result.at < job.created_at {
                return Err(AppError::StoreInvalid);
            }
            match &result.outcome {
                DispatchOutcome::Confirmed { receipt } => {
                    if !label(receipt, 1_024, false) {
                        return Err(AppError::StoreInvalid);
                    }
                    counts.0 += 1;
                }
                DispatchOutcome::NotSubmitted { .. } => counts.1 += 1,
                DispatchOutcome::Uncertain { .. } => counts.2 += 1,
            }
        }
        if counts != (job.ok, job.fail, job.uncertain) {
            return Err(AppError::StoreInvalid);
        }
    }
    Ok(())
}
