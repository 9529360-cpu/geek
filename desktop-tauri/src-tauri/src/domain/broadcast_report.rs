//! A read-only report of settled exceptions and task-level issues.
use super::csv_export::cell as csv_cell;
use super::{
    broadcast::{BroadcastIssue, BroadcastJob, DispatchOutcome},
    error::{AppError, Result},
};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BroadcastFailureStatus {
    NotSubmitted,
    Uncertain,
    TaskIssue,
}

impl BroadcastFailureStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotSubmitted => "NOT_SUBMITTED",
            Self::Uncertain => "UNCERTAIN",
            Self::TaskIssue => "TASK_ISSUE",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastFailureRow {
    pub name: String,
    pub target_id: Option<String>,
    pub status: BroadcastFailureStatus,
    pub code: BroadcastIssue,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastFailureReport {
    pub account_id: String,
    pub job_id: String,
    pub revision: u64,
    pub rows: Vec<BroadcastFailureRow>,
}

impl BroadcastFailureReport {
    pub(crate) fn from_job(job: &BroadcastJob, revision: u64) -> Result<Self> {
        let mut rows = Vec::new();
        for result in &job.results {
            let (status, code) = match result.outcome {
                DispatchOutcome::Confirmed { .. } => continue,
                DispatchOutcome::NotSubmitted { code } => {
                    (BroadcastFailureStatus::NotSubmitted, code)
                }
                DispatchOutcome::Uncertain { code } => (BroadcastFailureStatus::Uncertain, code),
            };
            let target = job
                .targets
                .get(result.index)
                .ok_or(AppError::StoreInvalid)?;
            rows.push(BroadcastFailureRow {
                name: target.name.clone(),
                target_id: Some(target.id.clone()),
                status,
                code,
            });
        }
        // A task issue is not evidence that an unexecuted recipient failed.
        for code in job.last_issue.into_iter().chain(
            job.storage_blocked
                .then_some(BroadcastIssue::PersistenceFailed),
        ) {
            if !rows.iter().any(|row| row.code == code) {
                rows.push(BroadcastFailureRow {
                    name: "任务".into(),
                    target_id: None,
                    status: BroadcastFailureStatus::TaskIssue,
                    code,
                });
            }
        }
        if rows.is_empty() {
            return Err(AppError::BroadcastExportEmpty);
        }
        Ok(Self {
            account_id: job.account_id.clone(),
            job_id: job.id.clone(),
            revision,
            rows,
        })
    }

    pub fn to_csv(&self) -> String {
        let mut csv = String::from("\u{feff}联系人,聊天ID,失败原因,发送状态\r\n");
        for row in &self.rows {
            let cells = [
                row.name.as_str(),
                row.target_id.as_deref().unwrap_or_default(),
                issue_code(row.code),
                row.status.as_str(),
            ];
            for (index, value) in cells.into_iter().enumerate() {
                if index != 0 {
                    csv.push(',');
                }
                csv_cell(&mut csv, value);
            }
            csv.push_str("\r\n");
        }
        csv
    }
}

fn issue_code(code: BroadcastIssue) -> &'static str {
    match code {
        BroadcastIssue::AccountUnavailable => "ACCOUNT_UNAVAILABLE",
        BroadcastIssue::CapabilityUnavailable => "CAPABILITY_UNAVAILABLE",
        BroadcastIssue::GuestChanged => "GUEST_CHANGED",
        BroadcastIssue::TargetChanged => "TARGET_CHANGED",
        BroadcastIssue::ComposerMismatch => "COMPOSER_MISMATCH",
        BroadcastIssue::NotSubmitted => "NOT_SUBMITTED",
        BroadcastIssue::ReceiptMissing => "RECEIPT_MISSING",
        BroadcastIssue::TimedOut => "TIMED_OUT",
        BroadcastIssue::Interrupted => "INTERRUPTED",
        BroadcastIssue::InterruptedUncertain => "INTERRUPTED_UNCERTAIN",
        BroadcastIssue::Cancelled => "CANCELLED",
        BroadcastIssue::PersistenceFailed => "PERSISTENCE_FAILED",
        BroadcastIssue::ScheduleAccountUnavailable => "SCHEDULE_ACCOUNT_UNAVAILABLE",
        BroadcastIssue::RuntimeFailed => "RUNTIME_FAILED",
        BroadcastIssue::AttachmentUnavailable => "ATTACHMENT_UNAVAILABLE",
        BroadcastIssue::AttachmentChanged => "ATTACHMENT_CHANGED",
    }
}
