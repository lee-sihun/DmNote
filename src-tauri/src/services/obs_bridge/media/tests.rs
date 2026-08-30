use std::cell::Cell;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};

use super::*;

async fn tcp_pair() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("TCP listener 바인딩 실패");
    let address = listener.local_addr().expect("TCP listener 주소 조회 실패");
    let (client, server) = tokio::join!(TcpStream::connect(address), listener.accept());
    (
        client.expect("TCP client 연결 실패"),
        server.expect("TCP server accept 실패").0,
    )
}

fn encode_path(path: &Path) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(path.to_string_lossy().as_bytes())
}

async fn media_response(
    expected_token: &str,
    rest: &str,
    app_data_dir: Option<PathBuf>,
) -> Vec<u8> {
    let (mut client, mut server) = tcp_pair().await;

    handle_media_request(
        &mut server,
        rest,
        || expected_token.to_string(),
        || app_data_dir,
    )
    .await;
    drop(server);

    let mut response = Vec::new();
    client
        .read_to_end(&mut response)
        .await
        .expect("media 응답 수신 실패");
    response
}

fn empty_response(status: &str) -> Vec<u8> {
    format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes()
}

#[tokio::test]
async fn success_response_preserves_mime_cache_header_and_body_order() {
    let temp = tempfile::tempdir().expect("임시 경로 생성 실패");
    let app_data_dir = temp.path().join("app-data");
    let file_path = app_data_dir.join("images/Preview.SvG");
    tokio::fs::create_dir_all(file_path.parent().expect("상위 경로 없음"))
        .await
        .expect("media 디렉터리 생성 실패");
    let content = b"<svg/>";
    tokio::fs::write(&file_path, content)
        .await
        .expect("media 파일 생성 실패");

    let encoded = encode_path(&file_path);
    let response = media_response(
        "secret",
        &format!("{encoded}?other=value&token=secret"),
        Some(app_data_dir),
    )
    .await;
    let mut expected = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml\r\nContent-Length: {}\r\nCache-Control: max-age=3600\r\nConnection: close\r\n\r\n",
        content.len()
    )
    .into_bytes();
    expected.extend_from_slice(content);

    assert_eq!(response, expected);
}

#[tokio::test]
async fn canonical_extension_allowlist_is_case_insensitive_and_fail_closed() {
    let temp = tempfile::tempdir().expect("임시 경로 생성 실패");
    let app_data_dir = temp.path().join("app-data");
    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .expect("app data 생성 실패");

    for extension in [
        "PNG", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "webm", "ogg", "woff", "WOFF2", "ttf",
        "otf",
    ] {
        let file_path = app_data_dir.join(format!("asset.{extension}"));
        tokio::fs::write(&file_path, b"x")
            .await
            .expect("허용 media 파일 생성 실패");
        let response =
            media_response("", &encode_path(&file_path), Some(app_data_dir.clone())).await;
        assert!(
            response.starts_with(b"HTTP/1.1 200 OK"),
            "extension={extension}, response={}",
            String::from_utf8_lossy(&response)
        );
    }

    for extension in ["html", "wasm", "exe", ""] {
        let file_name = if extension.is_empty() {
            "asset".to_string()
        } else {
            format!("asset.{extension}")
        };
        let file_path = app_data_dir.join(file_name);
        tokio::fs::write(&file_path, b"x")
            .await
            .expect("거부 media 파일 생성 실패");
        let response =
            media_response("", &encode_path(&file_path), Some(app_data_dir.clone())).await;
        assert_eq!(
            response,
            empty_response("403 Forbidden"),
            "extension={extension}"
        );
    }
}

#[tokio::test]
async fn app_data_and_file_failures_preserve_status_mapping() {
    let temp = tempfile::tempdir().expect("임시 경로 생성 실패");
    let app_data_dir = temp.path().join("app-data");
    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .expect("app data 생성 실패");
    let missing_file = app_data_dir.join("missing.png");
    let encoded_missing_file = encode_path(&missing_file);

    assert_eq!(
        media_response("", &encoded_missing_file, None).await,
        empty_response("403 Forbidden")
    );
    assert_eq!(
        media_response(
            "",
            &encoded_missing_file,
            Some(temp.path().join("missing-app-data")),
        )
        .await,
        empty_response("403 Forbidden")
    );
    assert_eq!(
        media_response("", &encoded_missing_file, Some(app_data_dir.clone())).await,
        empty_response("404 Not Found")
    );

    let unreadable_directory = app_data_dir.join("directory.png");
    tokio::fs::create_dir(&unreadable_directory)
        .await
        .expect("읽기 실패용 디렉터리 생성 실패");
    assert_eq!(
        media_response("", &encode_path(&unreadable_directory), Some(app_data_dir)).await,
        empty_response("404 Not Found")
    );
}

#[tokio::test]
async fn app_data_lookup_remains_after_auth_decode_and_absolute_path_gates() {
    let app_data_calls = Cell::new(0);

    for (rest, expected_status) in [
        ("*?token=wrong", "403 Forbidden"),
        ("*?token=secret", "400 Bad Request"),
        ("aW1hZ2VzL3ByZXZpZXcucG5n?token=secret", "403 Forbidden"),
    ] {
        let (mut client, mut server) = tcp_pair().await;
        handle_media_request(
            &mut server,
            rest,
            || "secret".to_string(),
            || {
                app_data_calls.set(app_data_calls.get() + 1);
                None
            },
        )
        .await;
        drop(server);
        let mut response = Vec::new();
        client
            .read_to_end(&mut response)
            .await
            .expect("media 응답 수신 실패");
        assert_eq!(response, empty_response(expected_status));
        assert_eq!(app_data_calls.get(), 0, "rest={rest}");
    }

    let absolute_path = std::env::temp_dir().join("preview.png");
    let (mut client, mut server) = tcp_pair().await;
    handle_media_request(
        &mut server,
        &format!("{}?token=secret", encode_path(&absolute_path)),
        || "secret".to_string(),
        || {
            app_data_calls.set(app_data_calls.get() + 1);
            None
        },
    )
    .await;
    drop(server);
    let mut response = Vec::new();
    client
        .read_to_end(&mut response)
        .await
        .expect("media 응답 수신 실패");
    assert_eq!(response, empty_response("403 Forbidden"));
    assert_eq!(app_data_calls.get(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn canonical_containment_follows_symlinks_before_authorization() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().expect("임시 경로 생성 실패");
    let app_data_dir = temp.path().join("app-data");
    let outside_dir = temp.path().join("outside");
    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .expect("app data 생성 실패");
    tokio::fs::create_dir_all(&outside_dir)
        .await
        .expect("외부 경로 생성 실패");

    let outside_file = outside_dir.join("outside.png");
    tokio::fs::write(&outside_file, b"outside")
        .await
        .expect("외부 파일 생성 실패");
    let inside_link = app_data_dir.join("inside-link.png");
    symlink(&outside_file, &inside_link).expect("외부 파일 symlink 생성 실패");
    assert_eq!(
        media_response("", &encode_path(&inside_link), Some(app_data_dir.clone())).await,
        empty_response("403 Forbidden")
    );

    let inside_file = app_data_dir.join("inside.png");
    tokio::fs::write(&inside_file, b"inside")
        .await
        .expect("내부 파일 생성 실패");
    let outside_link = outside_dir.join("outside-link.png");
    symlink(&inside_file, &outside_link).expect("내부 파일 symlink 생성 실패");
    let response = media_response("", &encode_path(&outside_link), Some(app_data_dir)).await;
    assert!(response.starts_with(b"HTTP/1.1 200 OK"));
    assert!(response.ends_with(b"inside"));
}
