//! Public gateway observations, never subscription or translation authority.
use super::error::AppError;
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRouteHealth {
    pub configured: bool,
    pub healthy: bool,
    pub latency_ms: Option<u64>,
    pub translation_latency_ms: Option<u64>,
    pub code: Option<AppError>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranslationHealthRoutes {
    pub primary: TranslationRouteHealth,
    pub backup: TranslationRouteHealth,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranslationHealthSnapshot {
    pub ok: bool,
    pub endpoint_count: u8,
    pub available_count: u8,
    pub routes: TranslationHealthRoutes,
    pub recommended_route: Option<String>,
}

impl TranslationHealthSnapshot {
    /// The native transport has one fixed translation gateway. A POST's route
    /// tag and the worker's provider records do not create another endpoint.
    pub fn single_primary(healthy: bool, latency_ms: Option<u64>, code: Option<AppError>) -> Self {
        Self {
            ok: healthy,
            endpoint_count: 1,
            available_count: u8::from(healthy),
            routes: TranslationHealthRoutes {
                primary: TranslationRouteHealth {
                    configured: true,
                    healthy,
                    latency_ms,
                    translation_latency_ms: None,
                    code,
                },
                backup: TranslationRouteHealth {
                    configured: false,
                    healthy: false,
                    latency_ms: None,
                    translation_latency_ms: None,
                    code: None,
                },
            },
            recommended_route: healthy.then(|| "primary".into()),
        }
    }
}
