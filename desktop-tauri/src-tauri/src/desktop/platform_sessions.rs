//! Native guest incarnation and document identity, independent of UI selection.
use crate::domain::{
    broadcast::{BroadcastIssue, GuestBinding},
    error::{AppError, Result as AppResult},
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use uuid::Uuid;

#[cfg(test)]
mod tests;

struct Session {
    incarnation: String,
    binding: GuestBinding,
    loaded: bool,
    cancel: Arc<AtomicBool>,
    visible: bool,
    presentation_cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct PlatformSessions {
    sessions: Mutex<HashMap<String, Session>>,
    invalidated: Mutex<HashMap<String, String>>,
}

impl PlatformSessions {
    pub fn created(&self, id: &str, platform: &str) -> String {
        let incarnation = Uuid::new_v4().to_string();
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(old) = sessions.get(id) {
                old.cancel.store(true, Ordering::Release);
                old.presentation_cancel.store(true, Ordering::Release);
            }
            sessions.insert(
                id.to_owned(),
                Session {
                    incarnation: incarnation.clone(),
                    binding: GuestBinding {
                        account_id: id.to_owned(),
                        platform_id: platform.to_owned(),
                        generation: Uuid::new_v4().to_string(),
                    },
                    loaded: false,
                    cancel: Arc::new(AtomicBool::new(false)),
                    visible: false,
                    presentation_cancel: Arc::new(AtomicBool::new(true)),
                },
            );
        }
        incarnation
    }

    pub fn page(&self, id: &str, incarnation: &str, started: bool) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions
                .get_mut(id)
                .filter(|s| s.incarnation == incarnation)
            {
                if started {
                    session.cancel.store(true, Ordering::Release);
                    session.presentation_cancel.store(true, Ordering::Release);
                    session.cancel = Arc::new(AtomicBool::new(false));
                    session.presentation_cancel = Arc::new(AtomicBool::new(!session.visible));
                    session.binding.generation = Uuid::new_v4().to_string();
                }
                session.loaded = !started;
            }
        }
    }

    pub fn invalidate(&self, id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get_mut(id) {
                session.cancel.store(true, Ordering::Release);
                session.presentation_cancel.store(true, Ordering::Release);
                session.cancel = Arc::new(AtomicBool::new(false));
                session.presentation_cancel = Arc::new(AtomicBool::new(!session.visible));
                session.binding.generation = Uuid::new_v4().to_string();
                session.loaded = false;
            }
        }
        if let Ok(mut invalidated) = self.invalidated.lock() {
            invalidated.insert(id.to_owned(), Uuid::new_v4().to_string());
        }
    }

    pub fn removed(&self, id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(old) = sessions.remove(id) {
                old.cancel.store(true, Ordering::Release);
                old.presentation_cancel.store(true, Ordering::Release);
            }
        }
    }

    pub fn pending_invalidations(&self) -> Vec<(String, String)> {
        self.invalidated
            .lock()
            .map(|ids| {
                ids.iter()
                    .map(|(id, token)| (id.clone(), token.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn acknowledge_invalidated(&self, id: &str, token: &str) {
        if let Ok(mut pending) = self.invalidated.lock() {
            if pending.get(id).is_some_and(|current| current == token) {
                pending.remove(id);
            }
        }
    }

    pub fn current(&self, id: &str) -> Option<GuestBinding> {
        self.sessions
            .lock()
            .ok()?
            .get(id)
            .map(|session| session.binding.clone())
    }

    pub fn current_for_incarnation(&self, id: &str, incarnation: &str) -> Option<GuestBinding> {
        self.sessions
            .lock()
            .ok()?
            .get(id)
            .filter(|session| session.incarnation == incarnation)
            .map(|session| session.binding.clone())
    }

    pub fn binding(&self, id: &str, platform: &str) -> Result<GuestBinding, BroadcastIssue> {
        if self
            .invalidated
            .lock()
            .map_err(|_| BroadcastIssue::RuntimeFailed)?
            .contains_key(id)
        {
            return Err(BroadcastIssue::AccountUnavailable);
        }
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let session = sessions
            .get(id)
            .filter(|s| s.loaded && s.binding.platform_id == platform)
            .ok_or(BroadcastIssue::AccountUnavailable)?;
        Ok(session.binding.clone())
    }

    pub fn valid(&self, binding: &GuestBinding) -> bool {
        self.binding(&binding.account_id, &binding.platform_id)
            .is_ok_and(|current| current == *binding)
    }

    pub fn cancellation(&self, binding: &GuestBinding) -> Result<Arc<AtomicBool>, BroadcastIssue> {
        if !self.valid(binding) {
            return Err(BroadcastIssue::GuestChanged);
        }
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| BroadcastIssue::RuntimeFailed)?;
        sessions
            .get(&binding.account_id)
            .filter(|session| session.binding == *binding && session.loaded)
            .map(|session| Arc::clone(&session.cancel))
            .ok_or(BroadcastIssue::GuestChanged)
    }

    /// Visibility is a revocable effect lease, never the account or document identity.
    pub fn set_visible(&self, id: &str, visible: bool) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get_mut(id) {
                if session.visible != visible {
                    session.presentation_cancel.store(true, Ordering::Release);
                    session.presentation_cancel = Arc::new(AtomicBool::new(!visible));
                    session.visible = visible;
                }
            }
        }
    }

    pub fn presentation_cancellation(
        &self,
        binding: &GuestBinding,
    ) -> Result<Arc<AtomicBool>, BroadcastIssue> {
        if !self.valid(binding) {
            return Err(BroadcastIssue::GuestChanged);
        }
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| BroadcastIssue::RuntimeFailed)?;
        sessions
            .get(&binding.account_id)
            .filter(|session| session.binding == *binding && session.loaded && session.visible)
            .map(|session| Arc::clone(&session.presentation_cancel))
            .ok_or(BroadcastIssue::GuestChanged)
    }

    /// Serialize only commit admission and native script enqueue, never its callback wait.
    pub fn enqueue_presented<T>(
        &self,
        binding: &GuestBinding,
        enqueue: impl FnOnce() -> AppResult<T>,
    ) -> AppResult<T> {
        if !self.valid(binding) {
            return Err(AppError::SendIntentChanged);
        }
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let presented = sessions.get(&binding.account_id).is_some_and(|session| {
            session.binding == *binding && session.loaded && session.visible
        });
        if !presented {
            return Err(AppError::SendIntentChanged);
        }
        enqueue()
    }

    /// Revoke the lease and queue guest deactivation in the same order as commit enqueue.
    pub fn hide_and_enqueue(
        &self,
        id: &str,
        enqueue: impl FnOnce(&GuestBinding) -> AppResult<()>,
    ) -> AppResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let session = sessions.get_mut(id).ok_or(AppError::AccountNotOpen)?;
        session.presentation_cancel.store(true, Ordering::Release);
        session.visible = false;
        enqueue(&session.binding)
    }
}
