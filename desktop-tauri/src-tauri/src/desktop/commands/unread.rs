//! Count-only unread poll. It never takes the account workspace lock: the page
//! read can wait, and that wait must not block account commands.
use super::execute;
use crate::{
    desktop::unread::UnreadHub,
    domain::{error::Result, unread::UnreadSnapshot},
};
use std::sync::Arc;
use tauri::{Manager, Webview};

#[tauri::command]
pub async fn unread_poll(webview: Webview, focused_id: Option<String>) -> Result<UnreadSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<UnreadHub>>().poll(focused_id)
    })
    .await
}
