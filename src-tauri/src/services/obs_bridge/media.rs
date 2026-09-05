use std::path::PathBuf;

use base64::Engine;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

use super::transport::write_empty_http_response;

pub(super) async fn handle_media_request<ExpectedToken, AppDataDir>(
    stream: &mut TcpStream,
    rest: &str,
    expected_token: ExpectedToken,
    app_data_dir: AppDataDir,
) where
    ExpectedToken: FnOnce() -> String,
    AppDataDir: FnOnce() -> Option<PathBuf>,
{
    // 경로와 쿼리 분리: "base64path?token=xxx"
    let (encoded, query) = rest.split_once('?').unwrap_or((rest, ""));

    // 토큰 검증
    let expected_token = expected_token();
    if !expected_token.is_empty() {
        let client_token = query
            .split('&')
            .find_map(|pair| pair.strip_prefix("token="))
            .unwrap_or("");
        if client_token != expected_token {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            return;
        }
    }

    // URL 디코딩 (%2F 등) + base64url → 절대 파일 경로
    let decoded_url = percent_decode(encoded);
    let file_path = match base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(decoded_url.as_bytes())
    {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(path) => PathBuf::from(path),
            Err(_) => {
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                return;
            }
        },
        Err(_) => {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            return;
        }
    };

    if !file_path.is_absolute() {
        write_empty_http_response(stream, "403 Forbidden").await;
        return;
    }

    let app_data_dir = app_data_dir();
    let Some(app_data_dir) = app_data_dir else {
        write_empty_http_response(stream, "403 Forbidden").await;
        return;
    };
    let canonical_app_data = match tokio::fs::canonicalize(app_data_dir).await {
        Ok(path) => path,
        Err(error) => {
            log::warn!("[ObsBridge] app data 경로 확인 실패: {error}");
            write_empty_http_response(stream, "403 Forbidden").await;
            return;
        }
    };
    let canonical_file_path = match tokio::fs::canonicalize(&file_path).await {
        Ok(path) => path,
        Err(_) => {
            write_empty_http_response(stream, "404 Not Found").await;
            return;
        }
    };
    if !canonical_file_path.starts_with(&canonical_app_data) {
        log::warn!(
            "[ObsBridge] app data 밖 media 요청 차단: {}",
            file_path.display()
        );
        write_empty_http_response(stream, "403 Forbidden").await;
        return;
    }

    // 허용 확장자 화이트리스트 (미디어/폰트 파일만)
    let ext = canonical_file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "svg"
            | "mp4"
            | "webm"
            | "ogg"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
    ) {
        let _ = stream
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
        return;
    }

    // 파일 읽기 및 서빙
    match tokio::fs::read(&canonical_file_path).await {
        Ok(content) => {
            let mime = guess_mime(&canonical_file_path.to_string_lossy());
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: max-age=3600\r\nConnection: close\r\n\r\n",
                content.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.write_all(&content).await;
        }
        Err(_) => {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
        }
    }
}

/// 파일 확장자로 MIME 타입 추정
pub(super) fn guess_mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogg" => "video/ogg",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// 간단한 percent-decoding (%XX → 바이트)
pub(super) fn percent_decode(input: &str) -> String {
    let mut result = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                result.push((high * 16 + low) as u8);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).into_owned()
}

#[cfg(test)]
mod tests;
