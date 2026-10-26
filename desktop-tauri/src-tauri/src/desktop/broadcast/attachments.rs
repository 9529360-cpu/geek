//! Native selection only. The shell receives opaque references, never local paths.
use super::BroadcastDesktop;
use crate::{
    application::ports::BroadcastAttachmentIo,
    domain::{
        broadcast_attachment::BroadcastAttachment,
        broadcast_validation::valid_uuid,
        error::{AppError, Result},
    },
    infrastructure::broadcast_attachment_source::{NativeAttachmentIo, TelegramAttachmentIo},
};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedBroadcastAttachments {
    account_id: String,
    attachments: Vec<BroadcastAttachment>,
}

impl BroadcastDesktop {
    pub fn pick_attachments(
        &self,
        app: &AppHandle,
        account_id: &str,
    ) -> Result<Option<PickedBroadcastAttachments>> {
        if !valid_uuid(account_id) {
            return Err(AppError::BroadcastInvalid);
        }
        let _picker = self
            .picker
            .try_lock()
            .map_err(|_| AppError::BroadcastAttachmentUnavailable)?;
        let account = self
            .platform
            .account(account_id)
            .map_err(|_| AppError::AccountUnknown)?;
        if !matches!(
            account.platform_id.as_str(),
            "whatsapp" | "whatsapp-pure" | "telegram-k"
        ) {
            return Err(AppError::BroadcastUnsupported);
        }
        let binding = self
            .sessions
            .binding(account_id, &account.platform_id)
            .map_err(|_| AppError::BroadcastUnavailable)?;
        let check = || {
            if self.stopping.load(Ordering::Acquire) || !self.sessions.valid(&binding) {
                return Err(AppError::BroadcastAttachmentUnavailable);
            }
            self.platform
                .account(account_id)
                .map(|_| ())
                .map_err(|_| AppError::BroadcastAttachmentUnavailable)
        };
        check()?;
        let window = app.get_window("main").ok_or(AppError::StateUnavailable)?;
        // A fresh thread gives the Windows dialog its own STA. Reusing a WinRT
        // blocking-pool thread could silently confuse COM failure with Cancel.
        // rfd is the same native picker backend as Tauri's dialog plugin; using
        // its Rust API avoids injecting alert/confirm replacements into guests.
        let paths = std::thread::Builder::new()
            .name("geek-broadcast-file-picker".into())
            .spawn(move || {
                rfd::FileDialog::new()
                    .set_parent(&window)
                    .set_title("选择群发附件")
                    .pick_files()
            })
            .map_err(|_| AppError::BroadcastAttachmentUnavailable)?
            .join()
            .map_err(|_| AppError::BroadcastAttachmentUnavailable)?;
        let Some(paths) = paths else { return Ok(None) };
        check()?;
        let io: &dyn BroadcastAttachmentIo = if account.platform_id == "telegram-k" {
            &TelegramAttachmentIo
        } else {
            &NativeAttachmentIo
        };
        let attachments = self
            .service
            .register_attachments(account_id, &paths, false, io, &check)?;
        Ok(Some(PickedBroadcastAttachments {
            account_id: account_id.into(),
            attachments,
        }))
    }

    pub fn release_attachments(&self, account_id: &str, attachment_ids: &[String]) -> Result<()> {
        self.service.release_attachments(account_id, attachment_ids)
    }
}
