//! Count-only unread signal for WhatsApp and Telegram. The page script returns
//! a number. Titles are reduced to that number before they leave this owner.
use crate::domain::{
    account::valid_id,
    error::{AppError, Result},
    unread::{
        apply_observations, combine_unread, monitors, parse_dom_count, title_unread,
        UnreadObservation, UnreadUpdate,
    },
};
use std::{
    sync::{mpsc, Mutex},
    time::Duration,
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
}

pub struct UnreadHub {
    app: AppHandle,
    inner: Mutex<UnreadState>,
}

impl UnreadHub {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Mutex::new(UnreadState {
                open: Vec::new(),
                titles: Vec::new(),
                counts: Vec::new(),
                focused: None,
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
        let mut observed = Vec::with_capacity(open.len());
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
            let count = match self.scan_dom(id) {
                Some(dom) => combine_unread(title, dom),
                None => title.min(9999),
            };
            observed.push(UnreadObservation {
                id: id.clone(),
                count,
            });
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
        drop(state);
        self.attention(&update);
        Ok(crate::domain::unread::UnreadSnapshot::from(update))
    }

    fn attention(&self, update: &UnreadUpdate) {
        if update.notices.is_empty() {
            return;
        }
        if let Some(window) = self.app.get_window("main") {
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        }
    }

    fn scan_dom(&self, id: &str) -> Option<u32> {
        if !valid_id(id) {
            return None;
        }
        let guest = self.app.get_webview(&format!("account-{id}"))?;
        let (sender, receiver) = mpsc::sync_channel(1);
        guest
            .eval_with_callback(DOM_SCAN, move |value| {
                let _ = sender.try_send(value);
            })
            .ok()?;
        let value = receiver.recv_timeout(Duration::from_millis(750)).ok()?;
        if value.len() > 16 {
            return None;
        }
        parse_dom_count(&value)
    }
}
