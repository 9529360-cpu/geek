use super::session_support;
use crate::{
    application::{
        request_control::RequestControl,
        translation::TranslationService,
        translation_ports::{
            TranslationGateway, TranslationHealthGateway, TranslationReply, TranslationRequest,
            TranslationToken,
        },
    },
    domain::{
        error::{AppError, Result},
        proxy::ProxyConfig,
    },
};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

struct HealthGateway {
    reply: Result<bool>,
    cancel: bool,
    late: bool,
    calls: AtomicUsize,
}

impl HealthGateway {
    fn new(reply: Result<bool>) -> Self {
        Self {
            reply,
            cancel: false,
            late: false,
            calls: AtomicUsize::new(0),
        }
    }
}

impl TranslationHealthGateway for HealthGateway {
    fn health(&self, control: &RequestControl) -> Result<bool> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        assert!(control.remaining()? <= Duration::from_secs(5));
        if self.cancel {
            control.cancel();
        }
        if self.late {
            let _ = control.wait(Duration::from_millis(40));
        }
        self.reply
    }
}

impl TranslationGateway for HealthGateway {
    fn quota(&self, _: &str, _: &ProxyConfig, _: &RequestControl) -> Result<u64> {
        panic!("health must not request account quota")
    }
    fn translation_token(
        &self,
        _: &str,
        _: &ProxyConfig,
        _: &RequestControl,
    ) -> Result<TranslationToken> {
        panic!("health must not request a translation token")
    }
    fn translate(
        &self,
        _: &str,
        _: &TranslationRequest,
        _: &ProxyConfig,
        _: &RequestControl,
    ) -> Result<TranslationReply> {
        panic!("health must not create translation usage")
    }
}

fn control() -> RequestControl {
    RequestControl::new(Duration::from_secs(30))
}

#[test]
fn gateway_can_be_checked_while_logged_out_without_authentication_or_persistent_changes() {
    let (session, repository, transport, _) = session_support::setup();
    let session = Arc::new(session);
    let before = serde_json::to_value(session.snapshot().unwrap()).unwrap();
    let gateway = Arc::new(HealthGateway::new(Ok(true)));
    let service = TranslationService::new(Arc::clone(&session), Arc::clone(&gateway));
    let result = service.health(&control()).unwrap();
    assert!(result.ok);
    assert_eq!(result.endpoint_count, 1);
    assert_eq!(result.available_count, 1);
    assert_eq!(result.recommended_route.as_deref(), Some("primary"));
    assert!(result.routes.primary.configured && result.routes.primary.healthy);
    assert!(result.routes.primary.latency_ms.is_some());
    assert!(result.routes.primary.translation_latency_ms.is_none());
    assert!(!result.routes.backup.configured && !result.routes.backup.healthy);
    assert!(
        result.routes.backup.latency_ms.is_none()
            && result.routes.backup.translation_latency_ms.is_none()
    );
    assert_eq!(gateway.calls.load(Ordering::SeqCst), 1);
    assert_eq!(transport.refresh_calls.load(Ordering::SeqCst), 0);
    assert!(transport.emails.lock().unwrap().is_empty());
    assert_eq!(repository.0.lock().unwrap().successful_writes, 0);
    assert_eq!(
        serde_json::to_value(session.snapshot().unwrap()).unwrap(),
        before
    );
}

#[test]
fn logged_in_health_does_not_refresh_authority_or_spend_the_existing_balance() {
    let (session, repository, transport, _) = session_support::setup();
    session_support::login(&session, &transport, 1, 1234);
    let session = Arc::new(session);
    let before = serde_json::to_value(session.snapshot().unwrap()).unwrap();
    let writes = repository.0.lock().unwrap().successful_writes;
    let refreshes = transport.refresh_calls.load(Ordering::SeqCst);
    for reply in [Ok(true), Ok(false), Err(AppError::NetworkUnavailable)] {
        let service =
            TranslationService::new(Arc::clone(&session), Arc::new(HealthGateway::new(reply)));
        service.health(&control()).unwrap();
        assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
        assert_eq!(transport.refresh_calls.load(Ordering::SeqCst), refreshes);
        assert_eq!(
            serde_json::to_value(session.snapshot().unwrap()).unwrap(),
            before
        );
    }
}

#[test]
fn unhealthy_http_observation_and_failed_transport_keep_latency_meanings_distinct() {
    let (session, _, _, _) = session_support::setup();
    let session = Arc::new(session);
    for (reply, measured) in [
        (Ok(false), true),
        (Err(AppError::NetworkUnavailable), false),
        (Err(AppError::NetworkResponseInvalid), false),
        (Err(AppError::TranslationTimeout), false),
    ] {
        let service =
            TranslationService::new(Arc::clone(&session), Arc::new(HealthGateway::new(reply)));
        let result = service.health(&control()).unwrap();
        assert!(!result.ok && !result.routes.primary.healthy);
        assert_eq!(result.available_count, 0);
        assert_eq!(result.endpoint_count, 1);
        assert_eq!(result.routes.primary.latency_ms.is_some(), measured);
        assert!(result.routes.primary.code.is_some());
        assert!(result.recommended_route.is_none());
        let json = serde_json::to_value(&result).unwrap();
        assert!(json["routes"]["primary"]["translationLatencyMs"].is_null());
        assert!(json["routes"]["backup"]["translationLatencyMs"].is_null());
    }
}

#[test]
fn already_cancelled_or_expired_work_never_calls_the_gateway() {
    let (session, _, _, _) = session_support::setup();
    let gateway = Arc::new(HealthGateway::new(Ok(true)));
    let service = TranslationService::new(Arc::new(session), Arc::clone(&gateway));
    let cancelled = control();
    cancelled.cancel();
    assert_eq!(
        service.health(&cancelled).unwrap_err(),
        AppError::TranslationCancelled
    );
    assert_eq!(
        service
            .health(&RequestControl::new(Duration::ZERO))
            .unwrap_err(),
        AppError::TranslationTimeout
    );
    assert_eq!(gateway.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn late_success_is_rejected_after_cancellation_or_the_callers_shorter_deadline() {
    let (session, _, _, _) = session_support::setup();
    let gateway = Arc::new(HealthGateway {
        cancel: true,
        ..HealthGateway::new(Ok(true))
    });
    let session = Arc::new(session);
    let service = TranslationService::new(Arc::clone(&session), gateway);
    assert_eq!(
        service.health(&control()).unwrap_err(),
        AppError::TranslationCancelled
    );
    let gateway = Arc::new(HealthGateway {
        late: true,
        ..HealthGateway::new(Ok(true))
    });
    let service = TranslationService::new(session, gateway);
    let result = service
        .health(&RequestControl::new(Duration::from_millis(15)))
        .unwrap();
    assert!(!result.ok);
    assert_eq!(
        result.routes.primary.code,
        Some(AppError::TranslationTimeout)
    );
    assert!(result.routes.primary.latency_ms.is_none());
}
