fn main() {
    let _ = std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")));

    generate_permissions();
    #[cfg(target_os = "windows")]
    maybe_embed_webview2_fixed_runtime();
    #[cfg(target_os = "macos")]
    maybe_build_macos_dock_helper();
    build_tauri();
}

/// commands/ 디렉토리의 `#[tauri::command]` 함수명을 스캔하여
/// permissions/dmnote-allow-all.json 자동 생성
fn generate_permissions() {
    use std::fs;
    use std::path::Path;

    let commands_dir = Path::new("src/commands");
    println!("cargo:rerun-if-changed=src/commands");

    let mut command_names: Vec<String> = Vec::new();

    scan_commands_dir(commands_dir, &mut command_names);

    fn scan_commands_dir(dir: &Path, names: &mut Vec<String>) {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(err) => {
                println!("cargo:warning=commands 디렉토리 읽기 실패: {err}");
                return;
            }
        };

        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                scan_commands_dir(&path, names);
                continue;
            }
            if path.extension().map(|e| e != "rs").unwrap_or(true) {
                continue;
            }
            if path.file_name().map(|n| n == "mod.rs").unwrap_or(false) {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // #[tauri::command] 또는 #[tauri::command(...)] 다음 줄의 pub fn / pub async fn 이름 추출
            let lines: Vec<&str> = content.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                let trimmed = line.trim();
                if trimmed.starts_with("#[tauri::command") {
                    for next_line in lines.iter().skip(i + 1) {
                        let next = next_line.trim();
                        if next.is_empty() || next.starts_with("//") || next.starts_with('#') {
                            continue;
                        }
                        if let Some(name) = extract_fn_name(next) {
                            names.push(name);
                        }
                        break;
                    }
                }
            }
        }
    }

    command_names.sort();

    let allow_json: Vec<String> = command_names
        .iter()
        .map(|n| format!("          \"{}\"", n))
        .collect();

    let json = format!(
        r#"{{
  "default": null,
  "permission": [
    {{
      "identifier": "dmnote-allow-all",
      "description": "Full DM Note command access for renderer",
      "commands": {{
        "allow": [
{}
        ],
        "deny": []
      }}
    }}
  ]
}}"#,
        allow_json.join(",\n")
    );

    let perm_path = Path::new("permissions/dmnote-allow-all.json");
    // 기존 내용과 동일하면 스킵 (불필요한 재빌드 방지)
    if let Ok(existing) = fs::read_to_string(perm_path) {
        if existing == json {
            return;
        }
    }

    if let Err(err) = fs::write(perm_path, &json) {
        println!("cargo:warning=permissions 파일 쓰기 실패: {err}");
    }
}

/// `pub fn name(` 또는 `pub async fn name(` 에서 함수명 추출
fn extract_fn_name(line: &str) -> Option<String> {
    let rest = if let Some(r) = line.strip_prefix("pub async fn ") {
        r
    } else if let Some(r) = line.strip_prefix("pub fn ") {
        r
    } else {
        return None;
    };
    rest.split('(').next().map(|s| s.trim().to_string())
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
                let manifest =
                    std::fs::read_to_string(manifest_path).expect("app.release.manifest 읽기 실패");
                tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(
                    tauri_build::WindowsAttributes::new().app_manifest(manifest),
                ))
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
    println!(
        "cargo:rerun-if-changed=webview2-fixed-runtime\\dmnote-webview2-fixed-runtime-version.txt"
    );

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
        println!("cargo:warning=failed to create embedded WebView2 runtime zip: {err}");
        return;
    }

    println!("cargo:rustc-cfg=dmnote_embedded_webview2");
    println!(
        "cargo:rustc-env=DMNOTE_WEBVIEW2_EMBEDDED_ZIP={}",
        zip_path.display()
    );
    println!("cargo:rustc-env=DMNOTE_WEBVIEW2_EMBEDDED_VERSION={version}");
    println!("cargo:rustc-env=DMNOTE_WEBVIEW2_EMBEDDED_ARCH={arch}");
}

#[cfg(target_os = "windows")]
fn create_zip_from_dir(
    src_dir: &std::path::Path,
    dest_zip: &std::path::Path,
) -> std::io::Result<()> {
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
