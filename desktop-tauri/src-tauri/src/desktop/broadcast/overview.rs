//! Read-only contact and statistical exports through the existing native owners.
use super::{file_dialog::DialogPurpose, BroadcastDesktop, CatalogChat, ChatKind};
use crate::{
    domain::{
        broadcast_history::BroadcastHistoryReport,
        csv_export,
        error::{AppError, Result},
    },
    infrastructure::broadcast_files::write_report,
};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedBroadcastData {
    account_id: String,
    revision: Option<u64>,
    row_count: usize,
    saved: bool,
}

impl BroadcastDesktop {
    pub fn export_contacts(
        &self,
        app: &AppHandle,
        account_id: &str,
    ) -> Result<ExportedBroadcastData> {
        let catalog = self.catalog(account_id)?;
        if !catalog.ready {
            return Err(AppError::BroadcastUnavailable);
        }
        let (csv, row_count) = contacts_csv(&catalog.chats, &catalog.platform_id)?;
        let path = self.choose_file(app, DialogPurpose::Contacts)?;
        let saved = if let Some(path) = path {
            write_report(&path, &csv)?;
            true
        } else {
            false
        };
        Ok(ExportedBroadcastData {
            account_id: account_id.into(),
            revision: None,
            row_count,
            saved,
        })
    }

    pub fn history(&self, account_id: &str) -> Result<BroadcastHistoryReport> {
        // Historical summaries need the account record, not an open guest.
        self.platform
            .account(account_id)
            .map_err(|_| AppError::AccountUnknown)?;
        self.service.history_report(account_id)
    }

    pub fn export_history(
        &self,
        app: &AppHandle,
        account_id: &str,
        expected_revision: u64,
    ) -> Result<ExportedBroadcastData> {
        let report = self.history(account_id)?;
        if report.revision != expected_revision {
            return Err(AppError::BroadcastConflict);
        }
        if report.rows.is_empty() {
            return Err(AppError::BroadcastExportEmpty);
        }
        // Freeze before opening a dialog; advancing jobs cannot change this file
        // or cause a lock to span the user's interaction with the native picker.
        let csv = report.to_csv();
        let path = self.choose_file(app, DialogPurpose::History)?;
        let saved = if let Some(path) = path {
            write_report(&path, &csv)?;
            true
        } else {
            false
        };
        Ok(ExportedBroadcastData {
            account_id: account_id.into(),
            revision: Some(report.revision),
            row_count: report.rows.len(),
            saved,
        })
    }
}

fn contacts_csv(chats: &[CatalogChat], platform: &str) -> Result<(String, usize)> {
    let mut csv = String::from("\u{feff}名称,账号ID,平台\r\n");
    let mut count = 0;
    for chat in chats.iter().filter(|chat| chat.kind == ChatKind::Contact) {
        csv_export::row(&mut csv, [chat.name.as_str(), chat.id.as_str(), platform]);
        count += 1;
    }
    if count == 0 {
        return Err(AppError::BroadcastExportEmpty);
    }
    Ok((csv, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contacts_export_excludes_groups_and_escapes_exact_account_identity() {
        let chats = vec![
            CatalogChat {
                id: "1@lid".into(),
                name: "\t=HYPERLINK(\"example\")\r\n客户,一".into(),
                real_name: "private".into(),
                kind: ChatKind::Contact,
            },
            CatalogChat {
                id: "1200@g.us".into(),
                name: "群".into(),
                real_name: String::new(),
                kind: ChatKind::Group,
            },
        ];
        let (csv, count) = contacts_csv(&chats, "whatsapp").unwrap();
        assert_eq!(count, 1);
        assert_eq!(csv, "\u{feff}名称,账号ID,平台\r\n\"'\t=HYPERLINK(\"\"example\"\")  客户,一\",\"1@lid\",\"whatsapp\"\r\n");
        assert!(!csv.contains("private"));
        assert!(!csv.contains("1200@g.us"));
        assert!(matches!(
            contacts_csv(&chats[1..], "whatsapp"),
            Err(AppError::BroadcastExportEmpty)
        ));
    }
}
