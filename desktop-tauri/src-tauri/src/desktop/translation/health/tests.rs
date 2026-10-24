use super::*;
use std::sync::atomic::Ordering;

#[test]
fn health_gate_refuses_concurrent_work_without_waiting_or_invoking_an_operation() {
    let gate = Mutex::new(());
    let _held = gate.lock().unwrap();
    assert_eq!(
        run_health(&gate, Arc::new(AtomicBool::new(false)), |_| panic!(
            "duplicate health request"
        ))
        .unwrap_err(),
        AppError::TranslationInProgress
    );
}

#[test]
fn successful_and_failed_health_operations_release_the_single_gate_and_keep_the_five_second_budget()
{
    let gate = Mutex::new(());
    let stop = Arc::new(AtomicBool::new(false));
    let result = run_health(&gate, Arc::clone(&stop), |control| {
        assert!(control.remaining()? <= Duration::from_secs(5));
        Ok(TranslationHealthSnapshot::single_primary(
            true,
            Some(12),
            None,
        ))
    })
    .unwrap();
    assert_eq!(result.routes.primary.latency_ms, Some(12));
    assert!(gate.try_lock().is_ok());
    assert_eq!(
        run_health(&gate, stop, |_| Err(AppError::NetworkUnavailable)).unwrap_err(),
        AppError::NetworkUnavailable
    );
    assert!(gate.try_lock().is_ok());
}

#[test]
fn shutdown_prevents_new_requests_and_cancels_the_current_request_control() {
    let gate = Mutex::new(());
    let stop = Arc::new(AtomicBool::new(false));
    let result = run_health(&gate, Arc::clone(&stop), |control| {
        stop.store(true, Ordering::Release);
        control.check()?;
        panic!("cancelled health was accepted")
    });
    assert_eq!(result.unwrap_err(), AppError::TranslationCancelled);
    assert_eq!(
        run_health(&gate, stop, |_| panic!("shutdown started a request")).unwrap_err(),
        AppError::TranslationCancelled
    );
    assert!(gate.try_lock().is_ok());
}
