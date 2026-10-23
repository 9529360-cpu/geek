//! Cancellable display and SendIntent transforms. This owner never selects a chat or sends.
use super::{
    ports::{TranslationCacheClock, TranslationCacheRepository},
    request_control::RequestControl,
    session::{SessionLease, SessionService},
    session_ports::{SessionRepository, SessionTransport},
    translation_cache::{DisplayCacheKey, DisplayTranslationCache},
    translation_ports::{
        OutgoingTranslation, TranslationGateway, TranslationIntent, TranslationRequest,
    },
};
use crate::domain::{
    account::Account,
    error::{AppError, Result},
    proxy::ProxyConfig,
    session::SessionToken,
    translation::{
        receive_requires_group_auto, supports_receive, valid_send_chat_id, validate_send_text,
        IncomingTranslation,
    },
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    sync::{atomic::AtomicU64, atomic::Ordering, Arc, Mutex, TryLockError},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const CACHE_BYTES: usize = 1024 * 1024;
const CACHE_ENTRIES: usize = 256;

#[derive(Clone)]
pub struct PreparedTranslation {
    pub account: Account,
    pub incoming: IncomingTranslation,
    pub lease: SessionLease,
    pub control: RequestControl,
    request: TranslationRequest,
    cache_key: [u8; 32],
    display_cache_key: Option<DisplayCacheKey>,
    cache_sequence: u64,
}

#[derive(Clone)]
pub struct PreparedOutgoingTranslation {
    pub account: Account,
    pub lease: SessionLease,
    pub control: RequestControl,
    request: TranslationRequest,
    cache_key: [u8; 32],
}

/// A borrowed execution view shares transport/auth/cache without conflating admission.
struct TransformWork<'a> {
    account: &'a Account,
    lease: &'a SessionLease,
    control: &'a RequestControl,
    request: &'a TranslationRequest,
    cache_key: &'a [u8; 32],
    display_cache_key: Option<&'a DisplayCacheKey>,
    cache_sequence: Option<u64>,
    refresh: bool,
}

struct TokenEntry {
    generation: String,
    proxy: ProxyConfig,
    token: SessionToken,
    expires: Instant,
}

struct CacheEntry {
    key: [u8; 32],
    text: String,
    expires: Instant,
    sequence: Option<u64>,
}

type TokenSlot = Arc<Mutex<Option<TokenEntry>>>;

pub struct TranslationService<R: SessionRepository, T: SessionTransport, G: TranslationGateway> {
    session: Arc<SessionService<R, T>>,
    gateway: Arc<G>,
    tokens: Mutex<HashMap<String, TokenSlot>>,
    cache: Mutex<VecDeque<CacheEntry>>,
    display_cache: Option<DisplayTranslationCache>,
    cache_sequence: AtomicU64,
    auto_after: u64,
}

