use super::NativeApi;
use crate::{
    application::ports::{RequestControl, TranslationHealthGateway},
    domain::{
        error::{AppError, Result},
        proxy::ProxyConfig,
    },
    infrastructure::http::{FixedRequest, MAX_HEALTH_RESPONSE_BYTES},
};
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct HealthWire {
    ok: bool,
    service: String,
}

impl TranslationHealthGateway for NativeApi {
    fn health(&self, control: &RequestControl) -> Result<bool> {
        let control = control.limited(Duration::from_secs(5));
        control.check()?;
        let response = self.http.request(
            &ProxyConfig::System,
            &FixedRequest::translation_health(),
            &control,
        )?;
        control.check()?;
        if response.body.len() > MAX_HEALTH_RESPONSE_BYTES {
            return Err(AppError::NetworkResponseInvalid);
        }
        if response.status != 200 && response.status != 503 {
            return Err(AppError::NetworkUnavailable);
        }
        let wire: HealthWire =
            serde_json::from_slice(&response.body).map_err(|_| AppError::NetworkResponseInvalid)?;
        if wire.service != "geek-translate" || (response.status == 503 && wire.ok) {
            return Err(AppError::NetworkResponseInvalid);
        }
        control.check()?;
        Ok(wire.ok)
    }
}

#[cfg(test)]
mod tests;
