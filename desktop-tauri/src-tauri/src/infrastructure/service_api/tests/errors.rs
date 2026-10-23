use super::*;

#[test]
fn known_error_codes_keep_auth_replay_and_timeout_meanings() {
    for (endpoint, status, error, expected) in [
        (
            Endpoint::Login,
            401,
            "invalid_credentials",
            AppError::SessionInvalidCredentials,
        ),
        (
            Endpoint::Login,
            409,
            "password_reset_required",
            AppError::SessionPasswordResetRequired,
        ),
        (
            Endpoint::Me,
            401,
            "session_revoked",
            AppError::SessionRequired,
        ),
        (
            Endpoint::Quota,
            401,
            "unauthorized",
            AppError::SessionRequired,
        ),
        (
            Endpoint::TranslationToken,
            403,
            "account_disabled",
            AppError::SessionAccountDisabled,
        ),
        (
            Endpoint::Login,
            429,
            "rate_limited",
            AppError::SessionRateLimited,
        ),
        (
            Endpoint::Translate,
            401,
            "unauthorized",
            AppError::TranslationUnauthorized,
        ),
        (
            Endpoint::Translate,
            402,
            "quota_exhausted",
            AppError::TranslationQuotaExhausted,
        ),
        (
            Endpoint::Translate,
            409,
            "request_in_progress",
            AppError::TranslationInProgress,
        ),
        (
            Endpoint::Translate,
            409,
            "request_conflict",
            AppError::TranslationConflict,
        ),
        (
            Endpoint::Translate,
            409,
            "duplicate_request",
            AppError::TranslationResultUnavailable,
        ),
        (
            Endpoint::Translate,
            409,
            "completed_result_expired",
            AppError::TranslationResultUnavailable,
        ),
        (
            Endpoint::Translate,
            502,
            "replay_unavailable",
            AppError::TranslationResultUnavailable,
        ),
        (
            Endpoint::Translate,
            502,
            "translation_failed",
            AppError::NetworkUnavailable,
        ),
        (
            Endpoint::Translate,
            503,
            "service_unavailable",
            AppError::NetworkUnavailable,
        ),
        (
            Endpoint::Translate,
            504,
            "deadline_exceeded",
            AppError::TranslationTimeout,
        ),
        (
            Endpoint::Translate,
            499,
            "request_aborted",
            AppError::TranslationCancelled,
        ),
        (
            Endpoint::Translate,
            413,
            "payload_too_large",
            AppError::TranslationInvalid,
        ),
    ] {
        let response = reply(status, json!({ "error": error })).response.unwrap();
        assert_eq!(response_error(endpoint, &response), expected);
    }
}

#[test]
fn unknown_or_malformed_errors_return_only_a_stable_generic_error() {
    for (status, body) in [
        (503, "<html>upstream details</html>"),
        (401, "{}"),
        (401, "{\"error\":123}"),
        (409, "{\"error\":\"unknown-private-details\"}"),
        (503, "{\"error\":\"unauthorized\"}"),
    ] {
        let response = HttpResponse {
            status,
            body: Zeroizing::new(body.as_bytes().to_vec()),
        };
        assert_eq!(
            response_error(Endpoint::Translate, &response),
            AppError::NetworkResponseInvalid
        );
    }
}

#[test]
fn adapter_does_not_retry_401_in_progress_or_network_failure() {
    for step in [
        reply(401, json!({ "error": "unauthorized" })),
        reply(409, json!({ "error": "request_in_progress" })),
        Step {
            response: Err(AppError::NetworkUnavailable),
            cancel: false,
        },
    ] {
        let (api, script) = api([step]);
        assert!(api
            .translate("fixture", &request(), &proxy(), &control())
            .is_err());
        assert_eq!(script.observed.lock().unwrap().len(), 1);
    }
}

#[test]
fn cancellation_prevents_dispatch_and_discards_late_success_or_auth_failure() {
    let (api, script) = api([]);
    let control = control();
    control.cancel();
    expect_error(
        api.refresh("fixture", &control),
        AppError::TranslationCancelled,
    );
    assert!(script.observed.lock().unwrap().is_empty());
    for mut step in [
        reply(200, translated()),
        reply(401, json!({ "error": "unauthorized" })),
    ] {
        step.cancel = true;
        let (api, script) = self::api([step]);
        expect_error(
            api.translate("fixture", &request(), &proxy(), &self::control()),
            AppError::TranslationCancelled,
        );
        assert_eq!(script.observed.lock().unwrap().len(), 1);
    }
}

#[test]
fn request_and_response_limits_fail_without_extra_calls() {
    let (api, script) = api([]);
    let mut oversized = request();
    oversized.text = "x".repeat(32_769);
    expect_error(
        api.translate("fixture", &oversized, &proxy(), &control()),
        AppError::TranslationInvalid,
    );
    assert!(script.observed.lock().unwrap().is_empty());
    let step = Step {
        response: Ok(HttpResponse {
            status: 200,
            body: Zeroizing::new(vec![b' '; MAX_RESPONSE_BYTES + 1]),
        }),
        cancel: false,
    };
    let (api, _) = self::api([step]);
    expect_error(
        api.quota("fixture", &proxy(), &control()),
        AppError::NetworkResponseInvalid,
    );
}
