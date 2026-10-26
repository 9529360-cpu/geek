/// Sliding window used by local panic records. The clock is supplied by the
/// caller so a backwards step cannot stretch the allowance.
#[derive(Debug)]
pub struct SlidingWindow {
    max: u32,
    window_ms: u64,
    stamps: Vec<u64>,
    last: Option<u64>,
}

impl SlidingWindow {
    pub fn new(max: u32, window_ms: u64) -> Self {
        Self {
            max,
            window_ms,
            stamps: Vec::new(),
            last: None,
        }
    }

    pub fn allow(&mut self, now_ms: u64) -> bool {
        if self.max == 0 {
            return false;
        }
        if self.last.is_some_and(|last| now_ms < last) {
            self.stamps.clear();
        }
        self.last = Some(now_ms);
        // Keep a stamp while stamp + window is still after now. Subtracting the
        // window from a small clock saturates and would drop the first event.
        self.stamps
            .retain(|stamp| stamp.saturating_add(self.window_ms) > now_ms);
        if self.stamps.len() as u32 >= self.max {
            return false;
        }
        self.stamps.push(now_ms);
        true
    }
}
