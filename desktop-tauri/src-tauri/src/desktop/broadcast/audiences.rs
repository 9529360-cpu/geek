//! Audience expansion borrows the same import gate, catalog lease and deadline.
use super::{
    imports::{ImportSummary, RecipientImport},
    *,
};
use crate::domain::{broadcast::MAX_TARGETS, broadcast_import::BroadcastImportCandidates};
use serde_json::json;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BroadcastAudienceSource {
    Groups {
        #[serde(rename = "groupIds")]
        group_ids: Vec<String>,
    },
    Label {
        #[serde(rename = "labelId")]
        label_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GroupMembers {
    candidates: Vec<String>,
    self_ids: Vec<String>,
    skipped: usize,
}

#[derive(Default)]
struct GroupCandidates {
    parsed: BroadcastImportCandidates,
    seen: HashSet<String>,
    self_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LabelMembers {
    label_id: String,
    chat_ids: Vec<String>,
}

impl BroadcastDesktop {
    pub fn resolve_audience(
        &self,
        account_id: &str,
        catalog_id: &str,
        source: BroadcastAudienceSource,
    ) -> Result<ResolvedBroadcastRecipients> {
        let import = self.recipient_import(account_id, catalog_id)?;
        let started = Instant::now();
        match source {
            BroadcastAudienceSource::Groups { group_ids } => {
                validate_groups(&import.lease, &group_ids)?;
                let mut candidates = GroupCandidates::default();
                for group_id in group_ids {
                    candidates.accept(import.call(
                        "groupMembers",
                        json!({ "groupId": group_id }),
                        started,
                    )?)?;
                }
                if candidates.parsed.candidates.is_empty() {
                    return Err(AppError::BroadcastImportEmpty);
                }
                import.resolve_contacts(candidates.parsed, candidates.self_ids.as_deref(), started)
            }
            BroadcastAudienceSource::Label { label_id } => import.resolve_label(&label_id, started),
        }
    }
}

impl RecipientImport<'_> {
    fn resolve_label(
        self,
        label_id: &str,
        started: Instant,
    ) -> Result<ResolvedBroadcastRecipients> {
        let native = label_source_chats(&self.lease, label_id)?;
        let mut selected = Vec::new();
        for batch in native.chunks(200) {
            let ids: Vec<_> = batch.iter().map(|chat| chat.id.as_str()).collect();
            let value = self.call(
                "labelMembers",
                json!({ "labelId": label_id, "chatIds": ids }),
                started,
            )?;
            append_label_selection(&mut selected, value, label_id, batch)?;
        }
        if selected.is_empty() {
            return Err(AppError::BroadcastImportEmpty);
        }
        let summary = ImportSummary::selected(selected.len());
        self.publish(selected, Vec::new(), summary, started)
    }
}

fn validate_groups(lease: &CatalogLease, groups: &[String]) -> Result<()> {
    if !lease.catalog.capabilities.group_members {
        return Err(AppError::BroadcastUnsupported);
    }
    if groups.is_empty()
        || groups.len() > 20
        || groups.iter().collect::<HashSet<_>>().len() != groups.len()
        || groups.iter().any(|id| {
            !lease.native_ids.contains(id)
                || !lease
                    .catalog
                    .chats
                    .iter()
                    .any(|chat| chat.id == *id && chat.kind == ChatKind::Group)
        })
    {
        return Err(AppError::BroadcastInvalid);
    }
    Ok(())
}

impl GroupCandidates {
    fn accept(&mut self, value: serde_json::Value) -> Result<()> {
        let mut group: GroupMembers =
            serde_json::from_value(value).map_err(|_| AppError::BroadcastImportUnavailable)?;
        if group
            .candidates
            .len()
            .checked_add(group.skipped)
            .is_none_or(|count| count > 10_000)
        {
            return Err(AppError::BroadcastImportLimit);
        }
        if group.self_ids.is_empty()
            || group.self_ids.len() > 2
            || group
                .self_ids
                .iter()
                .any(|id| !supported_id(id, ChatKind::Contact))
            || group
                .self_ids
                .iter()
                .map(|id| id.rsplit_once('@').map(|(_, server)| server))
                .collect::<HashSet<_>>()
                .len()
                != group.self_ids.len()
        {
            return Err(AppError::BroadcastImportUnavailable);
        }
        group.self_ids.sort();
        if self
            .self_ids
            .as_ref()
            .is_some_and(|expected| *expected != group.self_ids)
        {
            return Err(AppError::BroadcastImportUnavailable);
        }
        for id in group.candidates {
            if !supported_id(&id, ChatKind::Contact)
                || group.self_ids.contains(&id)
                || !group.self_ids.iter().any(|own| {
                    own.rsplit_once('@').map(|(_, server)| server)
                        == id.rsplit_once('@').map(|(_, server)| server)
                })
            {
                return Err(AppError::BroadcastImportUnavailable);
            }
            if !self.seen.insert(id.clone()) {
                self.parsed.duplicate_count += 1;
            } else {
                if self.parsed.candidates.len() == MAX_TARGETS {
                    return Err(AppError::BroadcastImportLimit);
                }
                self.parsed.candidates.push(id);
            }
        }
        self.parsed.skipped_count += group.skipped;
        self.self_ids = Some(group.self_ids);
        Ok(())
    }
}

fn label_source_chats<'a>(lease: &'a CatalogLease, label_id: &str) -> Result<Vec<&'a CatalogChat>> {
    let labels = lease
        .catalog
        .labels
        .as_ref()
        .ok_or(AppError::BroadcastUnsupported)?;
    if !labels.iter().any(|label| label.id == label_id) {
        return Err(AppError::BroadcastImportUnavailable);
    }
    Ok(lease
        .catalog
        .chats
        .iter()
        .filter(|chat| lease.native_ids.contains(&chat.id))
        .collect())
}

fn append_label_selection(
    selected: &mut Vec<String>,
    value: serde_json::Value,
    label_id: &str,
    batch: &[&CatalogChat],
) -> Result<()> {
    selected.extend(label_selection(value, label_id, batch)?);
    if selected.len() > MAX_TARGETS {
        return Err(AppError::BroadcastImportLimit);
    }
    Ok(())
}

fn label_selection(
    value: serde_json::Value,
    label_id: &str,
    batch: &[&CatalogChat],
) -> Result<Vec<String>> {
    let members: LabelMembers =
        serde_json::from_value(value).map_err(|_| AppError::BroadcastImportUnavailable)?;
    let selected: HashSet<_> = members.chat_ids.iter().map(String::as_str).collect();
    if members.label_id != label_id
        || selected.len() != members.chat_ids.len()
        || members.chat_ids.len() > batch.len()
        || members
            .chat_ids
            .iter()
            .any(|id| !batch.iter().any(|chat| chat.id == *id))
    {
        return Err(AppError::BroadcastImportUnavailable);
    }
    // Preserve source order and names; the guest grants membership, not new IDs.
    Ok(batch
        .iter()
        .filter(|chat| selected.contains(chat.id.as_str()))
        .map(|chat| chat.id.clone())
        .collect())
}

#[cfg(test)]
mod tests;
