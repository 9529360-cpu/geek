//! Recipient sources share one account-bound import operation.
use super::*;
use crate::{
    domain::broadcast_import::{
        parse_broadcast_import, parse_broadcast_pasted_recipients, BroadcastImportCandidates,
    },
    infrastructure::broadcast_files::read_import,
};
use serde_json::json;
use std::sync::MutexGuard;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBroadcastContacts {
    file_name: String,
    #[serde(flatten)]
    recipients: ResolvedBroadcastRecipients,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedBroadcastRecipients {
    account_id: String,
    catalog: BroadcastCatalog,
    recipient_ids: Vec<String>,
    summary: ImportSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ImportSummary {
    total: usize,
    accepted: usize,
    duplicates: usize,
    invalid: usize,
    unresolved: usize,
    skipped: usize,
}

impl ImportSummary {
    pub(super) fn selected(count: usize) -> Self {
        Self {
            total: count,
            accepted: count,
            duplicates: 0,
            invalid: 0,
            unresolved: 0,
            skipped: 0,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolvedContact {
    candidate: String,
    chat: Option<CatalogChat>,
}

/// All entry points borrow the existing owner and retain its finite gate until
/// the validated catalog has been published. No job or Workspace lock is held.
pub(super) struct RecipientImport<'a> {
    desktop: &'a BroadcastDesktop,
    pub(super) lease: CatalogLease,
    _import: MutexGuard<'a, ()>,
}

impl BroadcastDesktop {
    pub fn import_contacts(
        &self,
        app: &AppHandle,
        account_id: &str,
        catalog_id: &str,
    ) -> Result<Option<ImportedBroadcastContacts>> {
        let import = self.recipient_import(account_id, catalog_id)?;
        let path = {
            let _picker = self
                .picker
                .try_lock()
                .map_err(|_| AppError::BroadcastImportUnavailable)?;
            let window = app.get_window("main").ok_or(AppError::StateUnavailable)?;
            std::thread::Builder::new()
                .name("geek-broadcast-import-picker".into())
                .spawn(move || {
                    rfd::FileDialog::new()
                        .set_parent(&window)
                        .set_title("导入群发联系人")
                        .add_filter("CSV/TXT", &["csv", "txt"])
                        .pick_file()
                })
                .map_err(|_| AppError::BroadcastImportUnavailable)?
                .join()
                .map_err(|_| AppError::BroadcastImportUnavailable)?
        };
        let Some(path) = path else { return Ok(None) };
        import.check()?;
        let parsed = parse_broadcast_import(&read_import(&path)?)?;
        let recipients = import.resolve(parsed)?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("联系人文件")
            .chars()
            .filter(|c| !c.is_control())
            .take(255)
            .collect();
        Ok(Some(ImportedBroadcastContacts {
            file_name,
            recipients,
        }))
    }

    pub fn resolve_recipients(
        &self,
        account_id: &str,
        catalog_id: &str,
        text: &str,
    ) -> Result<ResolvedBroadcastRecipients> {
        let import = self.recipient_import(account_id, catalog_id)?;
        import.resolve(parse_broadcast_pasted_recipients(text)?)
    }

    pub(super) fn recipient_import(
        &self,
        account_id: &str,
        catalog_id: &str,
    ) -> Result<RecipientImport<'_>> {
        if !valid_uuid(account_id) || !valid_uuid(catalog_id) {
            return Err(AppError::BroadcastInvalid);
        }
        let guard = self
            .importing
            .try_lock()
            .map_err(|_| AppError::BroadcastImportUnavailable)?;
        let lease = self
            .catalogs
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .iter()
            .find(|lease| {
                lease.catalog.account_id == account_id
                    && lease.catalog.catalog_id == catalog_id
                    && lease.catalog.ready
                    && lease.issued.elapsed() < Duration::from_secs(1800)
            })
            .cloned()
            .ok_or(AppError::BroadcastImportUnavailable)?;
        let import = RecipientImport {
            desktop: self,
            lease,
            _import: guard,
        };
        import.check()?;
        Ok(import)
    }
}

impl RecipientImport<'_> {
    pub(super) fn check(&self) -> Result<()> {
        let desktop = self.desktop;
        let lease = &self.lease;
        if desktop.stopping.load(Ordering::Acquire)
            || !desktop.sessions.valid(&lease.binding)
            || lease.issued.elapsed() >= Duration::from_secs(1800)
        {
            return Err(AppError::BroadcastImportUnavailable);
        }
        if !desktop
            .catalogs
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .iter()
            .any(|current| {
                current.catalog.account_id == lease.catalog.account_id
                    && current.catalog.catalog_id == lease.catalog.catalog_id
                    && current.binding == lease.binding
                    && current.issued.elapsed() < Duration::from_secs(1800)
            })
        {
            return Err(AppError::BroadcastImportUnavailable);
        }
        desktop
            .platform
            .account(&lease.catalog.account_id)
            .map(|_| ())
            .map_err(|_| AppError::BroadcastImportUnavailable)
    }

    fn resolve(self, parsed: BroadcastImportCandidates) -> Result<ResolvedBroadcastRecipients> {
        self.resolve_contacts(parsed, None, Instant::now())
    }

    pub(super) fn call(
        &self,
        operation: &str,
        payload: serde_json::Value,
        started: Instant,
    ) -> Result<serde_json::Value> {
        self.check()?;
        let timeout = remaining(started.elapsed())?.min(Duration::from_secs(35));
        let value = self
            .desktop
            .platform
            .call(&self.lease.binding, operation, payload, timeout, None)
            .map_err(|_| AppError::BroadcastImportUnavailable)?;
        self.check()?;
        remaining(started.elapsed())?;
        Ok(value)
    }

    pub(super) fn resolve_contacts(
        self,
        parsed: BroadcastImportCandidates,
        self_ids: Option<&[String]>,
        started: Instant,
    ) -> Result<ResolvedBroadcastRecipients> {
        let (resolved, summary) = verify_candidates(
            parsed,
            |batch, _| {
                let mut payload = json!({ "candidates": batch });
                if let Some(ids) = self_ids {
                    payload["selfIds"] = json!(ids);
                }
                self.call("resolveContacts", payload, started)
            },
            || self.check(),
            || started.elapsed(),
        )?;
        if self_ids.is_some_and(|ids| {
            resolved.iter().any(|chat| {
                ids.contains(&chat.id)
                    || !ids.iter().any(|own| {
                        own.rsplit_once('@').map(|(_, server)| server)
                            == chat.id.rsplit_once('@').map(|(_, server)| server)
                    })
            })
        }) {
            return Err(AppError::BroadcastImportUnavailable);
        }
        let recipient_ids = resolved.iter().map(|chat| chat.id.clone()).collect();
        self.publish(recipient_ids, resolved, summary, started)
    }

    pub(super) fn publish(
        self,
        recipient_ids: Vec<String>,
        additions: Vec<CatalogChat>,
        summary: ImportSummary,
        started: Instant,
    ) -> Result<ResolvedBroadcastRecipients> {
        self.check()?;
        let mut catalog = self.lease.catalog;
        // Keep the native directory separate from the bounded imported cache.
        catalog
            .chats
            .retain(|chat| self.lease.native_ids.contains(&chat.id));
        let catalog_id = catalog.catalog_id.clone();
        remaining(started.elapsed())?;
        let catalog = self.desktop.register_catalog(
            catalog,
            self.lease.binding,
            additions,
            Some(&catalog_id),
        )?;
        Ok(ResolvedBroadcastRecipients {
            account_id: catalog.account_id.clone(),
            catalog,
            recipient_ids,
            summary,
        })
    }
}

fn remaining(elapsed: Duration) -> Result<Duration> {
    Duration::from_secs(600)
        .checked_sub(elapsed)
        .filter(|time| !time.is_zero())
        .ok_or(AppError::BroadcastImportUnavailable)
}

fn verify_candidates(
    parsed: BroadcastImportCandidates,
    mut call: impl FnMut(&[String], Duration) -> Result<serde_json::Value>,
    check: impl Fn() -> Result<()>,
    elapsed: impl Fn() -> Duration,
) -> Result<(Vec<CatalogChat>, ImportSummary)> {
    let mut summary = ImportSummary {
        total: parsed.candidates.len()
            + parsed.duplicate_count
            + parsed.invalid_count
            + parsed.skipped_count,
        accepted: 0,
        duplicates: parsed.duplicate_count,
        invalid: parsed.invalid_count,
        unresolved: 0,
        skipped: parsed.skipped_count,
    };
    let mut seen = HashSet::new();
    let mut resolved = Vec::new();
    for batch in parsed.candidates.chunks(2) {
        check()?;
        let value = call(batch, remaining(elapsed())?.min(Duration::from_secs(35)))?;
        check()?;
        remaining(elapsed())?;
        for chat in resolved_batch(value, batch)? {
            match chat {
                Some(chat) if seen.insert(chat.id.clone()) => resolved.push(chat),
                Some(_) => summary.duplicates += 1,
                None => summary.unresolved += 1,
            }
        }
    }
    if resolved.is_empty() {
        return Err(AppError::BroadcastImportEmpty);
    }
    summary.accepted = resolved.len();
    Ok((resolved, summary))
}

fn resolved_batch(
    value: serde_json::Value,
    candidates: &[String],
) -> Result<Vec<Option<CatalogChat>>> {
    let rows: Vec<ResolvedContact> =
        serde_json::from_value(value).map_err(|_| AppError::BroadcastImportUnavailable)?;
    if rows.len() != candidates.len() {
        return Err(AppError::BroadcastImportUnavailable);
    }
    rows.into_iter()
        .zip(candidates)
        .map(|(row, expected)| {
            if row.candidate != *expected {
                return Err(AppError::BroadcastImportUnavailable);
            }
            row.chat
                .map(|mut chat| {
                    if chat.kind != ChatKind::Contact || !supported_id(&chat.id, chat.kind) {
                        return Err(AppError::BroadcastImportUnavailable);
                    }
                    chat.name = chat
                        .name
                        .chars()
                        .filter(|c| !c.is_control())
                        .take(256)
                        .collect();
                    chat.real_name = chat
                        .real_name
                        .chars()
                        .filter(|c| !c.is_control())
                        .take(256)
                        .collect();
                    Ok(chat)
                })
                .transpose()
        })
        .collect()
}

#[cfg(test)]
mod tests;
