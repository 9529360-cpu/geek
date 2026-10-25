//! Contact notes (联系人备注) share the workspace boundary: the account identity
//! comes from the caller, the chat identity from validated IPC arguments.
use super::execute_workspace;
use crate::{
    application::snapshot::Snapshot,
    desktop::SharedDesktop,
    domain::{contact_notes::ContactNote, error::Result},
};
use tauri::{State, Webview};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContactNotesIdentity {
    pub chat_id: String,
    pub family: String,
}

#[tauri::command]
pub async fn contact_notes(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    identity: ContactNotesIdentity,
) -> Result<Option<ContactNote>> {
    execute_workspace(webview, state, move |desktop| {
        desktop.contact_notes(&id, &identity.family, &identity.chat_id)
    })
    .await
}

#[tauri::command]
pub async fn contact_notes_update(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    identity: ContactNotesIdentity,
    note: ContactNote,
    now: u64,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| {
        desktop.update_contact_notes(&id, &identity.family, &identity.chat_id, note, now)?;
        Ok(desktop.snapshot())
    })
    .await
}
