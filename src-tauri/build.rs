fn main() {
    let _ = std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")));

    #[cfg(target_os = "windows")]
    maybe_embed_webview2_fixed_runtime();
    #[cfg(target_os = "macos")]
    maybe_build_macos_dock_helper();
    build_tauri();
}

/// 빌드 프로필에 따라 tauri-build를 실행합니다.
/// 릴리즈 빌드에서는 Windows 관리자 권한을 요청하는 manifest를 적용하고,
/// 개발 서버(tauri dev)에서는 기본 설정을 사용합니다.
fn build_tauri() {
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rerun-if-changed=app.release.manifest");
        let profile = std::env::var("PROFILE").unwrap_or_default();
        if profile == "release" {
            let manifest_path = std::path::Path::new("app.release.manifest");
            if manifest_path.exists() {
                let manifest = std::fs::read_to_string(manifest_path)
                    .expect("app.release.manifest 읽기 실패");
                tauri_build::try_build(
                    tauri_build::Attributes::new().windows_attributes(
                        tauri_build::WindowsAttributes::new().app_manifest(manifest),
                    ),
                )
                .expect("tauri 빌드 실패");
                return;
            }
        }
    }
    tauri_build::build();
}

#[cfg(target_os = "macos")]
fn maybe_build_macos_dock_helper() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::Command;

    let helper_src = PathBuf::from("helper/DockHelper/main.swift");
    let helper_info = PathBuf::from("helper/DockHelper/Info.plist");
    let legacy_helper_bundle = PathBuf::from("target/dmnote-helper/DMNoteDockHelper.app");
    let helper_bundle = PathBuf::from("target/dmnote-helper/DM NOTE.app");
    let helper_contents = helper_bundle.join("Contents");
    let helper_macos = helper_contents.join("MacOS");
    let helper_resources = helper_contents.join("Resources");
    let helper_exec = helper_macos.join("DMNoteDockHelper");
    let helper_bundle_info = helper_contents.join("Info.plist");
    let helper_icon = helper_resources.join("icon.icns");
    let source_icon = PathBuf::from("icons/icon.icns");

    println!("cargo:rerun-if-changed={}", helper_src.display());
    println!("cargo:rerun-if-changed={}", helper_info.display());
    println!("cargo:rerun-if-changed={}", source_icon.display());

    if legacy_helper_bundle.exists() {
        let _ = fs::remove_dir_all(&legacy_helper_bundle);
    }

    if let Err(err) = fs::create_dir_all(&helper_macos) {
        println!("cargo:warning=failed to create helper MacOS dir: {err}");
        return;
    }
    if let Err(err) = fs::create_dir_all(&helper_resources) {
        println!("cargo:warning=failed to create helper Resources dir: {err}");
        return;
    }

    let status = Command::new("xcrun")
        .args(["--sdk", "macosx", "swiftc"])
        .arg(&helper_src)
        .args(["-O", "-framework", "AppKit", "-o"])
        .arg(&helper_exec)
        .status();

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => {
            println!("cargo:warning=swiftc helper build failed with status {s}");
            return;
        }
        Err(err) => {
            println!("cargo:warning=failed to invoke swiftc for helper build: {err}");
            return;
        }
    }

    if let Err(err) = fs::set_permissions(&helper_exec, fs::Permissions::from_mode(0o755)) {
        println!("cargo:warning=failed to set helper executable permissions: {err}");
    }

    if let Err(err) = fs::copy(&helper_info, &helper_bundle_info) {
        println!("cargo:warning=failed to copy helper Info.plist: {err}");
        return;
    }

    if let Err(err) = fs::copy(&source_icon, &helper_icon) {
        println!("cargo:warning=failed to copy helper icon: {err}");
        return;
    }
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
