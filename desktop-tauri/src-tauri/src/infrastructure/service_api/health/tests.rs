use super::*;
use crate::infrastructure::{
    http::{Endpoint, HttpResponse},
    service_api::ServiceHttp,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use zeroize::Zeroizing;

struct Script {
    reply: Mutex<Option<Result<HttpResponse>>>,
    calls: AtomicUsize,
    cancel: bool,
    stall: bool,
}

impl ServiceHttp for Script {
    fn request(
        &self,
        proxy: &ProxyConfig,
        request: &FixedRequest<'_>,
        control: &RequestControl,
    ) -> Result<HttpResponse> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        assert!(matches!(proxy, ProxyConfig::System));
        assert!(request.endpoint == Endpoint::TranslationHealth);
        assert_eq!(request.endpoint.method(), "GET");
        assert!(request.bearer.is_none() && request.body.is_none() && request.request_id.is_none());
        assert!(request.deadline_ms.is_none() && request.translation_intent.is_none());
        assert!(control.remaining()? <= Duration::from_secs(5));
        if self.cancel {
            control.cancel();
        }
        if self.stall {
            control.wait(Duration::from_secs(6))?;
        }
        self.reply
            .lock()
            .unwrap()
            .take()
            .expect("hidden health retry")
    }
}

fn scripted(status: u16, body: &[u8], cancel: bool, stall: bool) -> (NativeApi, Arc<Script>) {
    let script = Arc::new(Script {
        reply: Mutex::new(Some(Ok(HttpResponse {
            status,
            body: Zeroizing::new(body.to_vec()),
        }))),
        calls: AtomicUsize::new(0),
        cancel,
        stall,
    });
    (
        NativeApi {
            http: script.clone(),
        },
        script,
    )
}

fn control() -> RequestControl {
    RequestControl::new(Duration::from_secs(30))
}

#[test]
fn native_health_uses_one_fixed_public_get_and_ignores_unrelated_provider_details() {
    let (api, script) = scripted(200, br#"{"ok":true,"service":"geek-translate","providers":["a"],"models":{"a":{"healthy":false,"lastError":"not a route"}}}"#, false, false);
    assert!(api.health(&control()).unwrap());
    assert_eq!(script.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn configured_gateway_failure_is_a_false_health_observation_without_an_authenticated_fallback() {
    for status in [200, 503] {
        let (api, script) = scripted(
            status,
            br#"{"ok":false,"service":"geek-translate","providers":[],"models":{}}"#,
            false,
            false,
        );
        assert!(!api.health(&control()).unwrap());
        assert_eq!(script.calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn malformed_oversized_or_other_service_payloads_never_report_healthy() {
    let oversized = vec![b' '; MAX_HEALTH_RESPONSE_BYTES + 1];
    for body in [
        b"not JSON".as_slice(),
        b"{}",
        b"null",
        br#"{"ok":"true","service":"geek-translate"}"#,
        br#"{"ok":true,"service":"another-service"}"#,
        br#"{"ok":false,"ok":true,"service":"geek-translate"}"#,
        oversized.as_slice(),
    ] {
        let (api, script) = scripted(200, body, false, false);
        assert_eq!(
            api.health(&control()).unwrap_err(),
            AppError::NetworkResponseInvalid
        );
        assert_eq!(script.calls.load(Ordering::SeqCst), 1);
    }
    let (api, _) = scripted(
        503,
        br#"{"ok":true,"service":"geek-translate"}"#,
        false,
        false,
    );
    assert_eq!(
        api.health(&control()).unwrap_err(),
        AppError::NetworkResponseInvalid
    );
}

#[test]
fn redirects_and_other_statuses_never_trigger_another_request() {
    for status in [301, 302, 401, 403, 404, 429, 500] {
        let (api, script) = scripted(status, b"untrusted response", false, false);
        assert_eq!(
            api.health(&control()).unwrap_err(),
            AppError::NetworkUnavailable
        );
        assert_eq!(script.calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn cancellation_and_already_expired_budget_cannot_publish_a_health_result() {
    let (api, script) = scripted(
        200,
        br#"{"ok":true,"service":"geek-translate"}"#,
        false,
        false,
    );
    let cancelled = control();
    cancelled.cancel();
    assert_eq!(
        api.health(&cancelled).unwrap_err(),
        AppError::TranslationCancelled
    );
    assert_eq!(
        api.health(&RequestControl::new(Duration::ZERO))
            .unwrap_err(),
        AppError::TranslationTimeout
    );
    assert_eq!(script.calls.load(Ordering::SeqCst), 0);
    let (api, script) = scripted(
        200,
        br#"{"ok":true,"service":"geek-translate"}"#,
        true,
        false,
    );
    assert_eq!(
        api.health(&control()).unwrap_err(),
        AppError::TranslationCancelled
    );
    assert_eq!(script.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn health_transport_cannot_consume_the_longer_callers_thirty_second_budget() {
    let (api, script) = scripted(
        200,
        br#"{"ok":true,"service":"geek-translate"}"#,
        false,
        true,
    );
    let started = std::time::Instant::now();
    assert_eq!(
        api.health(&control()).unwrap_err(),
        AppError::TranslationTimeout
    );
    assert!(started.elapsed() >= Duration::from_secs(4));
    assert_eq!(script.calls.load(Ordering::SeqCst), 1);
}
