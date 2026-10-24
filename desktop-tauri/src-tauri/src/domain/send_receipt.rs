//! A fixed guest receipt cannot reopen a committed attempt without scoped proof.
use super::{
    account::valid_id,
    error::{AppError, Result},
    send_intent::SendOutcome,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendReceipt {
    pending: bool,
    value: Option<SendOutcome>,
    precommit: Option<PrecommitProof>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum PrecommitProof {
    TelegramK {
        generation: String,
        id: String,
        attempt: u32,
        permit: String,
    },
}

impl SendReceipt {
    /// `None` means the same fixed bridge is still awaiting its receipt. Only
    /// the K adapter's private zero-invocation branch emits `precommit`; bind it
    /// to every native-owned attempt field before allowing the existing retry.
    /// Missing mailboxes and unknown outcomes remain uncertain after commit.
    pub fn resolve(
        self,
        platform: &str,
        generation: &str,
        id: &str,
        attempt: u32,
        permit: &str,
    ) -> Result<Option<SendOutcome>> {
        match (self.pending, self.value, self.precommit) {
            (true, None, None) => Ok(None),
            (
                false,
                Some(outcome @ (SendOutcome::Confirmed { .. } | SendOutcome::Uncertain { .. })),
                None,
            ) => Ok(Some(outcome)),
            (
                false,
                Some(outcome @ SendOutcome::NotSubmitted { .. }),
                Some(PrecommitProof::TelegramK {
                    generation: proof_generation,
                    id: proof_id,
                    attempt: proof_attempt,
                    permit: proof_permit,
                }),
            ) if platform == "telegram-k"
                && proof_generation == generation
                && proof_id == id
                && proof_attempt == attempt
                && proof_permit == permit
                && valid_id(generation)
                && valid_id(id)
                && valid_id(permit)
                && (1..=10_000).contains(&attempt) =>
            {
                Ok(Some(outcome))
            }
            _ => Err(AppError::SendIntentUncertain),
        }
    }
}
