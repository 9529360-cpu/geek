//! Account-bound statistical projections. No message body, recipient or receipt escapes.
use super::{
    broadcast::{BroadcastJob, BroadcastState},
    csv_export,
    export_time::iso_timestamp,
};
use serde::Serialize;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastHistorySummary {
    pub jobs: usize,
    pub total: usize,
    pub ok: usize,
    pub fail: usize,
    pub uncertain: usize,
    pub pending: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastHistoryRow {
    pub job_id: String,
    pub created_at: u64,
    pub finished_at: Option<u64>,
    pub total: usize,
    pub ok: usize,
    pub fail: usize,
    pub uncertain: usize,
    pub pending: usize,
    pub attachments: usize,
    pub message_length: usize,
    pub state: BroadcastState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastHistoryReport {
    pub account_id: String,
    pub revision: u64,
    pub summary: BroadcastHistorySummary,
    pub rows: Vec<BroadcastHistoryRow>,
}

impl BroadcastHistoryReport {
    pub(crate) fn from_jobs(account_id: &str, revision: u64, jobs: &[BroadcastJob]) -> Self {
        let mut summary = BroadcastHistorySummary::default();
        let mut rows = Vec::new();
        for job in jobs.iter().filter(|job| job.account_id == account_id) {
            let pending = job.total.saturating_sub(job.ok + job.fail + job.uncertain);
            summary.jobs += 1;
            summary.total += job.total;
            summary.ok += job.ok;
            summary.fail += job.fail;
            summary.uncertain += job.uncertain;
            summary.pending += pending;
            rows.push(BroadcastHistoryRow {
                job_id: job.id.clone(),
                created_at: job.created_at,
                finished_at: job.finished_at,
                total: job.total,
                ok: job.ok,
                fail: job.fail,
                uncertain: job.uncertain,
                pending,
                attachments: job.attachments.len(),
                message_length: job.message.encode_utf16().count(),
                state: job.state,
            });
        }
        rows.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then(a.job_id.cmp(&b.job_id))
        });
        Self {
            account_id: account_id.into(),
            revision,
            summary,
            rows,
        }
    }

    pub fn to_csv(&self) -> String {
        let mut csv = String::from("\u{feff}创建时间UTC,完成时间UTC,发送对象,已确认,未提交,结果不确定,未处理,附件数,消息长度,任务状态,任务ID\r\n");
        for row in &self.rows {
            let cells = [
                iso_timestamp(row.created_at),
                row.finished_at.map(iso_timestamp).unwrap_or_default(),
                row.total.to_string(),
                row.ok.to_string(),
                row.fail.to_string(),
                row.uncertain.to_string(),
                row.pending.to_string(),
                row.attachments.to_string(),
                row.message_length.to_string(),
                state_label(row.state).into(),
                row.job_id.clone(),
            ];
            csv_export::row(&mut csv, cells.iter().map(String::as_str));
        }
        csv
    }
}

fn state_label(state: BroadcastState) -> &'static str {
    match state {
        BroadcastState::Scheduled => "待定时启动",
        BroadcastState::Queued => "排队中",
        BroadcastState::Starting => "启动中",
        BroadcastState::Running => "发送中",
        BroadcastState::Paused => "已暂停",
        BroadcastState::Stopping => "停止中",
        BroadcastState::Completed => "已完成",
        BroadcastState::Stopped => "已停止",
        BroadcastState::Failed => "任务异常",
    }
}
