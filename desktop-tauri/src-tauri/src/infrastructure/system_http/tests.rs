//! Scripted route and WinRT cancellation-owner regressions; no OS network calls.
use super::*;
use std::{cell::RefCell, rc::Rc};

#[test]
fn direct_requires_an_explicit_empty_route_permission() {
    assert!(matches!(empty_route(true), Ok(SystemRoute::Direct)));
    assert!(matches!(
        empty_route(false),
        Err(AppError::NetworkUnavailable)
    ));
}

#[test]
fn accepts_only_supported_proxy_endpoints_and_preserves_remote_socks_dns() {
    for (input, expected) in [
        ("http://proxy.example:8080", "http://proxy.example:8080/"),
        ("https://proxy.example/", "https://proxy.example/"),
        ("HTTP://proxy.example:80/", "http://proxy.example/"),
        (
            "socks5://proxy.example:1080",
            "socks5h://proxy.example:1080",
        ),
        ("http://[::1]:8080", "http://[::1]:8080/"),
    ] {
        let Ok(SystemRoute::Proxy(actual)) = proxy_route(input) else {
            panic!("valid test route was rejected");
        };
        assert_eq!(actual, expected);
    }
}

#[test]
fn rejects_unsupported_or_credential_bearing_routes_without_direct_fallback() {
    for input in [
        "",
        "direct://",
        "file:///tmp/proxy",
        "wss://proxy.example:80",
        "socks://proxy.example:1080",
        "socks4://proxy.example:1080",
        "socks5h://proxy.example:1080",
        "socks5://proxy.example",
        "http://user:password@proxy.example:80",
        "http://user@proxy.example:80",
        "http://@proxy.example:80",
        "http://proxy.example/?credential=value",
        "http://proxy.example/#fragment",
        "http://proxy.example/path",
        "http://proxy.example/../",
        "http://proxy.example/%2e/",
        "http://proxy.example//",
        "http://proxy.example\\path",
        "http://proxy.example:0",
        "http://proxy.example:65536",
        "http://",
        " http://proxy.example:80",
        "http://proxy.example:80\n",
        "http://proxy.example:\t80",
        "http://proxy.example\u{00a0}",
    ] {
        assert!(matches!(
            proxy_route(input),
            Err(AppError::NetworkUnavailable)
        ));
    }
    let oversized = format!("http://{}.example", "a".repeat(MAX_PROXY_URI_UNITS));
    assert!(matches!(
        proxy_route(&oversized),
        Err(AppError::NetworkUnavailable)
    ));
}

type Events = Rc<RefCell<Vec<&'static str>>>;

struct ScriptedOperation {
    events: Events,
    status: Result<OperationStatus>,
    result: Result<u8>,
    cancel_on_status: Option<RequestControl>,
    cancel_on_result: Option<RequestControl>,
}

impl ScriptedOperation {
    fn new(status: Result<OperationStatus>) -> (Self, Events) {
        let events = Rc::new(RefCell::new(Vec::new()));
        (
            Self {
                events: events.clone(),
                status,
                result: Ok(7),
                cancel_on_status: None,
                cancel_on_result: None,
            },
            events,
        )
    }
}

impl Operation for ScriptedOperation {
    type Output = u8;

    fn status(&self) -> Result<OperationStatus> {
        self.events.borrow_mut().push("status");
        if let Some(control) = &self.cancel_on_status {
            control.cancel();
        }
        self.status
    }

    fn results(&self) -> Result<Self::Output> {
        self.events.borrow_mut().push("results");
        if let Some(control) = &self.cancel_on_result {
            control.cancel();
        }
        self.result
    }

    fn cancel(&self) {
        self.events.borrow_mut().push("cancel");
    }

    fn close(&self) {
        self.events.borrow_mut().push("close");
    }
}

#[test]
fn completed_operation_reads_once_and_closes_without_canceling() {
    let control = RequestControl::new(Duration::from_secs(10));
    let (operation, events) = ScriptedOperation::new(Ok(OperationStatus::Completed));
    assert_eq!(wait_operation(operation, &control), Ok(7));
    assert_eq!(*events.borrow(), ["status", "results", "close"]);
}

