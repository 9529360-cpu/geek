//! Serialize saved deny lists with new-job freezing, without Workspace/guest waits.
use crate::{
    application::{broadcast_presets::BroadcastPresets, ports::BroadcastPresetRepository},
    domain::error::{AppError, Result},
};
use std::sync::Mutex;

/// The caller has already returned any identical existing job and released all
/// account/catalog reads. Submission persists the frozen job while the deny-list
/// owner is locked, so a concurrent save has a single order with that creation.
pub(super) fn submit<R: BroadcastPresetRepository, T>(
    owner: &Mutex<BroadcastPresets<R>>,
    account_id: &str,
    recipient_ids: &[String],
    submit_job: impl FnOnce() -> Result<T>,
) -> Result<T> {
    let presets = owner.lock().map_err(|_| AppError::StateUnavailable)?;
    presets.ensure_not_excluded(account_id, recipient_ids)?;
    let result = submit_job();
    drop(presets);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::broadcast_presets::BroadcastPresetDocument;
    use std::sync::{mpsc, Arc};

    const ACCOUNT: &str = "11111111-1111-4111-8111-111111111111";
    const OTHER: &str = "22222222-2222-4222-8222-222222222222";

    #[derive(Default)]
    struct Repository;

    impl BroadcastPresetRepository for Repository {
        fn load(&self) -> Result<Option<BroadcastPresetDocument>> {
            Ok(None)
        }
        fn save(&mut self, _: &BroadcastPresetDocument) -> Result<()> {
            Ok(())
        }
    }

    fn owner() -> Mutex<BroadcastPresets<Repository>> {
        Mutex::new(BroadcastPresets::open(Repository).unwrap())
    }

    #[test]
    fn saved_denials_block_submission_before_effect_and_remain_account_scoped() {
        let owner = owner();
        owner
            .lock()
            .unwrap()
            .save_exclusions(ACCOUNT, 0, vec!["12@c.us".into()], vec!["34@g.us".into()])
            .unwrap();
        for target in ["12@c.us", "34@g.us"] {
            let mut invoked = false;
            let result = submit(&owner, ACCOUNT, &[target.into()], || {
                invoked = true;
                Ok(())
            });
            assert_eq!(result, Err(AppError::BroadcastExclusionConflict));
            assert!(!invoked);
        }
        assert_eq!(submit(&owner, OTHER, &["12@c.us".into()], || Ok(7)), Ok(7));
        assert_eq!(
            submit(&owner, ACCOUNT, &["56@c.us".into()], || Ok(8)),
            Ok(8)
        );
    }

    #[test]
    fn the_lock_spans_submission_and_a_later_save_only_affects_a_new_job() {
        let owner = Arc::new(owner());
        let writer_owner = Arc::clone(&owner);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (attempt_tx, attempt_rx) = mpsc::channel();
        let writer = std::thread::spawn(move || {
            entered_rx.recv().unwrap();
            // An actual competing thread sees the owner locked while the job
            // callback is pending; no timing/sleep-based scheduling assumption.
            assert!(writer_owner.try_lock().is_err());
            attempt_tx.send(()).unwrap();
            writer_owner
                .lock()
                .unwrap()
                .save_exclusions(ACCOUNT, 0, vec!["12@c.us".into()], Vec::new())
                .unwrap();
        });
        let frozen = submit(&owner, ACCOUNT, &["12@c.us".into()], || {
            entered_tx.send(()).unwrap();
            attempt_rx.recv().unwrap();
            Ok(vec!["12@c.us".to_owned()])
        })
        .unwrap();
        writer.join().unwrap();
        assert_eq!(frozen, vec!["12@c.us"]);
        assert_eq!(
            submit(&owner, ACCOUNT, &frozen, || Ok(())),
            Err(AppError::BroadcastExclusionConflict)
        );
    }

    #[test]
    fn submission_failure_releases_the_guard_without_changing_saved_settings() {
        let owner = owner();
        assert_eq!(
            submit::<_, ()>(&owner, ACCOUNT, &["12@c.us".into()], || Err(
                AppError::BroadcastPersistence
            )),
            Err(AppError::BroadcastPersistence)
        );
        let mut unlocked = owner.try_lock().unwrap();
        assert_eq!(unlocked.snapshot(ACCOUNT).unwrap().revision, 0);
        assert_eq!(
            unlocked
                .save_exclusions(ACCOUNT, 0, vec!["12@c.us".into()], Vec::new())
                .unwrap()
                .revision,
            1
        );
    }
}
