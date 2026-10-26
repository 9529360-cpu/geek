use super::BroadcastDesktop;
use crate::{
    domain::error::{AppError, Result},
    infrastructure::broadcast_files::write_report,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedBroadcastFailures {
    account_id: String,
    job_id: String,
    revision: u64,
    row_count: usize,
    saved: bool,
}

impl BroadcastDesktop {
    pub fn export_failures(
        &self,
        app: &AppHandle,
        account_id: &str,
        job_id: &str,
    ) -> Result<ExportedBroadcastFailures> {
        // Snapshot first; native UI, encoding and disk IO never hold a job lock.
        // Historical exports deliberately do not require an online guest.
        let report = self.service.failure_report(account_id, job_id)?;
        let mut result = ExportedBroadcastFailures {
            account_id: report.account_id.clone(),
            job_id: report.job_id.clone(),
            revision: report.revision,
            row_count: report.rows.len(),
            saved: false,
        };
        let csv = report.to_csv();
        let path = {
            let _picker = self
                .picker
                .try_lock()
                .map_err(|_| AppError::BroadcastExportFailed)?;
            let window = app.get_window("main").ok_or(AppError::StateUnavailable)?;
            let file_name = format!("群发异常名单-{}.csv", report.job_id);
            // Own STA, as with attachment selection. The dialog is the sole path authority.
            std::thread::Builder::new()
                .name("geek-broadcast-report-picker".into())
                .spawn(move || {
                    rfd::FileDialog::new()
                        .set_parent(&window)
                        .set_title("导出群发异常名单")
                        .add_filter("CSV", &["csv"])
                        .set_file_name(file_name)
                        .save_file()
                })
                .map_err(|_| AppError::BroadcastExportFailed)?
                .join()
                .map_err(|_| AppError::BroadcastExportFailed)?
        };
        if let Some(path) = path {
            write_report(&path, &csv)?;
            result.saved = true;
        }
        Ok(result)
    }
}
