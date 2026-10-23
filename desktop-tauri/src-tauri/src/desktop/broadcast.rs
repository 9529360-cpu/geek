//! Composition for the independent broadcast owner. No job waits under Workspace.
use super::{platform_bridge::NativePlatform, platform_sessions::PlatformSessions};
use crate::{
    application::{
        broadcast::{now_ms, BroadcastService},
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
    infrastructure::broadcast_repository::EncryptedBroadcastRepository,
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
}

struct CatalogLease {
    catalog: BroadcastCatalog,
    binding: GuestBinding,
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
    platform: Arc<NativePlatform>,
    sessions: Arc<PlatformSessions>,
    catalogs: Mutex<Vec<CatalogLease>>,
    lifecycle: Mutex<()>,
    stopping: AtomicBool,
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

fn native_catalog(value: serde_json::Value) -> Result<NativeCatalog> {
    let mut result: NativeCatalog =
        serde_json::from_value(value).map_err(|_| AppError::BroadcastUnavailable)?;
    if result.chats.len() > 20_000 || result.capabilities.attachments {
        return Err(AppError::BroadcastUnavailable);
    }
    let mut seen = HashSet::new();
    result
        .chats
        .retain(|chat| supported_id(&chat.id, chat.kind));
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
}

fn validate_create(input: &CreateBroadcast) -> Result<()> {
    if !valid_uuid(&input.id)
        || !valid_uuid(&input.account_id)
        || input.recipient_ids.len() > 2_000
        || input.vcard_ids.len() > 100
        || input.interval_min < 5
        || input.interval_max > 60
        || input.interval_min > input.interval_max
    {
        return Err(AppError::BroadcastInvalid);
    }
    if input.message.len() > 32768 || input.recipient_ids.is_empty() {
        return Err(AppError::BroadcastInvalid);
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
        platform: Arc<NativePlatform>,
        sessions: Arc<PlatformSessions>,
    ) -> Result<Self> {
        Ok(Self {
            service: BroadcastService::open(repository, Arc::clone(&platform))?,
            platform,
            sessions,
            catalogs: Mutex::new(Vec::new()),
            lifecycle: Mutex::new(()),
            stopping: AtomicBool::new(false),
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

    pub fn catalog(&self, account_id: &str) -> Result<BroadcastCatalog> {
        if !valid_uuid(account_id) {
            return Err(AppError::BroadcastInvalid);
        }
        let account = self
            .platform
            .account(account_id)
            .map_err(|_| AppError::AccountUnknown)?;
        let mut result = BroadcastCatalog {
            account_id: account.id.clone(),
            account_name: account.name,
            platform_id: account.platform_id.clone(),
            catalog_id: String::new(),
            ready: false,
            reason_code: None,
            capabilities: CatalogCapabilities::default(),
            chats: Vec::new(),
        };
        let binding = match self
            .platform
            .acquire_binding(account_id, &account.platform_id)
        {
            Ok(binding) => binding,
            Err(code) => {
                result.reason_code = Some(code);
                return Ok(result);
            }
        };
        let value = match self.platform.catalog(&binding) {
            Ok(value) => value,
            Err(code) => {
                result.reason_code = Some(code);
                return Ok(result);
            }
        };
        if !self.sessions.valid(&binding) {
            return Err(AppError::BroadcastUnavailable);
        }
        let native = native_catalog(value)?;
        result.catalog_id = Uuid::new_v4().to_string();
        result.capabilities = native.capabilities;
        result.chats = native.chats;
        result.ready = result.capabilities.text;
        if !result.ready {
            result.reason_code = Some(BroadcastIssue::CapabilityUnavailable);
        }
        let mut catalogs = self
            .catalogs
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        catalogs.retain(|lease| lease.issued.elapsed() < Duration::from_secs(1800));
        if catalogs
            .iter()
            .filter(|lease| lease.catalog.account_id == account_id)
            .count()
            >= 2
        {
            if let Some(index) = catalogs
                .iter()
                .position(|lease| lease.catalog.account_id == account_id)
            {
                catalogs.remove(index);
            }
        }
        if catalogs.len() >= 40 {
            catalogs.remove(0);
        }
        catalogs.push(CatalogLease {
            catalog: result.clone(),
            binding,
            issued: Instant::now(),
        });
        Ok(result)
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
        let draft = frozen_draft(&catalog, &input)?;
        let job = self.service.submit(
            BroadcastAccount {
                id: account.id,
                name: account.name,
                platform_id: account.platform_id,
                capabilities: BroadcastCapabilities {
                    text: catalog.capabilities.text,
                    tag_all: catalog.capabilities.tag_all,
                    vcards: catalog.capabilities.vcards,
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
