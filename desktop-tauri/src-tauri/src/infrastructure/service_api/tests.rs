use super::*;
use serde_json::{json, Value};
use std::{collections::VecDeque, sync::Mutex, time::Duration};

const ACCOUNT_NO: &str = "GK-0123456789abcdef0123456789abcdef";
const EMAIL: &str = "fixture@example.invalid";

struct Observed {
    endpoint: Endpoint,
    proxy: ProxyConfig,
    bearer: Option<String>,
    body: Option<Value>,
    id: Option<String>,
    budget: Option<u64>,
}

struct Step {
    response: Result<HttpResponse>,
    cancel: bool,
}

struct Script {
    steps: Mutex<VecDeque<Step>>,
    observed: Mutex<Vec<Observed>>,
}

impl ServiceHttp for Script {
    fn request(
        &self,
        proxy: &ProxyConfig,
        request: &FixedRequest<'_>,
        control: &RequestControl,
    ) -> Result<HttpResponse> {
        self.observed.lock().unwrap().push(Observed {
            endpoint: request.endpoint,
            proxy: proxy.clone(),
            bearer: request.bearer.map(str::to_owned),
            body: request.body.map(|body| serde_json::from_str(body).unwrap()),
            id: request.request_id.map(str::to_owned),
            budget: request.deadline_ms,
        });
        let step = self
            .steps
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected request or hidden retry");
        if step.cancel {
            control.cancel();
        }
        step.response
    }
}

fn reply(status: u16, body: Value) -> Step {
    Step {
        response: Ok(HttpResponse {
            status,
            body: Zeroizing::new(serde_json::to_vec(&body).unwrap()),
        }),
        cancel: false,
    }
}

fn api(steps: impl IntoIterator<Item = Step>) -> (NativeApi, Arc<Script>) {
    let script = Arc::new(Script {
        steps: Mutex::new(steps.into_iter().collect()),
        observed: Mutex::new(Vec::new()),
    });
    (
        NativeApi {
            http: script.clone(),
        },
        script,
    )
}

fn control() -> RequestControl {
    RequestControl::new(Duration::from_secs(10))
}

fn expect_error<T>(result: Result<T>, expected: AppError) {
    assert_eq!(result.err(), Some(expected));
}

fn user() -> Value {
    json!({ "id": 42, "email": EMAIL, "account_no": ACCOUNT_NO })
}

fn request() -> TranslationRequest {
    TranslationRequest {
        id: "00000000-0000-4000-8000-000000000042".into(),
        text: "Hello \"fixture\"\n你好".into(),
        source: "auto".into(),
        target: "it".into(),
        provider: "auto".into(),
        route: "backup".into(),
    }
}

fn translated() -> Value {
    json!({ "text": "Ciao", "source": "auto", "target": "it", "engine": "gemini", "route": "backup", "remaining_chars": 100 })
}

fn proxy() -> ProxyConfig {
    ProxyConfig::Socks5 {
        host: "127.0.0.1".into(),
        port: 1080,
    }
}

#[test]
fn login_sends_only_the_original_json_contract_over_system_without_bearer() {
    let (api, script) = api([reply(
        200,
        json!({ "ok": true, "token": "fixture-login-token", "user": user() }),
    )]);
    let password = "fixture-\"password\"\n";
    let result = api.login(EMAIL, password, &control()).unwrap();
    assert_eq!(result.user.account_no, ACCOUNT_NO);
    assert_eq!(result.token.as_str(), "fixture-login-token");
    let requests = script.observed.lock().unwrap();
    assert_eq!(requests.len(), 1);
    let call = &requests[0];
    assert!(call.endpoint == Endpoint::Login);
    assert_eq!(call.endpoint.method(), "POST");
    assert!(matches!(call.proxy, ProxyConfig::System));
    assert_eq!(
        call.body,
        Some(json!({ "email": EMAIL, "password": password }))
    );
    assert!(call.bearer.is_none() && call.id.is_none() && call.budget.is_none());
}

