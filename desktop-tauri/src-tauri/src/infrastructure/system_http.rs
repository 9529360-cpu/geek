//! Resolve the current Windows system route; never infer direct access on failure.
//! HTTP remains in `http`: WinRT's HTTP client can silently supply OS credentials.
use crate::{
    application::ports::RequestControl,
    domain::error::{AppError, Result},
};
use std::time::Duration;
use url::Url;

#[cfg(windows)]
use {
    super::http::Endpoint,
    windows::{
        core::HSTRING,
        Foundation::Uri,
        Networking::Connectivity::{NetworkInformation, ProxyConfiguration},
    },
    windows_future::{AsyncStatus, IAsyncOperation},
    zeroize::Zeroizing,
};

const MAX_PROXY_URI_UNITS: usize = 2048;

// Environment configuration may be sensitive; deliberately no Debug or logging.
pub enum SystemRoute {
    Direct,
    Proxy(String),
}

#[cfg(windows)]
pub fn resolve(endpoint: Endpoint, control: &RequestControl) -> Result<SystemRoute> {
    control.check()?;
    let target =
        Uri::CreateUri(&HSTRING::from(endpoint.url())).map_err(|_| AppError::NetworkUnavailable)?;
    control.check()?;
    // This safe projection activates WinRT on the feature's blocking worker.
    // Resolving every fixed target preserves PAC's per-URI decisions.
    let operation = NetworkInformation::GetProxyConfigurationAsync(&target)
        .map_err(|_| AppError::NetworkUnavailable)?;
    let configuration = wait_operation(operation, control)?;
    let candidates = configuration
        .ProxyUris()
        .map_err(|_| AppError::NetworkUnavailable)?;
    let count = candidates
        .Size()
        .map_err(|_| AppError::NetworkUnavailable)?;
    let route = if count == 0 {
        empty_route(
            configuration
                .CanConnectDirectly()
                .map_err(|_| AppError::NetworkUnavailable)?,
        )?
    } else {
        // Do not inspect later candidates or a direct fallback. Retrying a POST
        // on another route after an ambiguous network failure is not safe.
        let first = candidates
            .GetAt(0)
            .and_then(|uri| uri.RawUri())
            .map_err(|_| AppError::NetworkUnavailable)?;
        if first.len() > MAX_PROXY_URI_UNITS {
            return Err(AppError::NetworkUnavailable);
        }
        let first =
            Zeroizing::new(String::from_utf16(&first).map_err(|_| AppError::NetworkUnavailable)?);
        proxy_route(&first)?
    };
    control.check()?;
    Ok(route)
}

fn empty_route(can_connect_directly: bool) -> Result<SystemRoute> {
    if can_connect_directly {
        Ok(SystemRoute::Direct)
    } else {
        Err(AppError::NetworkUnavailable)
    }
}

fn proxy_route(raw: &str) -> Result<SystemRoute> {
    // Validate before URL normalization can erase a path or trim whitespace.
    if raw.len() > MAX_PROXY_URI_UNITS * 3
        || raw.encode_utf16().count() > MAX_PROXY_URI_UNITS
        || raw.chars().any(|c| c.is_control() || c.is_whitespace())
        || raw.contains(['\\', '@', '?', '#'])
    {
        return Err(AppError::NetworkUnavailable);
    }
    let (_, authority) = raw.split_once("://").ok_or(AppError::NetworkUnavailable)?;
    let authority = authority.strip_suffix('/').unwrap_or(authority);
    if authority.is_empty() || authority.contains('/') {
        return Err(AppError::NetworkUnavailable);
    }
    let mut proxy = Url::parse(raw).map_err(|_| AppError::NetworkUnavailable)?;
    if proxy.host_str().is_none()
        || !proxy.username().is_empty()
        || proxy.password().is_some()
        || proxy.query().is_some()
        || proxy.fragment().is_some()
        || !matches!(proxy.path(), "" | "/")
        || proxy.port_or_known_default().is_none_or(|port| port == 0)
    {
        return Err(AppError::NetworkUnavailable);
    }
    match proxy.scheme() {
        "http" | "https" => {}
        // reqwest's socks5 scheme resolves target DNS locally. Only an explicit
        // SOCKS5 result can be mapped to its remote-DNS socks5h equivalent.
        "socks5" => proxy
            .set_scheme("socks5h")
            .map_err(|_| AppError::NetworkUnavailable)?,
        _ => return Err(AppError::NetworkUnavailable),
    }
    Ok(SystemRoute::Proxy(proxy.into()))
}

#[derive(Clone, Copy)]
enum OperationStatus {
    Started,
    Completed,
    Canceled,
    Failed,
}

// A small seam lets deterministic tests drive the real cancellation owner.
trait Operation {
    type Output;
    fn status(&self) -> Result<OperationStatus>;
    fn results(&self) -> Result<Self::Output>;
    fn cancel(&self);
    fn close(&self);
}

struct Pending<O: Operation> {
    operation: O,
    completed: bool,
}

impl<O: Operation> Drop for Pending<O> {
    fn drop(&mut self) {
        if self.completed {
            self.operation.close();
        } else {
            // Dropping windows-future's IntoFuture does not cancel WinRT work.
            // Close is invalid while Started; cancel and release the interface.
            self.operation.cancel();
        }
    }
}

fn wait_operation<O: Operation>(operation: O, control: &RequestControl) -> Result<O::Output> {
    let mut pending = Pending {
        operation,
        completed: false,
    };
    loop {
        control.check()?;
        match pending.operation.status()? {
            OperationStatus::Started => control.wait(Duration::from_millis(25))?,
            OperationStatus::Completed => {
                control.check()?;
                let result = pending.operation.results()?;
                control.check()?;
                pending.completed = true;
                return Ok(result);
            }
            OperationStatus::Canceled => return Err(AppError::TranslationCancelled),
            OperationStatus::Failed => return Err(AppError::NetworkUnavailable),
        }
    }
}

#[cfg(windows)]
impl Operation for IAsyncOperation<ProxyConfiguration> {
    type Output = ProxyConfiguration;

    fn status(&self) -> Result<OperationStatus> {
        match self.Status().map_err(|_| AppError::NetworkUnavailable)? {
            AsyncStatus::Started => Ok(OperationStatus::Started),
            AsyncStatus::Completed => Ok(OperationStatus::Completed),
            AsyncStatus::Canceled => Ok(OperationStatus::Canceled),
            AsyncStatus::Error => Ok(OperationStatus::Failed),
            _ => Err(AppError::NetworkUnavailable),
        }
    }

    fn results(&self) -> Result<Self::Output> {
        self.GetResults().map_err(|_| AppError::NetworkUnavailable)
    }

    fn cancel(&self) {
        let _ = self.Cancel();
    }

    fn close(&self) {
        let _ = self.Close();
    }
}

#[cfg(test)]
mod tests;
