pub mod broadcast;
pub mod commands;
pub mod host;
pub mod layout;
mod platform_attachments;
pub mod platform_bridge;
pub mod platform_sessions;
pub mod security;
pub mod send_guest;
pub mod session;
pub mod translation;
pub mod translation_guest;
pub mod tray;
pub mod window;

use crate::{application::workspace::Workspace, infrastructure::repository::EncryptedRepository};
use host::TauriHost;
use std::sync::{Arc, Mutex};

pub type NativeDesktop = Workspace<EncryptedRepository, TauriHost>;
pub type SharedDesktop = Arc<Mutex<NativeDesktop>>;
