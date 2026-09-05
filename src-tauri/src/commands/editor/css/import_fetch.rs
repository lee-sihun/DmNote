use std::{
    io::Read,
    net::{IpAddr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    sync::{Arc, OnceLock},
    time::Duration,
};

use reqwest::{
    blocking::Client,
    header::{ACCEPT, LOCATION},
};
use serde::Serialize;
use tauri::WebviewWindow;
use tokio::sync::Semaphore;

use crate::errors::{CmdResult, CommandError};

const CSS_IMPORT_FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CONCURRENT_CSS_IMPORT_FETCHES: usize = 4;
pub(super) const MAX_CSS_IMPORT_BYTES: usize = 1024 * 1024;
const MAX_CSS_IMPORT_REDIRECTS: usize = 3;
const CSS_IMPORT_USER_AGENT: &str = concat!("DmNote/", env!("CARGO_PKG_VERSION"));
static CSS_IMPORT_FETCH_LIMIT: OnceLock<Arc<Semaphore>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CssImportFetchResult {
    pub final_url: String,
    pub text: String,
}

// 클라우드 메타데이터 주소 - IPv4-mapped IPv6 표기(::ffff:a9fe:a9fe)도 같은 주소로 본다
pub(super) fn is_cloud_metadata_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => matches!(
            ip.octets(),
            [169, 254, 169, 254] | [169, 254, 170, 2] | [100, 100, 100, 200] | [192, 0, 0, 192]
        ),
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(mapped) => is_cloud_metadata_ip(IpAddr::V4(mapped)),
            None => ip == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254),
        },
    }
}

fn is_cloud_metadata_url(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => matches!(
            host.trim_end_matches('.').to_ascii_lowercase().as_str(),
            "metadata.google.internal" | "metadata.azure.internal"
        ),
        Some(url::Host::Ipv4(ip)) => is_cloud_metadata_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => is_cloud_metadata_ip(IpAddr::V6(ip)),
        None => false,
    }
}

// 호스트를 먼저 해석해 메타데이터 주소로 향하는 DNS 이름·리바인딩을 차단하고,
// 실제 요청은 검사한 주소에만 고정한다
pub(super) fn resolve_css_import_addrs(url: &url::Url) -> CmdResult<Vec<SocketAddr>> {
    let port = url
        .port_or_known_default()
        .ok_or_else(|| CommandError::msg("CSS import URL has no port"))?;
    let addrs: Vec<SocketAddr> = match url.host() {
        Some(url::Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(url::Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        Some(url::Host::Domain(domain)) => (domain.trim_end_matches('.'), port)
            .to_socket_addrs()
            .map_err(|error| {
                CommandError::msg(format!(
                    "failed to resolve CSS import host '{domain}': {error}"
                ))
            })?
            .collect(),
        None => return Err(CommandError::msg("CSS import URL has no host")),
    };
    if addrs.is_empty() {
        return Err(CommandError::msg(
            "CSS import host resolved to no addresses",
        ));
    }
    if addrs.iter().any(|addr| is_cloud_metadata_ip(addr.ip())) {
        return Err(CommandError::msg(
            "CSS import access to cloud metadata endpoints is blocked",
        ));
    }
    Ok(addrs)
}

pub(super) fn validate_css_import_url(raw: &str) -> CmdResult<url::Url> {
    let url = url::Url::parse(raw)
        .map_err(|error| CommandError::msg(format!("invalid CSS import URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CommandError::msg(format!(
            "unsupported CSS import URL scheme '{}': only http and https are allowed",
            url.scheme()
        )));
    }
    if is_cloud_metadata_url(&url) {
        return Err(CommandError::msg(
            "CSS import access to cloud metadata endpoints is blocked",
        ));
    }
    Ok(url)
}

pub(super) fn read_css_import_body(reader: impl Read) -> CmdResult<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_CSS_IMPORT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CommandError::msg(format!("failed to read CSS import response: {error}"))
        })?;
    if bytes.len() > MAX_CSS_IMPORT_BYTES {
        return Err(CommandError::msg(format!(
            "CSS import response exceeds {MAX_CSS_IMPORT_BYTES} bytes"
        )));
    }
    Ok(bytes)
}

pub(super) fn ensure_css_import_window(window_label: &str) -> CmdResult<()> {
    if window_label != super::super::MAIN_WINDOW_LABEL {
        return Err(CommandError::msg(
            "CSS import fetch is only available in the main window",
        ));
    }
    Ok(())
}

fn css_import_fetch_limit() -> &'static Arc<Semaphore> {
    CSS_IMPORT_FETCH_LIMIT
        .get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_CSS_IMPORT_FETCHES)))
}

// hop마다 검증·해석·주소 고정이 필요하므로 리다이렉트는 직접 따라간다
fn css_import_client(url: &url::Url, pinned: &[SocketAddr]) -> CmdResult<Client> {
    let mut builder = Client::builder()
        .timeout(CSS_IMPORT_FETCH_TIMEOUT)
        .user_agent(CSS_IMPORT_USER_AGENT)
        .redirect(reqwest::redirect::Policy::none());
    if let Some(url::Host::Domain(domain)) = url.host() {
        builder = builder.resolve_to_addrs(domain, pinned);
    }
    builder.build().map_err(|error| {
        CommandError::msg(format!("failed to initialize CSS import client: {error}"))
    })
}

pub(super) fn fetch_css_import(url: String) -> CmdResult<CssImportFetchResult> {
    let mut url = validate_css_import_url(&url)?;
    for _ in 0..=MAX_CSS_IMPORT_REDIRECTS {
        let pinned = resolve_css_import_addrs(&url)?;
        let response = css_import_client(&url, &pinned)?
            .get(url.clone())
            .header(ACCEPT, "text/css,*/*;q=0.1")
            .send()
            .map_err(|error| CommandError::msg(format!("failed to fetch CSS import: {error}")))?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| CommandError::msg("CSS import redirect without Location header"))?;
            let next = url
                .join(location)
                .map_err(|error| CommandError::msg(format!("error following redirect: {error}")))?;
            url = validate_css_import_url(next.as_str())
                .map_err(|error| CommandError::msg(format!("error following redirect: {error}")))?;
            continue;
        }
        let response = response
            .error_for_status()
            .map_err(|error| CommandError::msg(format!("CSS import request failed: {error}")))?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_CSS_IMPORT_BYTES as u64)
        {
            return Err(CommandError::msg(format!(
                "CSS import response exceeds {MAX_CSS_IMPORT_BYTES} bytes"
            )));
        }
        let final_url = response.url().to_string();
        let bytes = read_css_import_body(response)?;
        return Ok(CssImportFetchResult {
            final_url,
            text: String::from_utf8_lossy(&bytes).into_owned(),
        });
    }
    Err(CommandError::msg("CSS import exceeded redirect limit"))
}

#[tauri::command]
pub async fn css_fetch_import(
    window: WebviewWindow,
    url: String,
) -> CmdResult<CssImportFetchResult> {
    ensure_css_import_window(window.label())?;
    let permit = Arc::clone(css_import_fetch_limit())
        .acquire_owned()
        .await
        .map_err(|error| CommandError::msg(format!("CSS import fetch limit closed: {error}")))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        fetch_css_import(url)
    })
    .await
    .map_err(|error| CommandError::msg(format!("CSS import fetch task failed: {error}")))?
}
