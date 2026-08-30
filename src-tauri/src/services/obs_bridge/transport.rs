use std::io::Cursor;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{
    handshake::server::{ErrorResponse, Request as WsRequest},
    http::{header, StatusCode},
};

const MAX_HTTP_HEADER_SIZE: usize = 16 * 1024;

pub(super) struct PrefixedStream {
    prefix: Cursor<Vec<u8>>,
    stream: TcpStream,
}

impl PrefixedStream {
    pub(super) fn new(prefix: Vec<u8>, stream: TcpStream) -> Self {
        Self {
            prefix: Cursor::new(prefix),
            stream,
        }
    }
}

impl AsyncRead for PrefixedStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        let position = this.prefix.position() as usize;
        let prefix = this.prefix.get_ref();
        if position < prefix.len() {
            let count = (prefix.len() - position).min(buffer.remaining());
            buffer.put_slice(&prefix[position..position + count]);
            this.prefix.set_position((position + count) as u64);
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut this.stream).poll_read(cx, buffer)
    }
}

impl AsyncWrite for PrefixedStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.get_mut().stream).poll_write(cx, buffer)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_shutdown(cx)
    }
}

pub(super) async fn read_http_request_headers(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];

    loop {
        if request.len() == MAX_HTTP_HEADER_SIZE {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "HTTP request headers too large",
            ));
        }

        let remaining = MAX_HTTP_HEADER_SIZE - request.len();
        let chunk_len = remaining.min(chunk.len());
        let read = stream.read(&mut chunk[..chunk_len]).await?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "incomplete HTTP request headers",
            ));
        }
        request.extend_from_slice(&chunk[..read]);

        if http_header_end(&request).is_some() {
            return Ok(request);
        }
    }
}

pub(super) fn http_header_end(request: &[u8]) -> Option<usize> {
    request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 4)
}

pub(super) fn http_header_values<'a>(request: &'a str, name: &str) -> Vec<&'a str> {
    request
        .lines()
        .skip(1)
        .take_while(|line| !line.trim_end_matches('\r').is_empty())
        .filter_map(|line| line.trim_end_matches('\r').split_once(':'))
        .filter_map(|(header_name, value)| {
            header_name
                .eq_ignore_ascii_case(name)
                .then_some(value.trim())
        })
        .collect()
}

pub(super) fn is_websocket_upgrade_request(request: &str) -> bool {
    http_header_values(request, "upgrade").iter().any(|value| {
        value
            .split(',')
            .any(|token| token.trim().eq_ignore_ascii_case("websocket"))
    })
}

fn is_allowed_host_name(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    let ip_literal = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    ip_literal.parse::<IpAddr>().is_ok()
}

pub(super) fn is_allowed_host_header(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }
    if is_allowed_host_name(value) {
        return true;
    }

    if let Some(closing_bracket) = value.find(']') {
        let (host, suffix) = value.split_at(closing_bracket + 1);
        return is_allowed_host_name(host)
            && suffix
                .strip_prefix(':')
                .is_some_and(|port| port.parse::<u16>().is_ok());
    }

    value
        .rsplit_once(':')
        .is_some_and(|(host, port)| is_allowed_host_name(host) && port.parse::<u16>().is_ok())
}

/// 이 머신 자신의 IP인지 판정 (loopback 또는 로컬 인터페이스에 실제 할당된 IP)
pub(super) fn is_local_machine_ip(ip: &IpAddr) -> bool {
    if ip.is_loopback() {
        return true;
    }
    local_ip_address::list_afinet_netifas()
        .map(|interfaces| {
            interfaces
                .iter()
                .any(|(_, interface_ip)| interface_ip == ip)
        })
        .unwrap_or(false)
}

/// Origin은 브라우저가 강제하는 헤더 — 이 머신이 서빙한 페이지만 신뢰
/// (localhost/loopback 또는 로컬 인터페이스에 실제 할당된 IP만 허용, OWASP 권고 allowlist)
fn is_local_machine_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    let ip_literal = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    let Ok(ip) = ip_literal.parse::<IpAddr>() else {
        return false;
    };
    is_local_machine_ip(&ip)
}

fn is_allowed_origin(value: &str) -> bool {
    tauri::Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .is_some_and(|host| is_local_machine_host(&host))
}

pub(super) fn has_allowed_http_host(request: &str) -> bool {
    let hosts = http_header_values(request, "host");
    hosts.len() == 1 && is_allowed_host_header(hosts[0])
}

pub(super) fn validate_websocket_request(request: &WsRequest) -> Result<(), &'static str> {
    let hosts: Vec<_> = request.headers().get_all(header::HOST).iter().collect();
    if hosts.len() != 1 || !hosts[0].to_str().ok().is_some_and(is_allowed_host_header) {
        return Err("Invalid Host header");
    }

    let origins: Vec<_> = request.headers().get_all(header::ORIGIN).iter().collect();
    if origins.len() > 1
        || origins
            .first()
            .is_some_and(|origin| !origin.to_str().ok().is_some_and(is_allowed_origin))
    {
        return Err("Invalid Origin header");
    }

    Ok(())
}

pub(super) fn websocket_forbidden_response(reason: &str) -> ErrorResponse {
    let mut response = ErrorResponse::new(Some(reason.to_string()));
    *response.status_mut() = StatusCode::FORBIDDEN;
    response
}

// OBS 모드는 같은 네트워크의 다른 PC 접속이 제품 계약 — 항상 전체 인터페이스에 바인딩
// (WS/미디어는 토큰 인증, 커맨드는 allowlist로 보호)
pub(super) fn bind_address(port: u16) -> SocketAddr {
    SocketAddr::from(([0, 0, 0, 0], port))
}

pub(super) async fn write_empty_http_response(stream: &mut TcpStream, status: &str) {
    let response = format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = stream.write_all(response.as_bytes()).await;
}
