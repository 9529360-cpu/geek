use super::broadcast_support::*;
use crate::domain::{broadcast::*, error::AppError};
use uuid::Uuid;

#[test]
fn history_counts_only_the_bound_account_and_keeps_pending_and_uncertain_distinct() {
    let (service, repository, platform) = setup();
    let owner = account("History owner");
    let other = account("Other account");
    let mut input = draft(&owner, 4);
    input.message = "Private body 😀".into();
    let item = service.submit(owner.clone(), input.clone(), NOW).unwrap();
    service.tick(NOW).unwrap();
    idle(&service);
    *platform.before_submission_issue.lock().unwrap() = Some(BroadcastIssue::TargetChanged);
    service.tick(NOW + 2_000).unwrap();
    idle(&service);
    *platform.before_submission_issue.lock().unwrap() = None;
    *platform.outcome.lock().unwrap() = Some(DispatchOutcome::Uncertain {
        code: BroadcastIssue::TimedOut,
    });
    service.tick(NOW + 4_000).unwrap();
    idle(&service);
    service
        .submit(other.clone(), draft(&other, 3), NOW + 5_000)
        .unwrap();

    let before = service.snapshot().unwrap();
    let writes = repository.0.lock().unwrap().successful_writes;
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    let report = service.history_report(&owner.id).unwrap();
    assert_eq!(report.revision, before.revision);
    assert_eq!((report.summary.jobs, report.summary.total), (1, 4));
    assert_eq!(
        (
            report.summary.ok,
            report.summary.fail,
            report.summary.uncertain,
            report.summary.pending
        ),
        (1, 1, 1, 1)
    );
    assert_eq!(report.rows[0].job_id, item.id);
    assert_eq!(
        report.rows[0].message_length,
        input.message.encode_utf16().count()
    );
    assert_eq!(service.snapshot().unwrap().jobs, before.jobs);
    assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
    let csv = report.to_csv();
    let json = serde_json::to_string(&report).unwrap();
    for body in [&csv, &json] {
        assert!(!body.contains(&input.message));
        assert!(!body.contains(&other.id));
        for target in &input.targets {
            assert!(!body.contains(&target.id));
        }
        for result in &before.jobs[0].results {
            if let DispatchOutcome::Confirmed { receipt } = &result.outcome {
                assert!(!body.contains(receipt));
            }
        }
    }
    assert!(csv.starts_with('\u{feff}'));
    assert!(csv.contains("结果不确定,未处理"));
    assert!(csv.contains("1970-01-01T00:16:40.000Z"));
}

#[test]
fn stopped_unprocessed_targets_are_not_failed_and_dismissed_history_remains_visible() {
    let (service, _, _) = setup();
    let owner = account("Stopped owner");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    service
        .control(&item.id, BroadcastAction::Stop, NOW + 1)
        .unwrap();
    service
        .control(&item.id, BroadcastAction::Dismiss, NOW + 2)
        .unwrap();
    let report = service.history_report(&owner.id).unwrap();
    assert_eq!(
        (
            report.summary.total,
            report.summary.fail,
            report.summary.pending
        ),
        (2, 0, 2)
    );
    assert_eq!(report.rows[0].state, BroadcastState::Stopped);
    assert!(report.to_csv().contains("已停止"));
    let empty = service.history_report(&Uuid::new_v4().to_string()).unwrap();
    assert!(empty.rows.is_empty());
    assert_eq!(empty.summary.jobs, 0);
    assert!(matches!(
        service.history_report("bad account"),
        Err(AppError::BroadcastInvalid)
    ));
}
