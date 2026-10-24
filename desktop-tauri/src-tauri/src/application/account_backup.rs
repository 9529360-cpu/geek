//! Coordinate the existing owners without inventing cross-file atomicity.
use super::{
    accounts::Accounts,
    broadcast_presets::BroadcastPresets,
    ports::{AccountRepository, BroadcastPresetRepository},
};
use crate::domain::{
    account_backup::{BackupData, MAX_BACKUP_BYTES},
    error::{AppError, Result},
};
use serde::Serialize;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RestorationStatus {
    Restored,
    Unchanged,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoredSection {
    pub status: RestorationStatus,
    pub code: Option<AppError>,
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoration {
    pub account_id: String,
    pub presets: RestoredSection,
    pub translation: RestoredSection,
}

impl RestoredSection {
    fn absent(revision: u64) -> Self {
        Self {
            status: RestorationStatus::NotAttempted,
            code: None,
            revision,
        }
    }

    fn completed(result: Result<()>, before: u64, after: u64) -> Self {
        match result {
            Ok(()) => Self {
                status: if after == before {
                    RestorationStatus::Unchanged
                } else {
                    RestorationStatus::Restored
                },
                code: None,
                revision: after,
            },
            Err(code) => Self {
                status: RestorationStatus::Failed,
                code: Some(code),
                revision: after,
            },
        }
    }
}

pub fn restore<R: AccountRepository, P: BroadcastPresetRepository>(
    accounts: &mut Accounts<R>,
    presets: &mut BroadcastPresets<P>,
    account_id: &str,
    expected_preset_revision: u64,
    expected_translation_revision: u64,
    data: &BackupData,
) -> Result<BackupRestoration> {
    if data.presets.is_none() && data.translation.is_none() {
        return Err(AppError::BackupInvalid);
    }
    let encoded = Zeroizing::new(serde_json::to_vec(data).map_err(|_| AppError::BackupInvalid)?);
    if encoded.len() > MAX_BACKUP_BYTES {
        return Err(AppError::BackupLimit);
    }
    let account = accounts.openable_account(account_id)?;
    data.validate_for_platform(&account.platform_id)?;
    let preset_before = presets.snapshot(account_id)?.revision;
    let translation_before = account.translation.revision;
    // restore_translation only replaces this row's settings, never its identity,
    // position or existence. Exclusive owner borrows keep this index stable.
    let account_index = accounts
        .accounts()
        .iter()
        .position(|entry| entry.id == account_id)
        .ok_or(AppError::AccountUnknown)?;
    if let Some(backup) = &data.presets {
        presets.validate_restore(account_id, expected_preset_revision, backup)?;
    }
    if let Some(backup) = &data.translation {
        accounts.validate_restore_translation(account_id, expected_translation_revision, backup)?;
    }

    // From here each result describes its own durable commit. A later failure
    // never rolls an earlier success back or hides it behind a global error.
    let preset_result = if let Some(backup) = &data.presets {
        match presets.restore(account_id, expected_preset_revision, backup) {
            Ok(snapshot) => RestoredSection::completed(Ok(()), preset_before, snapshot.revision),
            // Failed preset saves publish neither a document nor a revision.
            Err(code) => RestoredSection::completed(Err(code), preset_before, preset_before),
        }
    } else {
        RestoredSection::absent(preset_before)
    };
    let translation_result = if let Some(backup) = &data.translation {
        let result =
            accounts.restore_translation(account_id, expected_translation_revision, backup);
        RestoredSection::completed(
            result,
            translation_before,
            accounts.accounts()[account_index].translation.revision,
        )
    } else {
        RestoredSection::absent(translation_before)
    };
    Ok(BackupRestoration {
        account_id: account_id.into(),
        presets: preset_result,
        translation: translation_result,
    })
}
