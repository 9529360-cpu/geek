//! Authorized advanced-tool ingress; file and settings effects live in their owners.
use super::execute;
use crate::{
    desktop::broadcast::{
        BroadcastDesktop, ExportedAccountBackup, ExportedBroadcastData, RestoredAccountBackup,
        ReviewedAccountBackup,
    },
    domain::{
        account_backup::BackupData, broadcast_history::BroadcastHistoryReport, error::Result,
    },
};
use std::sync::Arc;
use tauri::{Manager, Webview};

#[tauri::command]
pub async fn broadcast_export_contacts(
    webview: Webview,
    account_id: String,
) -> Result<ExportedBroadcastData> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .export_contacts(&app, &account_id)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_history(
    webview: Webview,
    account_id: String,
) -> Result<BroadcastHistoryReport> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().history(&account_id)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_export_history(
    webview: Webview,
    account_id: String,
    expected_revision: u64,
) -> Result<ExportedBroadcastData> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .export_history(&app, &account_id, expected_revision)
    })
    .await
}

#[tauri::command]
pub async fn account_export_backup(
    webview: Webview,
    account_id: String,
) -> Result<ExportedAccountBackup> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .export_backup(&app, &account_id)
    })
    .await
}

#[tauri::command]
pub async fn account_pick_backup(
    webview: Webview,
    account_id: String,
) -> Result<Option<ReviewedAccountBackup>> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .pick_backup(&app, &account_id)
    })
    .await
}

#[tauri::command]
pub async fn account_restore_backup(
    webview: Webview,
    account_id: String,
    expected_preset_revision: u64,
    expected_translation_revision: u64,
    data: BackupData,
) -> Result<RestoredAccountBackup> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().restore_backup(
            &app,
            &account_id,
            expected_preset_revision,
            expected_translation_revision,
            data,
        )
    })
    .await
}
