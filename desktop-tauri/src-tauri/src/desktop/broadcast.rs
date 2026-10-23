//! Composition for the independent broadcast owner. No job waits under Workspace.
use super::{platform_bridge::NativePlatform, platform_sessions::PlatformSessions};
use crate::{
    application::{
        broadcast::{now_ms, BroadcastService},
        broadcast_presets::BroadcastPresets,
        ports::BroadcastPlatform,
    },
    domain::{
        broadcast::{
            BroadcastAccount, BroadcastAction, BroadcastCapabilities, BroadcastDraft,
            BroadcastIssue, BroadcastJob, BroadcastSnapshot, BroadcastTarget, BroadcastVcard,
            GuestBinding,
        },
        broadcast_validation::valid_uuid,
        error::{AppError, Result},
    },
    infrastructure::{
        broadcast_preset_repository::EncryptedBroadcastPresetRepository,
        broadcast_repository::EncryptedBroadcastRepository,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use uuid::Uuid;

type NativeBroadcast = BroadcastService<EncryptedBroadcastRepository, NativePlatform>;
type NativeBroadcastPresets = BroadcastPresets<EncryptedBroadcastPresetRepository>;

mod attachments;
mod audiences;
mod catalog;
mod imports;
mod presets;
mod reports;
pub use attachments::PickedBroadcastAttachments;
pub use audiences::BroadcastAudienceSource;
pub use imports::{ImportedBroadcastContacts, ResolvedBroadcastRecipients};
pub use reports::ExportedBroadcastFailures;

#[cfg(test)]
mod attachment_tests;
#[cfg(test)]
mod tests;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogCapabilities {
    text: bool,
    scheduled: bool,
    vcards: bool,
    tag_all: bool,
    attachments: bool,
    #[serde(default)]
    group_members: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogLabel {
    id: String,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogChat {
    id: String,
    name: String,
    real_name: String,
    kind: ChatKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum ChatKind {
    Contact,
    Group,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeCatalog {
    capabilities: CatalogCapabilities,
    chats: Vec<CatalogChat>,
    #[serde(default)]
    labels: Option<Vec<CatalogLabel>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastCatalog {
    account_id: String,
    account_name: String,
    platform_id: String,
    catalog_id: String,
    ready: bool,
    reason_code: Option<BroadcastIssue>,
    capabilities: CatalogCapabilities,
    chats: Vec<CatalogChat>,
    labels: Option<Vec<CatalogLabel>>,
}

#[derive(Clone)]
struct CatalogLease {
    catalog: BroadcastCatalog,
    binding: GuestBinding,
    native_ids: HashSet<String>,
    imported: Vec<CatalogChat>,
    issued: Instant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBroadcast {
    id: String,
    account_id: String,
    catalog_id: String,
    recipient_ids: Vec<String>,
    vcard_ids: Vec<String>,
    #[serde(default)]
    attachment_ids: Vec<String>,
    message: String,
    tag_all: bool,
    interval_min: u64,
    interval_max: u64,
    scheduled_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedBroadcast {
    pub job_id: String,
    pub snapshot: BroadcastSnapshot,
}

pub struct BroadcastDesktop {
    service: NativeBroadcast,
    presets: Mutex<NativeBroadcastPresets>,
    platform: Arc<NativePlatform>,
    sessions: Arc<PlatformSessions>,
    catalogs: Mutex<Vec<CatalogLease>>,
    lifecycle: Mutex<()>,
    stopping: AtomicBool,
    picker: Mutex<()>,
    importing: Mutex<()>,
}

fn supported_id(id: &str, kind: ChatKind) -> bool {
    let Some((number, domain)) = id.split_once('@') else {
        return false;
    };
    let digits = |s: &str| !s.is_empty() && s.len() <= 30 && s.bytes().all(|c| c.is_ascii_digit());
    match kind {
        ChatKind::Contact => matches!(domain, "c.us" | "lid") && digits(number),
        ChatKind::Group => {
            domain == "g.us"
                && number.split_once('-').map_or_else(
                    || digits(number),
                    |(a, b)| digits(a) && digits(b) && b.len() <= 20,
                )
        }
    }
}

fn supported_catalog_id(platform: &str, id: &str, kind: ChatKind) -> bool {
    match platform {
        "whatsapp" | "whatsapp-pure" => supported_id(id, kind),
        "telegram-k" => {
            crate::domain::translation::valid_telegram_chat_id(id)
                && id.starts_with("tg:-") == (kind == ChatKind::Group)
        }
        _ => false,
    }
}

fn native_catalog(value: serde_json::Value, platform: &str) -> Result<NativeCatalog> {
    let mut result: NativeCatalog =
        serde_json::from_value(value).map_err(|_| AppError::BroadcastUnavailable)?;
    if result.chats.len() > 20_000 {
        return Err(AppError::BroadcastUnavailable);
    }
    catalog::validate_labels(&mut result.labels)?;
    let mut seen = HashSet::new();
    result
        .chats
        .retain(|chat| supported_catalog_id(platform, &chat.id, chat.kind));
    if platform == "telegram-k"
        && (result.capabilities.attachments
            || result.capabilities.tag_all
            || result.capabilities.vcards
            || result.capabilities.group_members
            || result.labels.is_some())
    {
        return Err(AppError::BroadcastUnavailable);
    }
    for chat in &mut result.chats {
        chat.name = chat
            .name
            .chars()
            .filter(|c| !c.is_control())
            .take(256)
            .collect();
        chat.real_name = chat
            .real_name
            .chars()
            .filter(|c| !c.is_control())
            .take(256)
            .collect();
        if !seen.insert(&chat.id) {
            return Err(AppError::BroadcastUnavailable);
        }
    }
    Ok(result)
}

fn same_intent(job: &BroadcastJob, input: &CreateBroadcast) -> bool {
    job.account_id == input.account_id
        && job.message == input.message
        && job.tag_all == input.tag_all
        && job.scheduled_at == input.scheduled_at
        && job.interval_min_ms == input.interval_min * 1_000
        && job.interval_max_ms == input.interval_max * 1_000
        && job
            .targets
            .iter()
            .map(|v| &v.id)
            .eq(input.recipient_ids.iter())
        && job.vcards.iter().map(|v| &v.id).eq(input.vcard_ids.iter())
        && job
            .attachments
            .iter()
            .map(|v| &v.id)
            .eq(input.attachment_ids.iter())
}

fn validate_create(input: &CreateBroadcast) -> Result<()> {
    if !valid_uuid(&input.id)
        || !valid_uuid(&input.account_id)
        || input.recipient_ids.len() > 2_000
        || input.vcard_ids.len() > 100
        || input.attachment_ids.len() > 10
        || input.attachment_ids.iter().any(|id| !valid_uuid(id))
        || input.attachment_ids.iter().collect::<HashSet<_>>().len() != input.attachment_ids.len()
        || input.interval_min < 5
        || input.interval_max > 60
        || input.interval_min > input.interval_max
    {
        return Err(AppError::BroadcastInvalid);
    }
    if input.message.len() > 32768 || input.recipient_ids.is_empty() {
        return Err(AppError::BroadcastInvalid);
    }
    if !input.attachment_ids.is_empty() && input.tag_all {
        return Err(AppError::BroadcastUnsupported);
    }
    Ok(())
}

fn frozen_draft(catalog: &BroadcastCatalog, input: &CreateBroadcast) -> Result<BroadcastDraft> {
    if catalog.account_id != input.account_id || !catalog.ready {
        return Err(AppError::BroadcastUnavailable);
    }
    if input.scheduled_at.is_some() && !catalog.capabilities.scheduled
        || input.tag_all && !catalog.capabilities.tag_all
        || !input.vcard_ids.is_empty() && !catalog.capabilities.vcards
        || !input.attachment_ids.is_empty() && !catalog.capabilities.attachments
    {
        return Err(AppError::BroadcastUnsupported);
    }
    let chats: HashMap<_, _> = catalog
        .chats
        .iter()
        .map(|chat| (chat.id.as_str(), chat))
        .collect();
    let targets = input
        .recipient_ids
        .iter()
        .map(|id| {
            let chat = chats.get(id.as_str()).ok_or(AppError::BroadcastInvalid)?;
            Ok(BroadcastTarget {
                id: chat.id.clone(),
                name: chat.name.clone(),
                real_name: chat.real_name.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let vcards = input
        .vcard_ids
        .iter()
        .map(|id| {
            let chat = chats
                .get(id.as_str())
                .filter(|chat| chat.kind == ChatKind::Contact)
                .ok_or(AppError::BroadcastInvalid)?;
            Ok(BroadcastVcard {
                id: chat.id.clone(),
                name: chat.name.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(BroadcastDraft {
        id: input.id.clone(),
        account_id: input.account_id.clone(),
        targets,
        vcards,
        attachments: Vec::new(), // Resolved by the native owner immediately before submit.
        message: input.message.clone(),
        tag_all: input.tag_all,
        scheduled_at: input.scheduled_at,
        interval_min_ms: input.interval_min * 1_000,
        interval_max_ms: input.interval_max * 1_000,
    })
}

impl BroadcastDesktop {
    pub fn new(
        repository: EncryptedBroadcastRepository,
        preset_repository: EncryptedBroadcastPresetRepository,
        platform: Arc<NativePlatform>,
        sessions: Arc<PlatformSessions>,
    ) -> Result<Self> {
        Ok(Self {
            service: BroadcastService::open(repository, Arc::clone(&platform))?,
            presets: Mutex::new(BroadcastPresets::open(preset_repository)?),
            platform,
            sessions,
            catalogs: Mutex::new(Vec::new()),
            lifecycle: Mutex::new(()),
            stopping: AtomicBool::new(false),
            picker: Mutex::new(()),
            importing: Mutex::new(()),
        })
    }

    pub fn start(self: &Arc<Self>) -> Result<()> {
        let owner = Arc::clone(self);
        std::thread::Builder::new()
            .name("geek-broadcast-scheduler".into())
            .spawn(move || {
                while !owner.stopping.load(Ordering::Acquire) {
                    if let Ok(_lifecycle) = owner.lifecycle.lock() {
                        if owner.drain_lifecycle().is_ok() {
                            let _ = owner.service.tick(now_ms());
                        }
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
            })
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(())
    }

    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::Release);
        let _ = self.service.shutdown();
    }

    fn drain_lifecycle(&self) -> Result<()> {
        // Failed writes stay queued. A reopened account's new job is admitted
        // only after the old close intent has been applied, never stopped later
        // by a delayed event carrying only that same account UUID.
        let mut failed = false;
        for (id, token) in self.sessions.pending_invalidations() {
            if self.service.invalidate_account(&id, now_ms()).is_ok() {
                self.sessions.acknowledge_invalidated(&id, &token);
            } else {
                failed = true;
            }
        }
        if failed {
            return Err(AppError::BroadcastPersistence);
        }
        if !self.sessions.pending_invalidations().is_empty() {
            return Err(AppError::BroadcastUnavailable);
        }
        Ok(())
    }

    pub fn snapshot(&self) -> Result<BroadcastSnapshot> {
        self.service.snapshot()
    }

    pub fn control(&self, id: &str, action: BroadcastAction) -> Result<BroadcastSnapshot> {
        self.service.control(id, action, now_ms())?;
        self.snapshot()
    }

    pub fn create(&self, input: CreateBroadcast) -> Result<CreatedBroadcast> {
        validate_create(&input)?;
        let _lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        self.drain_lifecycle()?;
        // A lost create reply must remain retryable after schedule time, catalog expiry,
        // account closure or a rename. The immutable semantic intent must still match.
        let snapshot = self.snapshot()?;
        if let Some(job) = snapshot.jobs.iter().find(|job| job.id == input.id) {
            if !same_intent(job, &input) {
                return Err(AppError::BroadcastConflict);
            }
            return Ok(CreatedBroadcast {
                job_id: input.id,
                snapshot,
            });
        }
        let (catalog, binding) = {
            let catalogs = self
                .catalogs
                .lock()
                .map_err(|_| AppError::StateUnavailable)?;
            let lease = catalogs
                .iter()
                .find(|lease| {
                    lease.catalog.catalog_id == input.catalog_id
                        && lease.catalog.account_id == input.account_id
                        && lease.catalog.ready
                        && lease.issued.elapsed() < Duration::from_secs(1800)
                })
                .ok_or(AppError::BroadcastUnavailable)?;
            (lease.catalog.clone(), lease.binding.clone())
        };
        if !self.sessions.valid(&binding) {
            return Err(AppError::BroadcastUnavailable);
        }
        let account = self
            .platform
            .account(&input.account_id)
            .map_err(|_| AppError::AccountUnknown)?;
        if account.platform_id != binding.platform_id {
            return Err(AppError::BroadcastUnavailable);
        }
        let mut draft = frozen_draft(&catalog, &input)?;
        draft.attachments = self.service.resolve_attachments(
            &input.account_id,
            &input.id,
            &input.attachment_ids,
        )?;
        let job = self.service.submit(
            BroadcastAccount {
                id: account.id,
                name: account.name,
                platform_id: account.platform_id,
                capabilities: BroadcastCapabilities {
                    text: catalog.capabilities.text,
                    tag_all: catalog.capabilities.tag_all,
                    vcards: catalog.capabilities.vcards,
                    attachments: catalog.capabilities.attachments,
                },
            },
            draft,
            now_ms(),
        )?;
        Ok(CreatedBroadcast {
            job_id: job.id,
            snapshot: self.snapshot()?,
        })
    }
}
