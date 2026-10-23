//! Recipient import only extends the existing short-lived, native-owned catalog.
use super::*;
use crate::{
    domain::broadcast_import::parse_broadcast_import, infrastructure::broadcast_files::read_import,
};
use serde_json::json;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBroadcastContacts {
    account_id: String,
    file_name: String,
    catalog: BroadcastCatalog,
    recipient_ids: Vec<String>,
    summary: ImportSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportSummary {
    total: usize,
    accepted: usize,
    duplicates: usize,
    invalid: usize,
    unresolved: usize,
    skipped: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolvedContact {
    candidate: String,
    chat: Option<CatalogChat>,
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

impl BroadcastDesktop {
    pub fn import_contacts(
        &self,
        app: &AppHandle,
        account_id: &str,
        catalog_id: &str,
    ) -> Result<Option<ImportedBroadcastContacts>> {
        if !valid_uuid(account_id) || !valid_uuid(catalog_id) {
            return Err(AppError::BroadcastInvalid);
        }
        // One bounded import may resolve contacts at a time. This gate owns no
        // jobs or account state and never blocks the scheduler or Workspace.
        let _import = self
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
        let check = || {
            if self.stopping.load(Ordering::Acquire)
                || !self.sessions.valid(&lease.binding)
                || lease.issued.elapsed() >= Duration::from_secs(1800)
            {
                return Err(AppError::BroadcastImportUnavailable);
            }
            if !self
                .catalogs
                .lock()
                .map_err(|_| AppError::StateUnavailable)?
                .iter()
                .any(|current| {
                    current.catalog.catalog_id == catalog_id
                        && current.binding == lease.binding
                        && current.issued.elapsed() < Duration::from_secs(1800)
                })
            {
                return Err(AppError::BroadcastImportUnavailable);
            }
            self.platform
                .account(account_id)
                .map(|_| ())
                .map_err(|_| AppError::BroadcastImportUnavailable)
        };
        check()?;
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
        check()?;
        let parsed = parse_broadcast_import(&read_import(&path)?)?;
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
        let started = Instant::now();
        let mut seen = HashSet::new();
        let mut resolved = Vec::new();
        for batch in parsed.candidates.chunks(2) {
            check()?;
            let remaining = Duration::from_secs(600)
                .checked_sub(started.elapsed())
                .filter(|time| !time.is_zero())
                .ok_or(AppError::BroadcastImportUnavailable)?;
            let value = self
                .platform
                .call(
                    &lease.binding,
                    "resolveContacts",
                    json!({ "candidates": batch }),
                    remaining.min(Duration::from_secs(35)),
                    None,
                )
                .map_err(|_| AppError::BroadcastImportUnavailable)?;
            check()?;
            if started.elapsed() >= Duration::from_secs(600) {
                return Err(AppError::BroadcastImportUnavailable);
            }
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
        let recipient_ids = resolved.iter().map(|chat| chat.id.clone()).collect();
        let mut catalog = lease.catalog;
        // Do not let repeated imports grow the catalog without bound. Keep the
        // original directory and the bounded verified-contact lease separately.
        catalog
            .chats
            .retain(|chat| lease.native_ids.contains(&chat.id));
        check()?;
        let catalog = self.register_catalog(catalog, lease.binding, resolved, Some(catalog_id))?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("联系人文件")
            .chars()
            .filter(|c| !c.is_control())
            .take(255)
            .collect();
        Ok(Some(ImportedBroadcastContacts {
            account_id: account_id.into(),
            file_name,
            catalog,
            recipient_ids,
            summary,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolver_rows_must_match_requested_order_and_contact_kind() {
        let candidates = vec!["60123456789".into()];
        let row = json!([{ "candidate": "60123456789", "chat": {
            "id": "123@lid", "kind": "contact", "name": "A\nB", "realName": "姓名" } }]);
        let result = resolved_batch(row.clone(), &candidates).unwrap();
        assert_eq!(result[0].as_ref().unwrap().name, "AB");
        assert!(resolved_batch(row, &["60123456780".into()]).is_err());
        assert!(resolved_batch(json!([]), &candidates).is_err());
        assert!(resolved_batch(
            json!([{ "candidate":"60123456789", "chat": {
            "id":"12@g.us", "kind":"group", "name":"g", "realName":"" } }]),
            &candidates
        )
        .is_err());
        assert!(resolved_batch(
            json!([{ "candidate":"60123456789", "chat": null, "path":"x" }]),
            &candidates
        )
        .is_err());
        assert!(resolved_batch(
            json!([{ "candidate":"60123456789", "chat":null }]),
            &candidates
        )
        .unwrap()[0]
            .is_none());
    }
}
