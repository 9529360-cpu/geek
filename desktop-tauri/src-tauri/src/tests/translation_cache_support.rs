use super::{
    session_support::{FakeSessionTransport, Gate, Service},
    translation_support::{self, Engine, FakeGateway, Harness},
};
use crate::{
    application::translation_ports::{TranslationCacheClock, TranslationCacheRepository},
    domain::{
        error::{AppError, Result},
        translation_cache::TranslationCacheDocument,
    },
};
use std::{
    ops::Deref,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

pub const WALL_NOW: u64 = 1_800_000_000;

#[derive(Default)]
pub struct CacheState {
    pub document: Option<TranslationCacheDocument>,
    pub load_error: Option<AppError>,
    pub fail_next: bool,
    pub save_gate: Option<Arc<Gate>>,
    pub loads: usize,
    pub attempts: usize,
    pub writes: usize,
}

#[derive(Clone, Default)]
pub struct MemoryCacheRepository(pub Arc<Mutex<CacheState>>);

impl TranslationCacheRepository for MemoryCacheRepository {
    fn load(&self) -> Result<Option<TranslationCacheDocument>> {
        let mut state = self.0.lock().unwrap();
        state.loads += 1;
        if let Some(error) = state.load_error {
            return Err(error);
        }
        Ok(state.document.clone())
    }

    fn save(&mut self, document: &TranslationCacheDocument) -> Result<()> {
        let gate = {
            let mut state = self.0.lock().unwrap();
            state.attempts += 1;
            state.save_gate.take()
        };
        // Hold no test-state mutex while blocked, just as native I/O owns no session lock.
        if let Some(gate) = gate {
            gate.pass();
        }
        let mut state = self.0.lock().unwrap();
        if state.fail_next {
            state.fail_next = false;
            return Err(AppError::StoreIo);
        }
        state.document = Some(document.clone());
        state.writes += 1;
        Ok(())
    }
}

pub struct FakeCacheClock {
    now: AtomicU64,
    pub next_gate: Mutex<Option<Arc<Gate>>>,
}

impl FakeCacheClock {
    pub fn set(&self, now: u64) {
        self.now.store(now, Ordering::Release);
    }
}

impl Default for FakeCacheClock {
    fn default() -> Self {
        Self {
            now: AtomicU64::new(WALL_NOW),
            next_gate: Mutex::new(None),
        }
    }
}

impl TranslationCacheClock for FakeCacheClock {
    fn now_secs(&self) -> u64 {
        let gate = self.next_gate.lock().unwrap().take();
        if let Some(gate) = gate {
            gate.pass();
        }
        self.now.load(Ordering::Acquire)
    }
}

pub struct CacheHarness {
    pub runtime: Harness,
    pub cache: MemoryCacheRepository,
    pub wall: Arc<FakeCacheClock>,
}

impl Deref for CacheHarness {
    type Target = Harness;

    fn deref(&self) -> &Self::Target {
        &self.runtime
    }
}

pub fn setup() -> CacheHarness {
    let mut runtime = translation_support::setup();
    let cache = MemoryCacheRepository::default();
    let wall = Arc::new(FakeCacheClock::default());
    runtime.engine = Arc::new(Engine::new_with_cache(
        Arc::clone(&runtime.session),
        Arc::clone(&runtime.gateway),
        Box::new(cache.clone()),
        wall.clone(),
    ));
    CacheHarness {
        runtime,
        cache,
        wall,
    }
}

/// Reopen both real owners from durable port state; quota authority must not survive.
pub fn restart(previous: &CacheHarness) -> CacheHarness {
    let repository = previous.repository.clone();
    let auth = Arc::new(FakeSessionTransport::default());
    let clock = Arc::clone(&previous.clock);
    let session = Arc::new(
        Service::open_with_clock(repository.clone(), Arc::clone(&auth), clock.clone()).unwrap(),
    );
    let gateway = Arc::new(FakeGateway::default());
    let cache = previous.cache.clone();
    let wall = Arc::clone(&previous.wall);
    let engine = Arc::new(Engine::new_with_cache(
        Arc::clone(&session),
        Arc::clone(&gateway),
        Box::new(cache.clone()),
        wall.clone(),
    ));
    CacheHarness {
        runtime: Harness {
            session,
            repository,
            auth,
            clock,
            gateway,
            engine,
        },
        cache,
        wall,
    }
}
