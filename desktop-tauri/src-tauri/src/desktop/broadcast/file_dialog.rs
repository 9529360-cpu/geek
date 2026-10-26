//! Fixed native dialog intents. The renderer never supplies a path or extension.
use super::BroadcastDesktop;
use crate::domain::error::{AppError, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(super) enum DialogPurpose {
    Contacts,
    History,
    BackupExport,
    BackupImport,
}

impl BroadcastDesktop {
    pub(super) fn choose_file(
        &self,
        app: &AppHandle,
        purpose: DialogPurpose,
    ) -> Result<Option<PathBuf>> {
        let (title, extension, name, save, error) = match purpose {
            DialogPurpose::Contacts => (
                "导出联系人",
                "csv",
                "联系人导出.csv",
                true,
                AppError::BroadcastExportFailed,
            ),
            DialogPurpose::History => (
                "导出群发数据报表",
                "csv",
                "群发数据报表.csv",
                true,
                AppError::BroadcastExportFailed,
            ),
            DialogPurpose::BackupExport => (
                "导出账号设置备份",
                "json",
                "极客账号设置备份.json",
                true,
                AppError::BackupFileFailed,
            ),
            DialogPurpose::BackupImport => (
                "选择账号设置备份",
                "json",
                "",
                false,
                AppError::BackupFileFailed,
            ),
        };
        let _picker = self.picker.try_lock().map_err(|_| error)?;
        let window = app.get_window("main").ok_or(AppError::StateUnavailable)?;
        // A dedicated native dialog thread never waits while holding Workspace,
        // a job, or a preset transaction. Cancel is a normal, path-free result.
        std::thread::Builder::new()
            .name("geek-settings-file-picker".into())
            .spawn(move || {
                let dialog = rfd::FileDialog::new()
                    .set_parent(&window)
                    .set_title(title)
                    .add_filter(extension, &[extension]);
                if save {
                    dialog.set_file_name(name).save_file()
                } else {
                    dialog.pick_file()
                }
            })
            .map_err(|_| error)?
            .join()
            .map_err(|_| error)
    }
}