impl<R: SessionRepository, T: SessionTransport, G: TranslationGateway> TranslationService<R, T, G> {
    pub fn new(session: Arc<SessionService<R, T>>, gateway: Arc<G>) -> Self {
        Self {
            session,
            gateway,
            tokens: Mutex::new(HashMap::new()),
            cache: Mutex::new(VecDeque::new()),
            display_cache: None,
            cache_sequence: AtomicU64::new(1),
            auto_after: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|t| t.as_secs() + 1)
                .unwrap_or(u64::MAX),
        }
    }

    /// Cache failure is optional capability loss, never an authentication/startup failure.
    pub fn new_with_cache(
        session: Arc<SessionService<R, T>>,
        gateway: Arc<G>,
        repository: Box<dyn TranslationCacheRepository>,
        clock: Arc<dyn TranslationCacheClock>,
    ) -> Self {
        let mut service = Self::new(session, gateway);
        service.display_cache = Some(DisplayTranslationCache::open(repository, clock));
        service
    }

    pub fn auto_after(&self) -> u64 {
        self.auto_after
    }

    /// Capture the subscription lease and absolute budget before desktop queuing.
    pub fn prepare(
        &self,
        account: Account,
        incoming: IncomingTranslation,
    ) -> Result<PreparedTranslation> {
        let control = RequestControl::new(Duration::from_secs(35));
        if account.archived || !supports_receive(&account.platform_id) {
            return Err(AppError::TranslationUnavailable);
        }
        incoming.validate_for_platform(&account.platform_id)?;
        let policy = account.translation.policy(&incoming.chat_id);
        policy.validate_for_platform(&account.platform_id)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|time| time.as_secs())
            .unwrap_or(0);
        if incoming.policy_revision != account.translation.revision
            || !policy.display_translation
            || (incoming.manual && !policy.message_action)
            || (incoming.refresh && !incoming.manual)
            || (!incoming.manual
                && (policy.translation_mode != "auto"
                    || incoming.sent_at < self.auto_after
                    || incoming.sent_at > now.saturating_add(60)
                    || (policy.message_target == "zh"
                        && incoming
                            .text
                            .chars()
                            .any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)))
                    || (receive_requires_group_auto(&incoming.chat_id) && !policy.group_auto)))
        {
            return Err(AppError::TranslationUnavailable);
        }
        let lease = self.session.capture_lease()?;
        let request = TranslationRequest {
            id: incoming.id.clone(),
            intent: TranslationIntent::MessageDisplay,
            text: incoming.text.clone(),
            source: policy.message_from.clone(),
            target: policy.message_target.clone(),
            provider: policy.provider.clone(),
            route: policy.route.clone(),
        };
        let cache_key = transform_cache_key(
            &lease,
            &account,
            &incoming.chat_id,
            &incoming.message_id,
            &request,
        );
        let cache_sequence = self
            .cache_sequence
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map_err(|_| AppError::TranslationLimit)?;
        let display_cache_key = self.display_cache.as_ref().map(|cache| {
            cache.key(
                &account,
                &lease,
                &incoming.chat_id,
                &incoming.message_id,
                &request,
                cache_sequence,
            )
        });
        let control = control.with_cancel(Arc::clone(&lease.cancel));
        Ok(PreparedTranslation {
            account,
            incoming,
            lease,
            control,
            request,
            cache_key,
            display_cache_key,
            cache_sequence,
        })
    }

    /// SendIntent supplies its existing budget; preparation never grants more time.
    /// Identity sends are admitted and executed by SendIntent without this service.
    pub fn prepare_outgoing(
        &self,
        account: Account,
        outgoing: OutgoingTranslation,
        control: RequestControl,
    ) -> Result<PreparedOutgoingTranslation> {
        let control = control.limited(Duration::from_secs(35));
        control.check()?;
        outgoing.validate()?;
        if account.archived || !valid_send_chat_id(&account.platform_id, &outgoing.chat_id) {
            return Err(AppError::TranslationUnavailable);
        }
        validate_send_text(&account.platform_id, &outgoing.text)?;
        let policy = account.translation.policy(&outgoing.chat_id);
        policy.validate()?;
        if outgoing.policy_revision != account.translation.revision
            || !policy.should_translate_outgoing(&outgoing.text)
        {
            return Err(AppError::TranslationUnavailable);
        }
        let lease = self.session.capture_lease()?;
        let request = TranslationRequest {
            id: outgoing.id.clone(),
            intent: TranslationIntent::OutgoingSend,
            text: outgoing.text.clone(),
            source: policy.source.clone(),
            target: policy.target.clone(),
            provider: policy.provider.clone(),
            route: policy.route.clone(),
        };
        // Separate sends must never coalesce, even with identical source text.
        let cache_key =
            transform_cache_key(&lease, &account, &outgoing.chat_id, &outgoing.id, &request);
        let control = control.with_cancel(Arc::clone(&lease.cancel));
        control.check()?;
        Ok(PreparedOutgoingTranslation {
            account,
            lease,
            control,
            request,
            cache_key,
        })
    }

    fn current(&self, work: &TransformWork<'_>) -> Result<()> {
        work.control.check()?;
        self.session.validate_lease(work.lease)
    }

    fn auth_result<U>(&self, work: &TransformWork<'_>, result: Result<U>) -> Result<U> {
        match result {
            Err(error @ (AppError::SessionRequired | AppError::SessionAccountDisabled)) => {
                self.session.reject_auth(work.lease, error)?;
                Err(error)
            }
            result => result,
        }
    }

    fn authorize_quota(&self, work: &TransformWork<'_>) -> Result<()> {
        self.current(work)?;
        let quota = match self.session.authoritative_quota(work.lease)? {
            Some(value) => value,
            None => {
                let result = self.gateway.quota(
                    work.lease.token.as_str(),
                    &work.account.proxy,
                    work.control,
                );
                let value = self.auth_result(work, result)?;
                self.current(work)?;
                self.session.accept_quota(work.lease, Some(value))?;
                self.session
                    .authoritative_quota(work.lease)?
                    .ok_or(AppError::SessionChanged)?
            }
        };
        if quota == 0 {
            return Err(AppError::TranslationQuotaExhausted);
        }
        Ok(())
    }

    /// Single-flight token acquisition is scoped to this account and subscription.
    /// The lock is never the account/workspace or subscription authority mutex.
    fn token(&self, work: &TransformWork<'_>, force: bool) -> Result<SessionToken> {
        let slot = {
            let mut slots = self.tokens.lock().map_err(|_| AppError::StateUnavailable)?;
            if slots.len() >= 20 && !slots.contains_key(&work.account.id) {
                return Err(AppError::TranslationLimit);
            }
            Arc::clone(slots.entry(work.account.id.clone()).or_default())
        };
        let mut entry = loop {
            self.current(work)?;
            match slot.try_lock() {
                Ok(entry) => break entry,
                Err(TryLockError::Poisoned(_)) => return Err(AppError::StateUnavailable),
                Err(TryLockError::WouldBlock) => work.control.wait(Duration::from_millis(25))?,
            }
        };
        if !force {
            if let Some(existing) = entry.as_ref().filter(|entry| {
                entry.generation == work.lease.generation
                    && entry.proxy == work.account.proxy
                    && entry.expires > Instant::now() + Duration::from_secs(30)
            }) {
                return Ok(existing.token.clone());
            }
        }
        let response = self.gateway.translation_token(
            work.lease.token.as_str(),
            &work.account.proxy,
            work.control,
        );
        let response = self.auth_result(work, response)?;
        self.current(work)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::NetworkResponseInvalid)?
            .as_secs();
        let ttl = response
            .expires_at
            .checked_sub(now)
            .filter(|ttl| *ttl > 0 && *ttl <= 330)
            .ok_or(AppError::NetworkResponseInvalid)?;
        let token = response.token.clone();
        *entry = Some(TokenEntry {
            generation: work.lease.generation.clone(),
            proxy: work.account.proxy.clone(),
            token: response.token,
            expires: Instant::now() + Duration::from_secs(ttl.min(300)),
        });
        Ok(token)
    }

    fn cached(&self, key: &[u8; 32]) -> Result<Option<String>> {
        let mut cache = self.cache.lock().map_err(|_| AppError::StateUnavailable)?;
        cache.retain(|entry| entry.expires > Instant::now());
        Ok(cache
            .iter()
            .find(|entry| &entry.key == key)
            .map(|entry| entry.text.clone()))
    }

    fn remember(&self, key: [u8; 32], text: &str, sequence: Option<u64>) -> Result<()> {
        let mut cache = self.cache.lock().map_err(|_| AppError::StateUnavailable)?;
        if let Some(sequence) = sequence {
            if cache.iter().any(|entry| {
                entry.key == key && entry.sequence.is_some_and(|previous| previous > sequence)
            }) {
                return Ok(());
            }
        }
        cache.retain(|entry| entry.expires > Instant::now() && entry.key != key);
        let mut bytes = cache.iter().map(|entry| entry.text.len()).sum::<usize>();
        while bytes.saturating_add(text.len()) > CACHE_BYTES || cache.len() >= CACHE_ENTRIES {
            let Some(old) = cache.pop_front() else {
                break;
            };
            bytes -= old.text.len();
        }
        if text.len() <= CACHE_BYTES {
            cache.push_back(CacheEntry {
                key,
                text: text.to_owned(),
                expires: Instant::now() + Duration::from_secs(900),
                sequence,
            });
        }
        Ok(())
    }

    pub fn execute(&self, work: &PreparedTranslation) -> Result<String> {
        self.execute_transform(&TransformWork {
            account: &work.account,
            lease: &work.lease,
            control: &work.control,
            request: &work.request,
            cache_key: &work.cache_key,
            display_cache_key: work.display_cache_key.as_ref(),
            cache_sequence: Some(work.cache_sequence),
            refresh: work.incoming.refresh,
        })
    }

    pub fn execute_outgoing(&self, work: &PreparedOutgoingTranslation) -> Result<String> {
        self.execute_transform(&TransformWork {
            account: &work.account,
            lease: &work.lease,
            control: &work.control,
            request: &work.request,
            cache_key: &work.cache_key,
            display_cache_key: None,
            cache_sequence: None,
            refresh: false,
        })
    }

    fn execute_transform(&self, work: &TransformWork<'_>) -> Result<String> {
        self.authorize_quota(work)?; // A cache hit still requires a fresh positive server balance.
        if !work.refresh {
            if let Some(text) = self.cached(work.cache_key)? {
                self.current(work)?;
                return Ok(text);
            }
            if let (Some(cache), Some(key)) = (&self.display_cache, work.display_cache_key) {
                if let Some(text) = cache.lookup(key, work.control)? {
                    self.current(work)?;
                    // Do not renew a nearly expired durable result with a 15-minute memory TTL.
                    return Ok(text);
                }
            }
        }
        let mut token = self.token(work, false)?;
        let mut refreshed = false;
        let reply = loop {
            self.current(work)?;
            let result = self.gateway.translate(
                token.as_str(),
                work.request,
                &work.account.proxy,
                work.control,
            );
            match result {
                Err(AppError::TranslationInProgress) => {
                    work.control.wait(Duration::from_millis(400))?
                }
                Err(AppError::TranslationUnauthorized) if !refreshed => {
                    refreshed = true;
                    token = self.token(work, true)?;
                }
                Err(AppError::TranslationQuotaExhausted) => {
                    self.current(work)?;
                    self.session.accept_quota(work.lease, Some(0))?;
                    return Err(AppError::TranslationQuotaExhausted);
                }
                result => break self.auth_result(work, result)?,
            }
        };
        self.current(work)?;
        // Server billing is final, including a success whose balance lookup was null.
        self.session
            .accept_quota(work.lease, reply.remaining_chars)?;
        if reply.text.trim().is_empty() || reply.text.len() > 128 * 1024 {
            return Err(AppError::TranslationOutputInvalid);
        }
        self.current(work)?;
        self.remember(*work.cache_key, &reply.text, work.cache_sequence)?;
        if let (Some(cache), Some(key)) = (&self.display_cache, work.display_cache_key) {
            cache.remember(key, &reply.text, work.control);
            self.current(work)?;
        }
        Ok(reply.text)
    }
}

fn transform_cache_key(
    lease: &SessionLease,
    account: &Account,
    chat_id: &str,
    operation_id: &str,
    request: &TranslationRequest,
) -> [u8; 32] {
    // Length-prefix components so source text cannot collide with separators.
    let mut digest = Sha256::new();
    for component in [
        request.intent.as_str(),
        &lease.generation,
        &account.id,
        chat_id,
        operation_id,
        &request.text,
        &request.source,
        &request.target,
        &request.provider,
        &request.route,
    ] {
        digest.update((component.len() as u64).to_le_bytes());
        digest.update(component.as_bytes());
    }
    digest.finalize().into()
}
