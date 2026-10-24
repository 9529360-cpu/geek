//! Immutable broadcast inputs and durable progress. No guest, clock or I/O ownership.
use super::{
    broadcast_attachment::{BroadcastAttachment, BroadcastAttachmentSource},
    error::{AppError, Result},
};
use serde::{Deserialize, Serialize};

pub const MAX_JOBS: usize = 100;
pub const MAX_RETIRED_IDS: usize = 10_000;
pub const MAX_TARGETS: usize = 2_000;
pub const MAX_STORE_BYTES: usize = 2 * 1024 * 1024 - 4_096;
pub const MAX_WORKERS: usize = 4;
pub const MAX_PREPARE_ATTEMPTS: u8 = 20;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastTarget {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub real_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastVcard {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastCapabilities {
    pub text: bool,
    pub tag_all: bool,
    pub vcards: bool,
    #[serde(default)]
    pub attachments: bool,
}

/// The desktop owner supplies these fields from authoritative account metadata.
#[derive(Clone, Debug)]
pub struct BroadcastAccount {
    pub id: String,
    pub name: String,
    pub platform_id: String,
    pub capabilities: BroadcastCapabilities,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastDraft {
    pub id: String,
    pub account_id: String,
    pub targets: Vec<BroadcastTarget>,
    pub message: String,
    pub tag_all: bool,
    pub vcards: Vec<BroadcastVcard>,
    #[serde(default)]
    pub attachments: Vec<BroadcastAttachment>,
    pub interval_min_ms: u64,
    pub interval_max_ms: u64,
    pub scheduled_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuestBinding {
    pub account_id: String,
    pub platform_id: String,
    pub generation: String,
}

#[derive(Clone, Debug)]
pub struct DispatchRequest {
    pub job_id: String,
    pub attempt_id: String,
    pub target_id: String,
    pub rendered_text: String,
    pub tag_all: bool,
    pub vcards: Vec<BroadcastVcard>,
    pub attachments: Vec<BroadcastAttachmentSource>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BroadcastIssue {
    AccountUnavailable,
    CapabilityUnavailable,
    GuestChanged,
    TargetChanged,
    ComposerMismatch,
    NotSubmitted,
    ReceiptMissing,
    TimedOut,
    Interrupted,
    InterruptedUncertain,
    Cancelled,
    PersistenceFailed,
    ScheduleAccountUnavailable,
    RuntimeFailed,
    AttachmentUnavailable,
    AttachmentChanged,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum DispatchOutcome {
    Confirmed { receipt: String },
    NotSubmitted { code: BroadcastIssue },
    Uncertain { code: BroadcastIssue },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastResult {
    pub index: usize,
    pub at: u64,
    pub outcome: DispatchOutcome,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BroadcastState {
    Scheduled,
    Queued,
    Starting,
    Running,
    Paused,
    Stopping,
    Completed,
    Stopped,
    Failed,
}

impl BroadcastState {
    pub fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Stopped | Self::Failed)
    }

    pub fn owns_account(self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Running | Self::Paused | Self::Stopping
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BroadcastAction {
    Pause,
    Resume,
    Stop,
    Dismiss,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DispatchCheckpoint {
    pub attempt_id: String,
    pub index: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedMessage {
    pub index: usize,
    pub rendered_text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastJob {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub platform_id: String,
    pub targets: Vec<BroadcastTarget>,
    pub message: String,
    pub tag_all: bool,
    pub vcards: Vec<BroadcastVcard>,
    #[serde(default)]
    pub attachments: Vec<BroadcastAttachment>,
    pub interval_min_ms: u64,
    pub interval_max_ms: u64,
    pub scheduled_at: Option<u64>,
    pub state: BroadcastState,
    pub current: usize,
    pub total: usize,
    pub ok: usize,
    pub fail: usize,
    pub uncertain: usize,
    pub results: Vec<BroadcastResult>,
    pub next_send_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub review_required: bool,
    pub last_issue: Option<BroadcastIssue>,
    pub dismissed: bool,
    pub prepare_attempts: u8,
    pub binding: Option<GuestBinding>,
    pub checkpoint: Option<DispatchCheckpoint>,
    pub prepared: Option<PreparedMessage>,
    /// A snapshot-only projection; never a claim that failed persistence committed.
    #[serde(default)]
    pub storage_blocked: bool,
}

impl BroadcastJob {
    pub fn draft(&self) -> BroadcastDraft {
        BroadcastDraft {
            id: self.id.clone(),
            account_id: self.account_id.clone(),
            targets: self.targets.clone(),
            message: self.message.clone(),
            tag_all: self.tag_all,
            vcards: self.vcards.clone(),
            attachments: self.attachments.clone(),
            interval_min_ms: self.interval_min_ms,
            interval_max_ms: self.interval_max_ms,
            scheduled_at: self.scheduled_at,
        }
    }

    pub fn from_draft(account: &BroadcastAccount, draft: BroadcastDraft, now: u64) -> Self {
        let total = draft.targets.len();
        Self {
            id: draft.id,
            account_id: draft.account_id,
            account_name: account.name.clone(),
            platform_id: account.platform_id.clone(),
            targets: draft.targets,
            message: draft.message,
            tag_all: draft.tag_all,
            vcards: draft.vcards,
            attachments: draft.attachments,
            interval_min_ms: draft.interval_min_ms,
            interval_max_ms: draft.interval_max_ms,
            scheduled_at: draft.scheduled_at,
            state: if draft.scheduled_at.is_some_and(|at| at > now) {
                BroadcastState::Scheduled
            } else {
                BroadcastState::Queued
            },
            current: 0,
            total,
            ok: 0,
            fail: 0,
            uncertain: 0,
            results: Vec::new(),
            next_send_at: None,
            created_at: now,
            updated_at: now,
            started_at: None,
            finished_at: None,
            review_required: false,
            last_issue: None,
            dismissed: false,
            prepare_attempts: 0,
            binding: None,
            checkpoint: None,
            prepared: None,
            storage_blocked: false,
        }
    }

    pub fn record(&mut self, outcome: DispatchOutcome, now: u64) {
        match &outcome {
            DispatchOutcome::Confirmed { .. } => self.ok += 1,
            DispatchOutcome::NotSubmitted { code } => {
                self.fail += 1;
                self.last_issue = Some(*code);
            }
            DispatchOutcome::Uncertain { code } => {
                self.uncertain += 1;
                self.last_issue = Some(*code);
            }
        }
        self.results.push(BroadcastResult {
            index: self.current,
            at: now,
            outcome,
        });
        self.current += 1;
        self.checkpoint = None;
        self.prepared = None;
        self.updated_at = now;
    }

    pub fn finish(&mut self, state: BroadcastState, now: u64) {
        self.state = state;
        self.finished_at = Some(now);
        self.updated_at = now;
        self.next_send_at = None;
        self.prepared = None;
    }

    /// Lost dispatch evidence is never replayed. Explicit resume skips this target.
    pub fn interrupt(&mut self, now: u64, issue: BroadcastIssue) {
        if self.checkpoint.is_some() {
            self.record(DispatchOutcome::Uncertain { code: issue }, now);
        }
        self.state = BroadcastState::Paused;
        self.review_required = true;
        self.last_issue = Some(issue);
        self.binding = None;
        self.next_send_at = None;
        self.updated_at = now;
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub jobs: Vec<BroadcastJob>,
    #[serde(default)]
    pub retired_ids: Vec<String>,
    #[serde(default)]
    pub attachment_sources: Vec<BroadcastAttachmentSource>,
}

impl Default for BroadcastDocument {
    fn default() -> Self {
        Self {
            schema_version: 2,
            revision: 0,
            jobs: Vec::new(),
            retired_ids: Vec::new(),
            attachment_sources: Vec::new(),
        }
    }
}

impl BroadcastDocument {
    pub fn index(&self, id: &str) -> Result<usize> {
        self.jobs
            .iter()
            .position(|job| job.id == id)
            .ok_or(AppError::BroadcastUnknown)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastSnapshot {
    pub revision: u64,
    pub jobs: Vec<BroadcastJob>,
}
