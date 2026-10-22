pub mod commands;
pub mod host;
pub mod layout;
pub mod security;
pub mod tray;

use std::sync::{Arc, Mutex};
use crate::{application::workspace::Workspace, infrastructure::repository::EncryptedRepository};
use host::TauriHost;

pub type NativeDesktop = Workspace<EncryptedRepository, TauriHost>;
pub type SharedDesktop = Arc<Mutex<NativeDesktop>>;
