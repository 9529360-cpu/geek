use super::broadcast_support::*;
use crate::domain::{
    broadcast::*,
    broadcast_report::{BroadcastFailureReport, BroadcastFailureRow, BroadcastFailureStatus},
    error::AppError,
};
use std::sync::Arc;
use uuid::Uuid;

#[test]
fn report_preserves_settled_target_identity_and_separates_uncertain_from_not_submitted() {
    let (service, _, platform) = setup();
    let owner = account("Report owner");
    let input = draft(&owner, 4);
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

    let report = service.failure_report(&owner.id, &item.id).unwrap();
    assert_eq!(report.account_id, owner.id);
    assert_eq!(report.job_id, item.id);
    assert_eq!(report.revision, service.snapshot().unwrap().revision);
    assert_eq!(report.rows.len(), 2);
    for (row, index) in report.rows.iter().zip([1, 2]) {
        assert_eq!(
            row.target_id.as_deref(),
            Some(input.targets[index].id.as_str())
        );
        assert_eq!(row.name, input.targets[index].name);
    }
    assert_eq!(report.rows[0].status, BroadcastFailureStatus::NotSubmitted);
    assert_eq!(report.rows[0].code, BroadcastIssue::TargetChanged);
    assert_eq!(report.rows[1].status, BroadcastFailureStatus::Uncertain);
    assert_eq!(report.rows[1].code, BroadcastIssue::TimedOut);
    let csv = report.to_csv();
    assert!(!csv.contains(&input.targets[0].id));
    assert!(!csv.contains(&input.targets[3].id));
    assert!(!csv.contains(&input.message));
    if let DispatchOutcome::Confirmed { receipt } = &job(&service, &item.id).results[0].outcome {
        assert!(!csv.contains(receipt));
    } else {
        panic!("first recipient must have a confirmed receipt");
    }
}

#[test]
fn export_is_read_only_owner_bound_and_frozen_while_the_job_continues() {
    let (service, repository, platform) = setup();
    let owner = account("Owner");
    let other = account("Other owner");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    *platform.before_submission_issue.lock().unwrap() = Some(BroadcastIssue::TargetChanged);
    service.tick(NOW).unwrap();
    idle(&service);
    let before = service.snapshot().unwrap();
    let durable = repository.0.lock().unwrap().document.clone();
    let writes = repository.0.lock().unwrap().successful_writes;
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    let report = service.failure_report(&owner.id, &item.id).unwrap();
    let csv = report.to_csv();
    assert!(matches!(
        service.failure_report(&other.id, &item.id),
        Err(AppError::BroadcastUnknown)
    ));
    assert!(matches!(
        service.failure_report(&owner.id, &Uuid::new_v4().to_string()),
        Err(AppError::BroadcastUnknown)
    ));
    assert!(matches!(
        service.failure_report("invalid", &item.id),
        Err(AppError::BroadcastInvalid)
    ));
    assert_eq!(service.snapshot().unwrap().jobs, before.jobs);
    assert_eq!(service.snapshot().unwrap().revision, before.revision);
    let state = repository.0.lock().unwrap();
    assert_eq!(state.document, durable);
    assert_eq!(state.successful_writes, writes);
    assert!(matches!(state.fail_at, Some(FailAt::Any)));
    drop(state);

    repository.0.lock().unwrap().fail_at = None;
    *platform.before_submission_issue.lock().unwrap() = Some(BroadcastIssue::ComposerMismatch);
    service.tick(NOW + 2_000).unwrap();
    idle(&service);
    assert_eq!(
        service
            .failure_report(&owner.id, &item.id)
            .unwrap()
            .rows
            .len(),
        2
    );
    assert_eq!(report.rows.len(), 1);
    assert_eq!(report.to_csv(), csv);
    assert_eq!(report.revision, before.revision);
    service
        .control(&item.id, BroadcastAction::Dismiss, NOW + 3_000)
        .unwrap();
    assert_eq!(
        service
            .failure_report(&owner.id, &item.id)
            .unwrap()
            .rows
            .len(),
        2
    );
}

