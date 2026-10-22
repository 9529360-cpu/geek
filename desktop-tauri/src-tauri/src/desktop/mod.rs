pub mod commands;
pub mod host;
pub mod layout;
pub mod security;
pub mod tray;
pub mod window;

use crate::{application::workspace::Workspace, infrastructure::repository::EncryptedRepository};
use host::TauriHost;
use std::sync::{Arc, Mutex};

pub type NativeDesktop = Workspace<EncryptedRepository, TauriHost>;
pub type SharedDesktop = Arc<Mutex<NativeDesktop>>;
