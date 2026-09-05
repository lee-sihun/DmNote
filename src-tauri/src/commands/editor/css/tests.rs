use super::{
    ensure_css_extension, ensure_css_import_window, fetch_css_import, is_cloud_metadata_ip,
    prepare_tab_css_for_set_with, read_css_import_body, replace_tab_css_override,
    resolve_css_import_addrs, validate_css_import_url, write_tab_css_export, MAX_CSS_IMPORT_BYTES,
};
use crate::models::{AppStoreData, TabCss};
use parking_lot::Mutex;
use std::{
    fs,
    path::Path,
    sync::{mpsc, Arc},
    thread,
};

fn test_directory(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "dmnote-css-command-{label}-{}",
        uuid::Uuid::new_v4()
    ))
}

#[test]
fn css_import_url_accepts_only_http_and_https() {
    assert_eq!(
        validate_css_import_url("https://example.com/theme.css")
            .unwrap()
            .scheme(),
        "https"
    );
    assert_eq!(
        validate_css_import_url("http://example.com/theme.css")
            .unwrap()
            .scheme(),
        "http"
    );
    for invalid in ["file:///tmp/theme.css", "data:text/css,body{}", "theme.css"] {
        assert!(validate_css_import_url(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn css_import_fetch_is_limited_to_the_main_window() {
    ensure_css_import_window(super::super::MAIN_WINDOW_LABEL).unwrap();
    for label in ["overlay", "panel"] {
        assert_eq!(
            ensure_css_import_window(label).unwrap_err().to_string(),
            "CSS import fetch is only available in the main window"
        );
    }
}

#[test]
fn css_import_blocks_only_explicit_metadata_targets() {
    for allowed in [
        "http://127.0.0.1:5500/theme.css",
        "http://10.0.0.1/theme.css",
        "https://example.com/theme.css",
    ] {
        validate_css_import_url(allowed).unwrap();
    }
    for blocked in [
        "http://169.254.169.254/latest/meta-data",
        "http://169.254.170.2/v2/credentials",
        "http://100.100.100.200/latest/meta-data",
        "http://192.0.0.192/metadata",
        "http://[fd00:ec2::254]/latest/meta-data",
        "http://metadata.google.internal/computeMetadata/v1",
        "http://metadata.azure.internal/metadata/instance",
    ] {
        assert!(validate_css_import_url(blocked).is_err(), "{blocked}");
    }
}

#[test]
fn css_import_blocks_ipv4_mapped_metadata_literals_and_pins_resolved_addresses() {
    assert!(validate_css_import_url("http://[::ffff:169.254.169.254]/latest/meta-data").is_err());
    assert!(is_cloud_metadata_ip(
        "::ffff:169.254.169.254".parse().unwrap()
    ));
    assert!(is_cloud_metadata_ip("fd00:ec2::254".parse().unwrap()));
    assert!(!is_cloud_metadata_ip("::1".parse().unwrap()));
    assert!(!is_cloud_metadata_ip("127.0.0.1".parse().unwrap()));

    let literal = url::Url::parse("http://127.0.0.1:5500/theme.css").unwrap();
    assert_eq!(
        resolve_css_import_addrs(&literal).unwrap(),
        vec!["127.0.0.1:5500".parse::<std::net::SocketAddr>().unwrap()]
    );
    let mapped = url::Url::parse("http://[::ffff:169.254.169.254]/latest").unwrap();
    assert!(resolve_css_import_addrs(&mapped).is_err());
}

#[test]
fn css_import_follows_local_redirect_without_prompt() {
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        for request_index in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2_048];
            let _ = stream.read(&mut request).unwrap();
            if request_index == 0 {
                stream
                    .write_all(
                        b"HTTP/1.1 302 Found\r\nLocation: /theme.css\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .unwrap();
            } else {
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 22\r\nConnection: close\r\n\r\n.counter { color:red }",
                    )
                    .unwrap();
            }
        }
    });
    let fetched = fetch_css_import(format!("http://{address}/start.css")).unwrap();

    server.join().unwrap();
    assert_eq!(fetched.final_url, format!("http://{address}/theme.css"));
    assert_eq!(fetched.text, ".counter { color:red }");
}