#[test]
fn expired_budget_cancels_even_an_already_completed_operation_before_polling() {
    let control = RequestControl::new(Duration::ZERO);
    let (operation, events) = ScriptedOperation::new(Ok(OperationStatus::Completed));
    assert_eq!(
        wait_operation(operation, &control),
        Err(AppError::TranslationTimeout)
    );
    assert_eq!(*events.borrow(), ["cancel"]);
}

#[test]
fn parent_cancellation_cancels_the_native_operation_without_reading_results() {
    use std::sync::{atomic::AtomicBool, Arc};
    let cancelled = Arc::new(AtomicBool::new(true));
    let control = RequestControl::new(Duration::from_secs(10)).with_cancel(cancelled);
    let (operation, events) = ScriptedOperation::new(Ok(OperationStatus::Completed));
    assert_eq!(
        wait_operation(operation, &control),
        Err(AppError::TranslationCancelled)
    );
    assert_eq!(*events.borrow(), ["cancel"]);
}

#[test]
fn cancellation_during_a_pending_poll_cancels_instead_of_waiting_again() {
    let control = RequestControl::new(Duration::from_secs(10));
    let (mut operation, events) = ScriptedOperation::new(Ok(OperationStatus::Started));
    operation.cancel_on_status = Some(control.clone());
    assert_eq!(
        wait_operation(operation, &control),
        Err(AppError::TranslationCancelled)
    );
    assert_eq!(*events.borrow(), ["status", "cancel"]);
}

#[test]
fn late_completion_cannot_pass_the_post_status_cancellation_gate() {
    let control = RequestControl::new(Duration::from_secs(10));
    let (mut operation, events) = ScriptedOperation::new(Ok(OperationStatus::Completed));
    operation.cancel_on_status = Some(control.clone());
    assert_eq!(
        wait_operation(operation, &control),
        Err(AppError::TranslationCancelled)
    );
    assert_eq!(*events.borrow(), ["status", "cancel"]);
}

#[test]
fn cancellation_while_reading_results_discards_the_route_and_cancels() {
    let control = RequestControl::new(Duration::from_secs(10));
    let (mut operation, events) = ScriptedOperation::new(Ok(OperationStatus::Completed));
    operation.cancel_on_result = Some(control.clone());
    assert_eq!(
        wait_operation(operation, &control),
        Err(AppError::TranslationCancelled)
    );
    assert_eq!(*events.borrow(), ["status", "results", "cancel"]);
}

#[test]
fn native_status_and_result_failures_do_not_become_direct_or_leak_native_errors() {
    for (status, expected) in [
        (
            Ok(OperationStatus::Canceled),
            AppError::TranslationCancelled,
        ),
        (Ok(OperationStatus::Failed), AppError::NetworkUnavailable),
        (
            Err(AppError::NetworkUnavailable),
            AppError::NetworkUnavailable,
        ),
    ] {
        let control = RequestControl::new(Duration::from_secs(10));
        let (operation, events) = ScriptedOperation::new(status);
        assert_eq!(wait_operation(operation, &control), Err(expected));
        assert_eq!(*events.borrow(), ["status", "cancel"]);
    }
    let control = RequestControl::new(Duration::from_secs(10));
    let (mut operation, events) = ScriptedOperation::new(Ok(OperationStatus::Completed));
    operation.result = Err(AppError::NetworkUnavailable);
    assert_eq!(
        wait_operation(operation, &control),
        Err(AppError::NetworkUnavailable)
    );
    assert_eq!(*events.borrow(), ["status", "results", "cancel"]);
}

#[test]
fn dropping_a_pending_owner_always_cancels_and_never_closes_started_work() {
    let (operation, events) = ScriptedOperation::new(Ok(OperationStatus::Started));
    drop(Pending {
        operation,
        completed: false,
    });
    assert_eq!(*events.borrow(), ["cancel"]);
}
