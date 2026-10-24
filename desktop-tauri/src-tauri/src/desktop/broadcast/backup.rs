//! File dialogs and composition for the two existing durable settings owners.
use super::{file_dialog::DialogPurpose, BroadcastDesktop};
use crate::{
    application::{account_backup::BackupRestoration, broadcast::now_ms, snapshot::Snapshot},
    desktop::SharedDesktop,
    domain::{
        account_backup::{parse_account_backup, AccountBackup, BackupData, BackupImport},
        error::{AppError, Result},
        export_time::iso_timestamp,
    },
    infrastructure::account_backup_files::{read_backup, write_backup},
};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAccountBackup {
    account_id: String,
    saved: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedAccountBackup {
    account_id: String,
    preset_revision: u64,
    translation_revision: u64,
    backup: BackupImport,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredAccountBackup {
    #[serde(flatten)]
    result: BackupRestoration,
    snapshot: Snapshot,
}

impl BroadcastDesktop {
    pub fn export_backup(
        &self,
        app: &AppHandle,
        account_id: &str,
    ) -> Result<ExportedAccountBackup> {
        let backup = {
            // Presets precedes Workspace, matching restore_audience publication.
            // Neither owner lock spans a dialog, guest operation or export write.
            let presets = self
                .presets
                .lock()
                .map_err(|_| AppError::StateUnavailable)?;
            let workspace = app.state::<SharedDesktop>();
            let desktop = workspace.lock().map_err(|_| AppError::StateUnavailable)?;
            let account = desktop.backup_account(account_id)?;
            AccountBackup::export(
                &account,
                &presets.snapshot(account_id)?,
                iso_timestamp(now_ms()),
            )?
        };
        let content = serde_json::to_string_pretty(&backup).map_err(|_| AppError::BackupInvalid)?;
        let path = self.choose_file(app, DialogPurpose::BackupExport)?;
        let saved = if let Some(path) = path {
            write_backup(&path, &content)?;
            true
        } else {
            false
        };
        Ok(ExportedAccountBackup {
            account_id: account_id.into(),
            saved,
        })
    }

    pub fn pick_backup(
        &self,
        app: &AppHandle,
        account_id: &str,
    ) -> Result<Option<ReviewedAccountBackup>> {
        // Reject unknown targets before a dialog; selection never chooses identity.
        app.state::<SharedDesktop>()
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .backup_account(account_id)?;
        let Some(path) = self.choose_file(app, DialogPurpose::BackupImport)? else {
            return Ok(None);
        };
        let bytes = read_backup(&path)?;
        let presets = self
            .presets
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let workspace = app.state::<SharedDesktop>();
        let desktop = workspace.lock().map_err(|_| AppError::StateUnavailable)?;
        let account = desktop.backup_account(account_id)?;
        let backup = parse_account_backup(&bytes, &account.platform_id)?;
        Ok(Some(ReviewedAccountBackup {
            account_id: account_id.into(),
            preset_revision: presets.snapshot(account_id)?.revision,
            translation_revision: account.translation.revision,
            backup,
        }))
    }

    pub fn restore_backup(
        &self,
        app: &AppHandle,
        account_id: &str,
        expected_preset_revision: u64,
        expected_translation_revision: u64,
        data: BackupData,
    ) -> Result<RestoredAccountBackup> {
        let mut presets = self
            .presets
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let workspace = app.state::<SharedDesktop>();
        let mut desktop = workspace.lock().map_err(|_| AppError::StateUnavailable)?;
        let result = desktop.restore_backup(
            &mut presets,
            account_id,
            expected_preset_revision,
            expected_translation_revision,
            &data,
        )?;
        Ok(RestoredAccountBackup {
            result,
            snapshot: desktop.snapshot(),
        })
    }
}