#[test]
fn css_import_blocks_metadata_redirect_before_requesting_it() {
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 2_048];
        let _ = stream.read(&mut request).unwrap();
        stream
            .write_all(
                b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
    });

    let error = fetch_css_import(format!("http://{address}/start.css")).unwrap_err();

    server.join().unwrap();
    assert!(
        error.to_string().contains("error following redirect"),
        "unexpected redirect error: {error}"
    );
}

#[test]
fn css_import_body_enforces_the_one_mibibyte_limit() {
    let accepted = vec![b'a'; MAX_CSS_IMPORT_BYTES];
    assert_eq!(
        read_css_import_body(std::io::Cursor::new(accepted.clone())).unwrap(),
        accepted
    );

    let rejected = vec![b'a'; MAX_CSS_IMPORT_BYTES + 1];
    assert_eq!(
        read_css_import_body(std::io::Cursor::new(rejected))
            .unwrap_err()
            .to_string(),
        format!("CSS import response exceeds {MAX_CSS_IMPORT_BYTES} bytes")
    );
}

#[test]
fn unauthorized_tab_set_preserves_content_without_persisting_path() {
    let css = TabCss {
        path: Some("/tmp/not-authorized.css".to_string()),
        content: "preserved".to_string(),
        enabled: true,
    };

    let prepared = prepare_tab_css_for_set_with(css, |_| false);

    assert_eq!(prepared.path, None);
    assert_eq!(prepared.content, "preserved");
    assert!(prepared.enabled);
}

#[test]
fn authorized_tab_set_persists_the_canonical_path() {
    let root = test_directory("authorized");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("theme.css");
    fs::write(&path, "body {}").unwrap();
    let css = TabCss {
        path: Some(path.to_string_lossy().to_string()),
        content: "preserved".to_string(),
        enabled: true,
    };

    let prepared = prepare_tab_css_for_set_with(css, |_| true);

    let canonical = fs::canonicalize(&path)
        .unwrap()
        .to_string_lossy()
        .to_string();
    assert_eq!(prepared.path.as_deref(), Some(canonical.as_str()));
    assert_eq!(prepared.content, "preserved");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn export_corrects_extension_and_atomically_replaces_existing_file() {
    let root = test_directory("export");
    fs::create_dir_all(&root).unwrap();
    let selected = root.join("theme.txt");
    let export = ensure_css_extension(selected);
    fs::write(&export, "old").unwrap();

    write_tab_css_export(&export, "new").unwrap();

    assert_eq!(
        export.extension().and_then(|value| value.to_str()),
        Some("css")
    );
    assert_eq!(fs::read_to_string(&export).unwrap(), "new");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    assert!(Path::new(&export).is_file());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn clear_waiting_on_activation_lock_wins_with_the_last_commit() {
    let operation_lock = Arc::new(Mutex::new(()));
    let store = Arc::new(Mutex::new(AppStoreData::default()));
    let (locked_tx, locked_rx) = mpsc::channel();
    let (continue_tx, continue_rx) = mpsc::channel();

    let activation_lock = operation_lock.clone();
    let activation_store = store.clone();
    let activate = thread::spawn(move || {
        let _guard = activation_lock.lock();
        locked_tx.send(()).unwrap();
        continue_rx.recv().unwrap();
        replace_tab_css_override(
            &mut activation_store.lock(),
            "4key",
            Some(TabCss {
                path: Some("/tmp/theme.css".to_string()),
                content: "active".to_string(),
                enabled: true,
            }),
        );
    });
    locked_rx.recv().unwrap();

    let clear_lock = operation_lock.clone();
    let clear_store = store.clone();
    let clear = thread::spawn(move || {
        let _guard = clear_lock.lock();
        replace_tab_css_override(&mut clear_store.lock(), "4key", None);
    });
    continue_tx.send(()).unwrap();
    activate.join().unwrap();
    clear.join().unwrap();

    assert!(!store.lock().tab_css_overrides.contains_key("4key"));
}
