//! Durable reusable content is separate from jobs and short-lived catalog authority.
use super::{
    imports::{remaining, resolved_batch, ImportSummary},
    *,
};
use crate::domain::broadcast_presets::{
    validate_preset_recipients, BroadcastPresetKind, BroadcastPresetSnapshot,
};
use serde_json::json;
use std::sync::MutexGuard;

impl BroadcastDesktop {
    fn preset_account(&self, account_id: &str) -> Result<()> {
        if !valid_uuid(account_id) {
            return Err(AppError::BroadcastPresetInvalid);
        }
        if self.stopping.load(Ordering::Acquire) {
            return Err(AppError::BroadcastUnavailable);
        }
        let account = self
            .platform
            .account(account_id)
            .map_err(|_| AppError::AccountUnknown)?;
        if !matches!(
            account.platform_id.as_str(),
            "whatsapp" | "whatsapp-pure" | "telegram-k"
        ) {
            return Err(AppError::BroadcastUnsupported);
        }
        Ok(())
    }

    fn preset_owner(&self) -> Result<MutexGuard<'_, NativeBroadcastPresets>> {
        self.presets.lock().map_err(|_| AppError::StateUnavailable)
    }

    pub fn presets(&self, account_id: &str) -> Result<BroadcastPresetSnapshot> {
        self.preset_account(account_id)?;
        self.preset_owner()?.snapshot(account_id)
    }

    pub fn save_message(
        &self,
        account_id: &str,
        expected_revision: u64,
        name: &str,
        message: &str,
    ) -> Result<BroadcastPresetSnapshot> {
        self.preset_account(account_id)?;
        self.preset_owner()?
            .save_message(account_id, expected_revision, name, message)
    }

    pub fn save_audience(
        &self,
        account_id: &str,
        catalog_id: &str,
        expected_revision: u64,
        name: &str,
        recipient_ids: &[String],
    ) -> Result<BroadcastPresetSnapshot> {
        self.preset_account(account_id)?;
        let import = self.recipient_import(account_id, catalog_id)?;
        let recipient_ids = freeze_audience_ids(&import.lease, recipient_ids)?;
        import.check()?;
        // The catalog and Workspace locks are already released. This write only
        // saves reusable IDs; future restoration must acquire fresh authority.
        self.preset_owner()?
            .save_audience(account_id, expected_revision, name, recipient_ids)
    }

    pub fn delete_preset(
        &self,
        account_id: &str,
        expected_revision: u64,
        kind: BroadcastPresetKind,
        id: &str,
    ) -> Result<BroadcastPresetSnapshot> {
        self.preset_account(account_id)?;
        self.preset_owner()?
            .delete(account_id, expected_revision, kind, id)
    }

    pub fn restore_audience(
        &self,
        account_id: &str,
        catalog_id: &str,
        expected_revision: u64,
        preset_id: &str,
    ) -> Result<ResolvedBroadcastRecipients> {
        self.preset_account(account_id)?;
        let saved = self
            .preset_owner()?
            .audience(account_id, expected_revision, preset_id)?;
        let import = self.recipient_import(account_id, catalog_id)?;
        let started = Instant::now();
        let (recipient_ids, additions, summary) = restore_targets(
            &import.lease,
            &saved.recipient_ids,
            |batch| import.call("resolveContacts", json!({ "candidates": batch }), started),
            || import.check(),
            || started.elapsed(),
        )?;
        // No preset lock spans platform waits. Hold its revision only across the
        // final short catalog publication, so a deleted/replaced preset cannot win.
        let presets = self.preset_owner()?;
        presets.audience(account_id, expected_revision, preset_id)?;
        import.publish(recipient_ids, additions, summary, started)
    }
}

fn usable_directory(lease: &CatalogLease) -> bool {
    lease.catalog.ready
        && matches!(
            lease.catalog.platform_id.as_str(),
            "whatsapp" | "whatsapp-pure" | "telegram-k"
        )
        && lease.binding.account_id == lease.catalog.account_id
        && lease.binding.platform_id == lease.catalog.platform_id
}

fn current_chats(lease: &CatalogLease) -> HashMap<&str, &CatalogChat> {
    lease
        .catalog
        .chats
        .iter()
        .filter(|chat| {
            supported_catalog_id(&lease.catalog.platform_id, &chat.id, chat.kind)
                && ((chat.kind == ChatKind::Contact) || lease.native_ids.contains(&chat.id))
        })
        .map(|chat| (chat.id.as_str(), chat))
        .collect()
}

fn freeze_audience_ids(lease: &CatalogLease, ids: &[String]) -> Result<Vec<String>> {
    validate_preset_recipients(ids)?;
    if !usable_directory(lease) {
        return Err(AppError::BroadcastPresetInvalid);
    }
    let chats = current_chats(lease);
    ids.iter()
        .map(|id| {
            chats
                .get(id.as_str())
                .map(|chat| chat.id.clone())
                .ok_or(AppError::BroadcastPresetInvalid)
        })
        .collect()
}

/// Saved IDs are hints. Groups require current native directory membership;
/// absent contacts use the same proved canonical-contact resolver as file imports.
fn restore_targets(
    lease: &CatalogLease,
    ids: &[String],
    mut call: impl FnMut(&[String]) -> Result<serde_json::Value>,
    check: impl Fn() -> Result<()>,
    elapsed: impl Fn() -> Duration,
) -> Result<(Vec<String>, Vec<CatalogChat>, ImportSummary)> {
    validate_preset_recipients(ids)?;
    if !usable_directory(lease) {
        return Err(AppError::BroadcastPresetInvalid);
    }
    if ids.iter().any(|id| {
        !supported_catalog_id(&lease.catalog.platform_id, id, ChatKind::Contact)
            && !supported_catalog_id(&lease.catalog.platform_id, id, ChatKind::Group)
    }) {
        return Err(AppError::BroadcastPresetInvalid);
    }
    check()?;
    remaining(elapsed())?;
    let mut summary = ImportSummary::selected(ids.len());
    let chats = current_chats(lease);
    let mut slots = vec![None; ids.len()];
    let mut missing = Vec::new();
    for (index, id) in ids.iter().enumerate() {
        if let Some(chat) = chats.get(id.as_str()) {
            slots[index] = Some((*chat).clone());
        } else if supported_catalog_id(&lease.catalog.platform_id, id, ChatKind::Contact) {
            missing.push((index, id.clone()));
        } else {
            summary.skipped += 1;
        }
    }
    for batch in missing.chunks(2) {
        check()?;
        remaining(elapsed())?;
        let candidates: Vec<_> = batch.iter().map(|(_, id)| id.clone()).collect();
        let value = call(&candidates)?;
        check()?;
        remaining(elapsed())?;
        for ((index, _), resolved) in batch.iter().zip(resolved_batch(
            value,
            &candidates,
            &lease.catalog.platform_id,
        )?) {
            if resolved.is_none() {
                summary.unresolved += 1;
            }
            slots[*index] = resolved;
        }
    }
    let mut seen = HashSet::new();
    let mut recipients = Vec::new();
    let mut additions = Vec::new();
    for chat in slots.into_iter().flatten() {
        if seen.insert(chat.id.clone()) {
            recipients.push(chat.id.clone());
            // Protect every selected contact from bounded-cache eviction; group
            // authority remains in the native directory and never enters this cache.
            if chat.kind == ChatKind::Contact {
                additions.push(chat);
            }
        } else {
            summary.duplicates += 1;
        }
    }
    summary.accepted = recipients.len();
    check()?;
    remaining(elapsed())?;
    Ok((recipients, additions, summary))
}

#[cfg(test)]
mod tests;
