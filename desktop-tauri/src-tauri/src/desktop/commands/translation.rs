//! Translation settings and read-only diagnostics share the standard sender boundary.
use super::{execute, execute_workspace};
use crate::{
    application::snapshot::Snapshot,
    desktop::{
        translation::TranslationDesktop, translation_guest::TranslationContext, SharedDesktop,
    },
    domain::{
        error::Result, translation::TranslationPolicyUpdate,
        translation_health::TranslationHealthSnapshot,
    },
};
use std::sync::Arc;
use tauri::{Manager, State, Webview};

#[tauri::command]
pub async fn translation_health(webview: Webview) -> Result<TranslationHealthSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<TranslationDesktop>>().health()
    })
    .await
}

#[tauri::command]
pub async fn translation_context(
    webview: Webview,
    account_id: String,
) -> Result<TranslationContext> {
    execute(webview, move |app| {
        app.state::<Arc<TranslationDesktop>>().context(&account_id)
    })
    .await
}

#[tauri::command]
pub async fn account_update_translation(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    chat_id: Option<String>,
    policy: Option<TranslationPolicyUpdate>,
    expected_revision: u64,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| {
        desktop.update_translation(&id, chat_id.as_deref(), policy, expected_revision)
    })
    .await
}
