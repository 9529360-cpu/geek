//! Hang recovery for a page that never reports a crash. Two missed probes may
//! reload that account; a third reload inside the same minute is refused.
use super::rate_limit::SlidingWindow;

const MISSES_BEFORE_RELOAD: u8 = 2;
const MAX_RELOADS: u32 = 2;
const WINDOW_MS: u64 = 60_000;

pub struct PagePulse {
    misses: Vec<(String, u8)>,
    windows: Vec<(String, SlidingWindow)>,
}

impl PagePulse {
    pub fn new() -> Self {
        Self {
            misses: Vec::new(),
            windows: Vec::new(),
        }
    }

    /// `alive` resets the miss count. A dead probe reloads only after two
    /// consecutive misses and only when the per-account window still allows it.
    pub fn observe(&mut self, id: &str, alive: bool, now_ms: u64) -> bool {
        if alive {
            self.misses.retain(|item| item.0 != id);
            return false;
        }
        let count = match self.misses.iter_mut().find(|item| item.0 == id) {
            Some(slot) => {
                slot.1 = slot.1.saturating_add(1);
                slot.1
            }
            None => {
                self.misses.push((id.to_string(), 1));
                1
            }
        };
        if count < MISSES_BEFORE_RELOAD {
            return false;
        }
        let allowed = if let Some(slot) = self.windows.iter_mut().find(|item| item.0 == id) {
            slot.1.allow(now_ms)
        } else {
            let mut gate = SlidingWindow::new(MAX_RELOADS, WINDOW_MS);
            let allowed = gate.allow(now_ms);
            self.windows.push((id.to_string(), gate));
            allowed
        };
        if !allowed {
            return false;
        }
        if let Some(slot) = self.misses.iter_mut().find(|item| item.0 == id) {
            slot.1 = 0;
        }
        true
    }

    pub fn forget(&mut self, id: &str) {
        self.misses.retain(|item| item.0 != id);
        self.windows.retain(|item| item.0 != id);
    }
}
