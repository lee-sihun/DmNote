fn main() {
    let _ = std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")));

    #[cfg(target_os = "windows")]
    maybe_embed_webview2_fixed_runtime();
    tauri_build::build()
}

#[cfg(target_os = "windows")]
fn maybe_embed_webview2_fixed_runtime() {
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    // Opt-in: huge binary size.
    let enabled = env::var("DMNOTE_EMBED_WEBVIEW2_FIXED_RUNTIME")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes"
        })
        .unwrap_or(false);

    println!("cargo:rerun-if-env-changed=DMNOTE_EMBED_WEBVIEW2_FIXED_RUNTIME");
    println!("cargo:rerun-if-changed=webview2-fixed-runtime\\msedgewebview2.exe");
    println!("cargo:rerun-if-changed=webview2-fixed-runtime\\dmnote-webview2-fixed-runtime-version.txt");

    if !enabled {
        return;
    }

    let runtime_dir = PathBuf::from("webview2-fixed-runtime");
    let runtime_exe = runtime_dir.join("msedgewebview2.exe");
    if !runtime_exe.is_file() {
        println!(
            "cargo:warning=DMNOTE_EMBED_WEBVIEW2_FIXED_RUNTIME=1 but {} not found (run the download script first)",
            runtime_exe.display()
        );
        return;
    }

    let arch = env::var("DMNOTE_WEBVIEW2_ARCH")
        .or_else(|_| env::var("CARGO_CFG_TARGET_ARCH"))
        .unwrap_or_else(|_| "x86_64".to_string());
    let arch = match arch.as_str() {
        "x86_64" | "x64" => "x64",
        "x86" => "x86",
        "aarch64" | "arm64" => "arm64",
        other => other,
    };

    let version_path = runtime_dir.join("dmnote-webview2-fixed-runtime-version.txt");
    let version = fs::read_to_string(&version_path)
        .ok()
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let zip_path = out_dir.join("dmnote_webview2_fixed_runtime.zip");

    if let Err(err) = create_zip_from_dir(&runtime_dir, &zip_path) {
        println!(
            "cargo:warning=failed to create embedded WebView2 runtime zip: {err}"
        );
        return;
    }

    println!("cargo:rustc-cfg=dmnote_embedded_webview2");
    println!(
        "cargo:rustc-env=DMNOTE_WEBVIEW2_EMBEDDED_ZIP={}",
        zip_path.display()
    );
    println!(
        "cargo:rustc-env=DMNOTE_WEBVIEW2_EMBEDDED_VERSION={version}"
    );
    println!("cargo:rustc-env=DMNOTE_WEBVIEW2_EMBEDDED_ARCH={arch}");
}

#[cfg(target_os = "windows")]
fn create_zip_from_dir(src_dir: &std::path::Path, dest_zip: &std::path::Path) -> std::io::Result<()> {
    use std::io::{Read, Write};

    use walkdir::WalkDir;
    use zip::write::FileOptions;
    use zip::CompressionMethod;
    use zip::ZipWriter;

    let file = std::fs::File::create(dest_zip)?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    for entry in WalkDir::new(src_dir).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        let rel = path.strip_prefix(src_dir).unwrap();
        if rel.as_os_str().is_empty() {
            continue;
        }

        let name = rel.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() {
            zip.add_directory(format!("{name}/"), options)?;
            continue;
        }

        zip.start_file(name, options)?;
        let mut f = std::fs::File::open(path)?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        zip.write_all(&buf)?;
    }

    zip.finish()?;
    Ok(())
}