#[test]
fn refresh_requires_me_identity_and_consistent_status_but_accepts_zero_balance() {
    let (api, script) = api([
        reply(200, json!({ "ok": true, "user": user() })),
        reply(
            200,
            json!({ "ok": true, "valid": false, "remaining_chars": 0 }),
        ),
    ]);
    let result = api.refresh("fixture-login-token", &control()).unwrap();
    assert_eq!(result.remaining_chars, 0);
    assert_eq!(result.user.id, 42);
    let requests = script.observed.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].endpoint == Endpoint::Me && requests[1].endpoint == Endpoint::Status);
    for call in requests.iter() {
        assert_eq!(call.endpoint.method(), "GET");
        assert!(matches!(call.proxy, ProxyConfig::System));
        assert_eq!(call.bearer.as_deref(), Some("fixture-login-token"));
        assert!(call.body.is_none() && call.id.is_none() && call.budget.is_none());
    }
}

#[test]
fn malformed_me_stops_before_status_and_mismatched_login_identity_is_rejected() {
    let mut invalid = user();
    invalid["account_no"] = json!("GK-42");
    let (api, script) = api([reply(200, json!({ "ok": true, "user": invalid }))]);
    expect_error(
        api.refresh("fixture-token", &control()),
        AppError::NetworkResponseInvalid,
    );
    assert_eq!(script.observed.lock().unwrap().len(), 1);
    let (api, _) = self::api([reply(
        200,
        json!({ "ok": true, "token": "fixture-token", "user": user() }),
    )]);
    expect_error(
        api.login("another@example.invalid", "fixture-password", &control()),
        AppError::NetworkResponseInvalid,
    );
}

#[test]
fn quota_and_short_token_keep_the_frozen_account_proxy_and_unix_seconds() {
    let (api, script) = api([
        reply(
            200,
            json!({ "ok": true, "email": EMAIL, "remaining_chars": 88 }),
        ),
        reply(
            200,
            json!({ "ok": true, "token": "fixture-short-token", "expires_at": 1_800_000_300_u64 }),
        ),
    ]);
    let route = proxy();
    let control = control();
    assert_eq!(
        api.quota("fixture-login-token", &route, &control).unwrap(),
        88
    );
    let token = api
        .translation_token("fixture-login-token", &route, &control)
        .unwrap();
    assert_eq!(token.expires_at, 1_800_000_300);
    assert_eq!(token.token.as_str(), "fixture-short-token");
    let calls = script.observed.lock().unwrap();
    assert!(
        calls[0].endpoint == Endpoint::Quota && calls[1].endpoint == Endpoint::TranslationToken
    );
    assert_eq!(calls[1].endpoint.method(), "POST");
    for call in calls.iter() {
        assert_eq!(call.proxy, route);
        assert_eq!(call.bearer.as_deref(), Some("fixture-login-token"));
        assert!(call.body.is_none());
    }
}

#[test]
fn translation_success_has_no_ok_envelope_and_null_balance_does_not_trigger_retry() {
    let mut response = translated();
    response["remaining_chars"] = Value::Null;
    response["replayed"] = json!(true);
    let (api, script) = api([reply(200, response)]);
    let request = request();
    let route = proxy();
    let result = api
        .translate("fixture-short-token", &request, &route, &control())
        .unwrap();
    assert_eq!(result.text, "Ciao");
    assert_eq!(result.remaining_chars, None);
    let calls = script.observed.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert!(call.endpoint == Endpoint::Translate);
    assert_eq!(call.proxy, route);
    assert_eq!(call.bearer.as_deref(), Some("fixture-short-token"));
    assert_eq!(call.id.as_deref(), Some(request.id.as_str()));
    assert!(call
        .budget
        .is_some_and(|budget| budget > 0 && budget <= 10_000));
    assert_eq!(
        call.body,
        Some(json!({
            "text": request.text, "source": "auto", "target": "it", "provider": "auto",
            "route": "backup", "operationRoute": "backup",
        }))
    );
}

