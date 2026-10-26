//! Read schema 1 without rewriting it; require both deny lists in schema 2.
use super::{
    AppError, BroadcastAudiencePreset, BroadcastMessagePreset, BroadcastPresetDocument,
    BroadcastPresetSnapshot, PRESET_SCHEMA_VERSION,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

fn present<'de, D>(deserializer: D) -> std::result::Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Vec::<String>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredDocument {
    schema_version: u32,
    accounts: Vec<StoredSnapshot>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSnapshot {
    account_id: String,
    revision: u64,
    messages: Vec<BroadcastMessagePreset>,
    audiences: Vec<BroadcastAudiencePreset>,
    #[serde(default, deserialize_with = "present")]
    excluded_contact_ids: Option<Vec<String>>,
    #[serde(default, deserialize_with = "present")]
    excluded_group_ids: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EncodedDocument<'a> {
    schema_version: u32,
    accounts: Vec<EncodedSnapshot<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EncodedSnapshot<'a> {
    account_id: &'a str,
    revision: u64,
    messages: &'a [BroadcastMessagePreset],
    audiences: &'a [BroadcastAudiencePreset],
    #[serde(skip_serializing_if = "Option::is_none")]
    excluded_contact_ids: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    excluded_group_ids: Option<&'a [String]>,
}

impl Serialize for BroadcastPresetDocument {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Preserve schema 1's exact field set during read-side size validation.
        // Adding empty fields there could reject a valid old document at its
        // size ceiling. Actual saves publish schema 2 with both explicit lists.
        EncodedDocument {
            schema_version: self.schema_version,
            accounts: self
                .accounts
                .iter()
                .map(|account| EncodedSnapshot {
                    account_id: &account.account_id,
                    revision: account.revision,
                    messages: &account.messages,
                    audiences: &account.audiences,
                    excluded_contact_ids: (self.schema_version != 1)
                        .then_some(account.excluded_contact_ids.as_slice()),
                    excluded_group_ids: (self.schema_version != 1)
                        .then_some(account.excluded_group_ids.as_slice()),
                })
                .collect(),
        }
        .serialize(serializer)
    }
}

impl TryFrom<StoredDocument> for BroadcastPresetDocument {
    type Error = AppError;

    fn try_from(stored: StoredDocument) -> Result<Self, Self::Error> {
        if !matches!(stored.schema_version, 1 | PRESET_SCHEMA_VERSION) {
            return Err(AppError::BroadcastPresetInvalid);
        }
        let mut accounts = Vec::with_capacity(stored.accounts.len());
        for account in stored.accounts {
            if stored.schema_version == PRESET_SCHEMA_VERSION
                && (account.excluded_contact_ids.is_none() || account.excluded_group_ids.is_none())
            {
                return Err(AppError::BroadcastPresetInvalid);
            }
            accounts.push(BroadcastPresetSnapshot {
                account_id: account.account_id,
                revision: account.revision,
                messages: account.messages,
                audiences: account.audiences,
                excluded_contact_ids: account.excluded_contact_ids.unwrap_or_default(),
                excluded_group_ids: account.excluded_group_ids.unwrap_or_default(),
            });
        }
        Ok(Self {
            schema_version: stored.schema_version,
            accounts,
        })
    }
}
