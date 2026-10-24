use super::*;

fn translation_request(intent: TranslationIntent) -> FixedRequest<'static> {
    FixedRequest {
        endpoint: Endpoint::Translate,
        bearer: Some("synthetic-short-token"),
        body: Some("{\"text\":\"Synthetic\\nmessage\"}"),
        request_id: Some("00000000-0000-4000-8000-000000000042"),
        deadline_ms: Some(50_000),
        translation_intent: Some(intent),
    }
}

#[test]
fn real_request_builder_preserves_id_body_and_fixed_intent_with_thirty_second_header_cap() {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let control = RequestControl::new(Duration::from_secs(50));
    for (intent, header) in [
        (TranslationIntent::MessageDisplay, "message-display"),
        (TranslationIntent::OutgoingSend, "outgoing-send"),
    ] {
        let input = translation_request(intent);
        let request = service_request(&client, &input, &control)
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.url().as_str(), Endpoint::Translate.url());
        assert_eq!(request.headers()["X-Geek-Translation-Intent"], header);
        assert_eq!(request.headers()["X-Request-ID"], input.request_id.unwrap());
        assert_eq!(request.headers()["X-Geek-Deadline-Ms"], "30000");
        assert_eq!(
            request.body().unwrap().as_bytes().unwrap(),
            input.body.unwrap().as_bytes()
        );
        assert_eq!(
            request.headers()["Authorization"],
            "Bearer synthetic-short-token"
        );
    }
}

#[test]
fn the_header_uses_the_existing_shorter_budget_and_cancelled_work_builds_no_request() {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let parent = RequestControl::new(Duration::from_secs(5));
    let child = parent.limited(Duration::from_secs(35));
    let input = translation_request(TranslationIntent::OutgoingSend);
    let request = service_request(&client, &input, &child)
        .unwrap()
        .build()
        .unwrap();
    let budget = request.headers()["X-Geek-Deadline-Ms"]
        .to_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    assert!((1..=5000).contains(&budget));
    parent.cancel();
    assert!(matches!(
        service_request(&client, &input, &child),
        Err(AppError::TranslationCancelled)
    ));
}

#[test]
fn authentication_endpoints_never_receive_an_intent_and_missing_translation_intent_is_rejected() {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let control = RequestControl::new(Duration::from_secs(10));
    for endpoint in [
        Endpoint::Login,
        Endpoint::Me,
        Endpoint::Status,
        Endpoint::Quota,
        Endpoint::TranslationToken,
    ] {
        let mut input = FixedRequest::authenticated(endpoint, "synthetic-login-token");
        let request = service_request(&client, &input, &control)
            .unwrap()
            .build()
            .unwrap();
        assert!(!request.headers().contains_key("X-Geek-Translation-Intent"));
        assert!(!request.headers().contains_key("X-Geek-Deadline-Ms"));
        input.translation_intent = Some(TranslationIntent::OutgoingSend);
        assert!(matches!(
            service_request(&client, &input, &control),
            Err(AppError::NetworkResponseInvalid)
        ));
    }
    let mut missing = translation_request(TranslationIntent::MessageDisplay);
    missing.translation_intent = None;
    assert!(matches!(
        service_request(&client, &missing, &control),
        Err(AppError::NetworkResponseInvalid)
    ));
}

#[test]
fn public_health_builder_cannot_acquire_credentials_body_billing_headers_or_another_endpoint() {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let control = RequestControl::new(Duration::from_secs(5));
    let input = FixedRequest::translation_health();
    let request = service_request(&client, &input, &control)
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(request.method(), reqwest::Method::GET);
    assert_eq!(
        request.url().as_str(),
        "https://geek-translate.9529360.workers.dev/health"
    );
    assert!(request.body().is_none());
    for header in [
        "Authorization",
        "Content-Type",
        "X-Request-ID",
        "X-Geek-Deadline-Ms",
        "X-Geek-Translation-Intent",
    ] {
        assert!(!request.headers().contains_key(header));
    }
    assert_eq!(Endpoint::TranslationHealth.response_limit(), 16 * 1024);
    assert_eq!(Endpoint::Translate.response_limit(), MAX_RESPONSE_BYTES);
    for field in 0..5 {
        let mut input = FixedRequest::translation_health();
        match field {
            0 => input.bearer = Some("synthetic-token"),
            1 => input.body = Some("{}"),
            2 => input.request_id = Some("synthetic-id"),
            3 => input.deadline_ms = Some(5000),
            _ => input.translation_intent = Some(TranslationIntent::OutgoingSend),
        }
        assert!(matches!(
            service_request(&client, &input, &control),
            Err(AppError::NetworkResponseInvalid)
        ));
    }
}