#[test]
fn status_valid_must_mean_positive_balance_and_balance_must_be_a_safe_integer() {
    for status in [
        json!({ "ok": true, "valid": true, "remaining_chars": 0 }),
        json!({ "ok": true, "valid": false, "remaining_chars": 1 }),
        json!({ "ok": false, "valid": true, "remaining_chars": 1 }),
        json!({ "ok": true, "valid": "true", "remaining_chars": 1 }),
        json!({ "ok": true, "valid": false, "remaining_chars": null }),
        json!({ "ok": true, "valid": true, "remaining_chars": 9_007_199_254_740_992_u64 }),
        json!({ "ok": true, "valid": true, "remaining_chars": 1.5 }),
    ] {
        let (api, _) = api([
            reply(200, json!({ "ok": true, "user": user() })),
            reply(200, status),
        ]);
        expect_error(
            api.refresh("fixture-token", &control()),
            AppError::NetworkResponseInvalid,
        );
    }
}

#[test]
fn malformed_token_and_quota_payloads_are_never_authoritative() {
    for (endpoint, body) in [
        (
            Endpoint::TranslationToken,
            json!({ "ok": true, "token": "fixture", "expires_at": 0 }),
        ),
        (
            Endpoint::TranslationToken,
            json!({ "ok": true, "token": "bad\ntoken", "expires_at": 1_800_000_300_u64 }),
        ),
        (
            Endpoint::TranslationToken,
            json!({ "ok": true, "token": "fixture", "expires_at": "1800000300" }),
        ),
        (
            Endpoint::Quota,
            json!({ "ok": true, "email": EMAIL, "remaining_chars": null }),
        ),
        (
            Endpoint::Quota,
            json!({ "ok": true, "email": EMAIL, "remaining_chars": -1 }),
        ),
        (
            Endpoint::Quota,
            json!({ "ok": true, "email": EMAIL, "remaining_chars": 9_007_199_254_740_992_u64 }),
        ),
        (Endpoint::Quota, json!({ "ok": true, "remaining_chars": 1 })),
    ] {
        let (api, _) = api([reply(200, body)]);
        let result = if endpoint == Endpoint::Quota {
            api.quota("fixture", &proxy(), &control()).map(|_| ())
        } else {
            api.translation_token("fixture", &proxy(), &control())
                .map(|_| ())
        };
        expect_error(result, AppError::NetworkResponseInvalid);
    }
}

#[test]
fn translation_reply_must_match_the_original_language_route_and_quota_contract() {
    for (field, value) in [
        ("source", json!("en")),
        ("target", json!("fr")),
        ("route", json!("primary")),
        ("engine", json!("")),
        ("engine", json!("bad\nengine")),
        ("remaining_chars", json!(-1)),
        ("remaining_chars", json!(1.5)),
        ("remaining_chars", json!("100")),
        ("remaining_chars", json!(9_007_199_254_740_992_u64)),
    ] {
        let mut response = translated();
        response[field] = value;
        let (api, _) = api([reply(200, response)]);
        expect_error(
            api.translate("fixture", &request(), &proxy(), &control()),
            AppError::NetworkResponseInvalid,
        );
    }
    let mut response = translated();
    response.as_object_mut().unwrap().remove("remaining_chars");
    let (api, _) = api([reply(200, response)]);
    expect_error(
        api.translate("fixture", &request(), &proxy(), &control()),
        AppError::NetworkResponseInvalid,
    );
}

#[test]
fn empty_control_bearing_or_oversized_translation_output_is_rejected() {
    for text in [
        " \n".to_string(),
        "bad\0text".to_string(),
        "中".repeat(26_667),
    ] {
        let mut response = translated();
        response["text"] = json!(text);
        let (api, _) = api([reply(200, response)]);
        expect_error(
            api.translate("fixture", &request(), &proxy(), &control()),
            AppError::TranslationOutputInvalid,
        );
    }
}

#[test]
fn server_deadline_header_is_capped_without_replacing_the_shared_budget() {
    let (api, script) = api([reply(200, translated())]);
    let control = RequestControl::new(Duration::from_secs(60));
    api.translate("fixture", &request(), &proxy(), &control)
        .unwrap();
    assert_eq!(script.observed.lock().unwrap()[0].budget, Some(30_000));
    assert!(control.remaining().unwrap() > Duration::from_secs(30));
}

mod errors;