#[test]
fn task_level_issues_never_invent_recipient_failures_or_require_an_online_guest() {
    let (service, _, platform) = setup();
    let owner = account("Closed");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    platform
        .unavailable
        .lock()
        .unwrap()
        .insert(owner.id.clone());
    service.invalidate_account(&owner.id, NOW + 1).unwrap();
    service.shutdown().unwrap();
    let report = service.failure_report(&owner.id, &item.id).unwrap();
    assert_eq!(report.rows.len(), 1);
    assert_eq!(report.rows[0].name, "任务");
    assert_eq!(report.rows[0].target_id, None);
    assert_eq!(report.rows[0].status, BroadcastFailureStatus::TaskIssue);
    assert_eq!(report.rows[0].code, BroadcastIssue::GuestChanged);
    assert_eq!(job(&service, &item.id).current, 0);
    assert!(platform.acquired.lock().unwrap().is_empty());
    assert!(platform.calls.lock().unwrap().is_empty());
}

#[test]
fn failed_settlement_exports_only_the_storage_issue_until_recovery_records_uncertainty() {
    let (service, repository, platform) = setup();
    let owner = account("Recovery");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    repository.0.lock().unwrap().fail_at = Some(FailAt::Settle);
    service.tick(NOW).unwrap();
    idle(&service);
    assert!(job(&service, &item.id).checkpoint.is_some());
    let report = service.failure_report(&owner.id, &item.id).unwrap();
    assert_eq!(report.rows.len(), 1);
    assert_eq!(report.rows[0].target_id, None);
    assert_eq!(report.rows[0].status, BroadcastFailureStatus::TaskIssue);
    assert_eq!(report.rows[0].code, BroadcastIssue::PersistenceFailed);
    service.shutdown().unwrap();
    let reopened = Service::open_at(repository, Arc::clone(&platform), NOW + 10_000).unwrap();
    let recovered = reopened.failure_report(&owner.id, &item.id).unwrap();
    assert_eq!(recovered.rows.len(), 1);
    assert_eq!(
        recovered.rows[0].target_id.as_deref(),
        Some(item.targets[0].id.as_str())
    );
    assert_eq!(recovered.rows[0].status, BroadcastFailureStatus::Uncertain);
    assert_eq!(recovered.rows[0].code, BroadcastIssue::InterruptedUncertain);
    assert_eq!(reopened.tick(NOW + 20_000).unwrap(), 0);
    assert_eq!(platform.calls.lock().unwrap().len(), 1);
    assert_eq!(report.rows[0].target_id, None);
}

#[test]
fn no_failure_export_does_not_create_work_or_treat_pending_targets_as_failed() {
    let (service, repository, platform) = setup();
    let owner = account("No failures");
    let item = service
        .submit(owner.clone(), draft(&owner, 1), NOW)
        .unwrap();
    let writes = repository.0.lock().unwrap().successful_writes;
    assert!(matches!(
        service.failure_report(&owner.id, &item.id),
        Err(AppError::BroadcastExportEmpty)
    ));
    assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
    assert!(platform.calls.lock().unwrap().is_empty());
    service.tick(NOW).unwrap();
    idle(&service);
    assert!(matches!(
        service.failure_report(&owner.id, &item.id),
        Err(AppError::BroadcastExportEmpty)
    ));
}

#[test]
fn csv_keeps_stable_columns_and_textualizes_formulas_without_exposing_report_metadata() {
    let names = [
        "客户, \"姓名\"",
        "=1+1",
        " +SUM(1,2)",
        "-42",
        "@SUM(A1)",
        "\t=1",
        "\u{feff}=1",
        "line\r\nnext",
    ];
    let report = BroadcastFailureReport {
        account_id: "private-account".into(),
        job_id: "private-job".into(),
        revision: 123,
        rows: names
            .iter()
            .map(|name| BroadcastFailureRow {
                name: (*name).into(),
                target_id: Some("12025550101@c.us".into()),
                status: BroadcastFailureStatus::NotSubmitted,
                code: BroadcastIssue::TargetChanged,
            })
            .collect(),
    };
    let csv = report.to_csv();
    let lines: Vec<_> = csv.split("\r\n").collect();
    assert_eq!(lines[0], "\u{feff}联系人,聊天ID,失败原因,发送状态");
    assert_eq!(lines.len(), names.len() + 2);
    assert_eq!(
        lines[1],
        "\"客户, \"\"姓名\"\"\",\"12025550101@c.us\",\"TARGET_CHANGED\",\"NOT_SUBMITTED\""
    );
    for line in &lines[2..8] {
        assert!(line.starts_with("\"'"));
    }
    assert!(lines[8].starts_with("\"line  next\""));
    assert!(!csv.contains("private-account"));
    assert!(!csv.contains("private-job"));
}
