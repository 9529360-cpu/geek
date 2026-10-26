//! Count-only unread signal for WhatsApp and Telegram. The page script returns
//! a number. Titles are reduced to that number before they leave this owner.
use super::platform_sessions::PlatformSessions;
use crate::domain::{
    account::valid_id,
    error::{AppError, Result},
    page_pulse::PagePulse,
    unread::{
        apply_observations, combine_unread, monitors, parse_dom_count, title_unread,
        UnreadObservation, UnreadUpdate,
    },
};
use std::{
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, UserAttentionType};

const DOM_SCAN: &str = "(() => {\n\
  try {\n\
    const nodes = document.querySelectorAll('[class*=\"unread\"],[class*=\"Unread\"],.badge,.Badge,[class*=\"badge\"],[class*=\"Badge\"]');\n\
    let total = 0;\n\
    const limit = Math.min(nodes.length, 200);\n\
    for (let index = 0; index < limit; index += 1) {\n\
      const text = String(nodes[index].textContent || '').trim();\n\
      if (!/^\\d{1,3}$/.test(text)) continue;\n\
      total += Number(text);\n\
      if (total > 9999) return 9999;\n\
    }\n\
    return total;\n\
  } catch (error) { return 0; }\n\
})()";

struct OpenAccount {
    id: String,
    platform_id: String,
}

struct UnreadState {
    open: Vec<OpenAccount>,
    titles: Vec<(String, u32)>,
    counts: Vec<UnreadObservation>,
    focused: Option<String>,
    pulse: PagePulse,
}

enum Probe {
    Missing,
    Alive(u32),
    Dead,
}

pub struct UnreadHub {
    app: AppHandle,
    sessions: Arc<PlatformSessions>,
    inner: Mutex<UnreadState>,
}

impl UnreadHub {
    pub fn new(app: AppHandle, sessions: Arc<PlatformSessions>) -> Self {
        Self {
            app,
            sessions,
            inner: Mutex::new(UnreadState {
                open: Vec::new(),
                titles: Vec::new(),
                counts: Vec::new(),
                focused: None,
                pulse: PagePulse::new(),
            }),
        }
    }

    pub fn register(&self, id: &str, platform_id: &str) {
        if !monitors(platform_id) || !valid_id(id) {
            return;
        }
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        if state.open.iter().any(|item| item.id == id) {
            return;
        }
        state.open.push(OpenAccount {
            id: id.to_string(),
            platform_id: platform_id.to_string(),
        });
    }

    pub fn forget(&self, id: &str) {
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        state.open.retain(|item| item.id != id);
        state.titles.retain(|item| item.0 != id);
        state.counts.retain(|item| item.id != id);
        state.pulse.forget(id);
        if state.focused.as_deref() == Some(id) {
            state.focused = None;
        }
    }

    pub fn note_title(&self, id: &str, platform_id: &str, title: &str) {
        if !monitors(platform_id) || !valid_id(id) {
            return;
        }
        let count = title_unread(title);
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        if !state.open.iter().any(|item| item.id == id) {
            return;
        }
        if let Some(slot) = state.titles.iter_mut().find(|item| item.0 == id) {
            slot.1 = count;
        } else {
            state.titles.push((id.to_string(), count));
        }
    }

    pub fn poll(
        &self,
        focused_id: Option<String>,
    ) -> Result<crate::domain::unread::UnreadSnapshot> {
        let open = {
            let state = self.inner.lock().map_err(|_| AppError::StateUnavailable)?;
            state
                .open
                .iter()
                .map(|item| (item.id.clone(), item.platform_id.clone()))
                .collect::<Vec<_>>()
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok());
        let mut observed = Vec::with_capacity(open.len());
        let mut probed = Vec::with_capacity(open.len());
        for (id, platform_id) in &open {
            if !monitors(platform_id) {
                continue;
            }
            let title = {
                let state = self.inner.lock().map_err(|_| AppError::StateUnavailable)?;
                state
                    .titles
                    .iter()
                    .find(|item| item.0 == *id)
                    .map_or(0, |item| item.1)
            };
            let outcome = self.probe(id);
            let count = match outcome {
                Probe::Alive(dom) => combine_unread(title, dom),
                Probe::Dead | Probe::Missing => title.min(9999),
            };
            observed.push(UnreadObservation {
                id: id.clone(),
                count,
            });
            probed.push((id.clone(), outcome));
        }
        let focus = focused_id.filter(|id| valid_id(id));
        let mut state = self.inner.lock().map_err(|_| AppError::StateUnavailable)?;
        let update = apply_observations(
            &state.counts,
            &observed,
            state.focused.as_deref(),
            focus.as_deref(),
        );
        state.counts.clone_from(&update.counts);
        state.focused.clone_from(&update.focused);
        let mut reloads = Vec::new();
        if let Some(now) = now {
            for (id, outcome) in &probed {
                let reload = match outcome {
                    Probe::Alive(_) => {
                        state.pulse.observe(id, true, now);
                        false
                    }
                    Probe::Dead => state.pulse.observe(id, false, now),
                    Probe::Missing => false,
                };
                if reload {
                    reloads.push(id.clone());
                }
            }
        }
        drop(state);
        for id in reloads {
            self.reload_hung(&id);
        }
        self.attention(&update);
        Ok(crate::domain::unread::UnreadSnapshot::from(update))
    }

    fn reload_hung(&self, id: &str) {
        if !valid_id(id) {
            return;
        }
        let Some(guest) = self.app.get_webview(&format!("account-{id}")) else {
            return;
        };
        if let Some(binding) = self.sessions.current(id) {
            if let Ok(generation) = serde_json::to_string(&binding.generation) {
                let _ = guest.eval(format!(
                    "window.__geekTauriSend?.revoke({generation}); window.__geekTauriTranslation?.revoke({generation}); window.__geekTauriPlatform?.revoke({generation})"
                ));
            }
        }
        self.sessions.invalidate(id);
        let _ = guest.reload();
    }

    fn attention(&self, update: &UnreadUpdate) {
        if update.notices.is_empty() {
            return;
        }
        if let Some(window) = self.app.get_window("main") {
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        }
    }

    fn probe(&self, id: &str) -> Probe {
        if !valid_id(id) {
            return Probe::Missing;
        }
        let Some(guest) = self.app.get_webview(&format!("account-{id}")) else {
            return Probe::Missing;
        };
        let (sender, receiver) = mpsc::sync_channel(1);
        if guest
            .eval_with_callback(DOM_SCAN, move |value| {
                let _ = sender.try_send(value);
            })
            .is_err()
        {
            return Probe::Dead;
        }
        let Ok(value) = receiver.recv_timeout(Duration::from_millis(750)) else {
            return Probe::Dead;
        };
        if value.len() > 16 {
            return Probe::Dead;
        }
        parse_dom_count(&value).map_or(Probe::Dead, Probe::Alive)
    }
}
