use serde::Serialize;

/// WhatsApp and Telegram only. Other families stay out of this shell signal.
pub fn monitors(platform_id: &str) -> bool {
    matches!(
        platform_id,
        "whatsapp" | "whatsapp-pure" | "telegram-k" | "telegram-z"
    )
}

/// Title prefix `(3)`, `[12]` or `（8）`. The rest of the title is ignored.
pub fn title_unread(title: &str) -> u32 {
    let mut chars = title.chars();
    let Some(open) = chars.next() else {
        return 0;
    };
    if !matches!(open, '(' | '[' | '（') {
        return 0;
    }
    let mut spaces = 0u8;
    let mut digits = String::new();
    let mut closed = false;
    for ch in chars {
        if digits.is_empty() && matches!(ch, ' ' | '\t') {
            spaces = spaces.saturating_add(1);
            if spaces > 4 {
                return 0;
            }
            continue;
        }
        if ch.is_ascii_digit() {
            if digits.len() >= 6 {
                return 0;
            }
            digits.push(ch);
            continue;
        }
        if !digits.is_empty() && matches!(ch, ' ' | '\t') {
            spaces = spaces.saturating_add(1);
            if spaces > 8 {
                return 0;
            }
            continue;
        }
        closed = !digits.is_empty() && matches!(ch, ')' | ']' | '）');
        break;
    }
    if !closed {
        return 0;
    }
    digits.parse().unwrap_or(0)
}

pub fn combine_unread(title: u32, dom: u32) -> u32 {
    title.max(dom).min(9999)
}

/// Accept only a short JSON integer from the page. Anything else is no DOM count.
pub fn parse_dom_count(raw: &str) -> Option<u32> {
    let text = raw.trim().trim_matches('"');
    if text.is_empty() || text.len() > 4 || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse::<u32>().ok().filter(|count| *count <= 9999)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadObservation {
    pub id: String,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadSnapshot {
    pub accounts: Vec<UnreadObservation>,
    pub notices: Vec<UnreadObservation>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnreadUpdate {
    pub counts: Vec<UnreadObservation>,
    pub notices: Vec<UnreadObservation>,
    pub focused: Option<String>,
}

impl From<UnreadUpdate> for UnreadSnapshot {
    fn from(update: UnreadUpdate) -> Self {
        Self {
            accounts: update.counts,
            notices: update.notices,
        }
    }
}

/// A newly focused account is cleared once and does not toast the unread that
/// was already on screen. A later increase still notifies.
pub fn apply_observations(
    previous: &[UnreadObservation],
    observed: &[UnreadObservation],
    previous_focus: Option<&str>,
    focus: Option<&str>,
) -> UnreadUpdate {
    let focused = focus
        .filter(|id| observed.iter().any(|item| item.id == *id))
        .map(str::to_string);
    let focus_changed = focused.as_deref() != previous_focus;
    let mut counts = Vec::with_capacity(observed.len());
    let mut notices = Vec::new();
    for item in observed {
        let prior = previous
            .iter()
            .find(|entry| entry.id == item.id)
            .map_or(0, |entry| entry.count);
        if focus_changed && focused.as_deref() == Some(item.id.as_str()) {
            counts.push(UnreadObservation {
                id: item.id.clone(),
                count: 0,
            });
            continue;
        }
        if item.count > prior && item.count > 0 {
            notices.push(item.clone());
        }
        counts.push(item.clone());
    }
    UnreadUpdate {
        counts,
        notices,
        focused,
    }
}
