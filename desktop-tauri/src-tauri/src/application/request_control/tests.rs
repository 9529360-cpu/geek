use super::*;

#[test]
fn a_child_budget_never_extends_its_parent_and_expiry_does_not_cancel_other_phases() {
    let parent = RequestControl::new(Duration::from_secs(50));
    let child = parent.limited(Duration::from_secs(35));
    assert!(child.deadline < parent.deadline);
    assert!(child.remaining().unwrap() <= Duration::from_secs(35));
    assert_eq!(
        child.limited(Duration::from_secs(90)).deadline,
        child.deadline
    );
    let expired = child.limited(Duration::ZERO);
    assert_eq!(expired.check(), Err(AppError::TranslationTimeout));
    assert!(parent.check().is_ok());
    assert!(child.check().is_ok());
    assert_eq!(parent.limited(Duration::MAX).deadline, parent.deadline);
}

#[test]
fn child_and_parent_share_explicit_cancellation_in_both_directions() {
    for cancel_child in [false, true] {
        let parent = RequestControl::new(Duration::from_secs(50));
        let child = parent.limited(Duration::from_secs(35));
        if cancel_child {
            child.cancel();
        } else {
            parent.cancel();
        }
        assert_eq!(parent.check(), Err(AppError::TranslationCancelled));
        assert_eq!(child.check(), Err(AppError::TranslationCancelled));
    }
}

#[test]
fn a_limited_control_preserves_document_and_session_cancellation() {
    let document = Arc::new(AtomicBool::new(false));
    let session = Arc::new(AtomicBool::new(false));
    let parent = RequestControl::new(Duration::from_secs(50))
        .with_cancel(Arc::clone(&document))
        .with_cancel(Arc::clone(&session));
    let child = parent.limited(Duration::from_secs(35));
    session.store(true, Ordering::Release);
    assert_eq!(parent.check(), Err(AppError::TranslationCancelled));
    assert_eq!(child.check(), Err(AppError::TranslationCancelled));
    assert!(!document.load(Ordering::Acquire));
}
