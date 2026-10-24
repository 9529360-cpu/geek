//! Deny-only recipient hints. They never establish authority to send or resolve peers.
use super::{valid_preset_recipient, AppError, HashSet, Result, MAX_TARGETS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExclusionKind {
    Contact,
    Group,
}

/// Exact contact/group namespaces, including the K catalog's safe integer bound.
pub fn exclusion_kind(id: &str) -> Option<ExclusionKind> {
    if !valid_preset_recipient(id) {
        return None;
    }
    if let Some(peer) = id.strip_prefix("tg:") {
        let peer = peer.parse::<i64>().ok()?;
        if peer.unsigned_abs() > 9_007_199_254_740_991 {
            return None;
        }
        return Some(if peer < 0 {
            ExclusionKind::Group
        } else {
            ExclusionKind::Contact
        });
    }
    Some(if id.ends_with("@g.us") {
        ExclusionKind::Group
    } else {
        ExclusionKind::Contact
    })
}

pub fn validate_exclusion_ids(ids: &[String], kind: ExclusionKind) -> Result<()> {
    if ids.len() > MAX_TARGETS {
        return Err(AppError::BroadcastPresetLimit);
    }
    let mut seen = HashSet::new();
    if ids
        .iter()
        .any(|id| exclusion_kind(id) != Some(kind) || !seen.insert(id))
    {
        return Err(AppError::BroadcastPresetInvalid);
    }
    Ok(())
}

pub fn validate_exclusions(contacts: &[String], groups: &[String]) -> Result<()> {
    validate_exclusion_ids(contacts, ExclusionKind::Contact)?;
    validate_exclusion_ids(groups, ExclusionKind::Group)?;
    let mut ids = contacts.iter().chain(groups);
    if let Some(first) = ids.next() {
        if ids.any(|id| id.starts_with("tg:") != first.starts_with("tg:")) {
            return Err(AppError::BroadcastPresetInvalid);
        }
    }
    Ok(())
}

pub fn validate_exclusions_for_platform(
    platform: &str,
    contacts: &[String],
    groups: &[String],
) -> Result<()> {
    validate_exclusions(contacts, groups)?;
    if contacts
        .iter()
        .chain(groups)
        .any(|id| !crate::domain::translation::valid_receive_chat_id(platform, id))
    {
        return Err(AppError::BroadcastPresetInvalid);
    }
    Ok(())
}
