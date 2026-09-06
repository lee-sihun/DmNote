use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use serde_json::Value;

use crate::models::{AppStoreData, FontType, KeyPosition};

use super::super::{
    assets::local_asset_path::{
        file_url_to_path, path_identity_key, paths_have_same_identity, FileUrlPath,
    },
    migration::is_foreign_portable_asset_reference,
};

pub(super) struct AssetReferencePaths {
    pub(super) keys: HashSet<String>,
    pub(super) complete: bool,
    pub(super) unresolved_count: usize,
}

impl AssetReferencePaths {
    fn new() -> Self {
        Self {
            keys: HashSet::new(),
            complete: true,
            unresolved_count: 0,
        }
    }

    fn collect(&mut self, app_data_dir: &Path, value: Option<&String>) {
        let Some(path) = value else {
            return;
        };
        match resolve_local_asset_path(app_data_dir, path) {
            LocalAssetPathResolution::Path(path) => {
                self.keys.insert(path_identity_key(&path));
            }
            LocalAssetPathResolution::Unresolved => {
                self.complete = false;
                self.unresolved_count += 1;
            }
            LocalAssetPathResolution::Ignored => {}
        }
    }
}

fn collect_plugin_managed_asset_paths(
    app_data_dir: &Path,
    data: &AppStoreData,
    directory_name: &str,
    paths: &mut AssetReferencePaths,
) {
    let managed_dir = app_data_dir.join(directory_name);
    for value in data.plugin_data.values() {
        collect_plugin_managed_asset_value(app_data_dir, &managed_dir, value, paths);
    }
}

fn collect_plugin_managed_asset_value(
    app_data_dir: &Path,
    managed_dir: &Path,
    value: &Value,
    paths: &mut AssetReferencePaths,
) {
    match value {
        Value::String(raw) => {
            let LocalAssetPathResolution::Path(path) = resolve_local_asset_path(app_data_dir, raw)
            else {
                return;
            };
            if path
                .parent()
                .is_some_and(|parent| paths_have_same_identity(parent, managed_dir))
            {
                paths.keys.insert(path_identity_key(&path));
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_plugin_managed_asset_value(app_data_dir, managed_dir, value, paths);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                collect_plugin_managed_asset_value(app_data_dir, managed_dir, value, paths);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

pub(super) fn warn_unresolved_asset_references(app_data_dir: &Path, data: &AppStoreData) {
    for (category, count) in [
        (
            "fonts",
            collect_local_font_paths(app_data_dir, data).unresolved_count,
        ),
        (
            "images",
            collect_local_image_paths(app_data_dir, data).unresolved_count,
        ),
        (
            "sounds",
            collect_local_sound_paths(app_data_dir, data).unresolved_count,
        ),
    ] {
        if count > 0 {
            log::warn!("[Assets] {category} sweep 보류: 해석 불가 참조 {count}건");
        }
    }
}

pub(super) fn collect_local_font_paths(
    app_data_dir: &Path,
    data: &AppStoreData,
) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for font in data
        .font_settings
        .custom_fonts
        .iter()
        .filter(|font| font.font_type == FontType::Local)
    {
        paths.collect(app_data_dir, font.local_path.as_ref());
    }

    collect_plugin_managed_asset_paths(app_data_dir, data, "fonts", &mut paths);

    paths
}

pub(super) fn collect_local_image_paths(
    app_data_dir: &Path,
    data: &AppStoreData,
) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for position in iter_all_positions(data) {
        paths.collect(app_data_dir, position.active_image.as_ref());
        paths.collect(app_data_dir, position.inactive_image.as_ref());
    }

    collect_plugin_managed_asset_paths(app_data_dir, data, "images", &mut paths);

    paths
}

#[cfg(test)]
pub(super) fn collect_local_image_path_keys(
    app_data_dir: &Path,
    data: &AppStoreData,
) -> HashSet<String> {
    collect_local_image_paths(app_data_dir, data).keys
}

pub(super) fn collect_local_sound_paths(
    app_data_dir: &Path,
    data: &AppStoreData,
) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for position in iter_all_positions(data) {
        paths.collect(app_data_dir, position.sound_path.as_ref());
    }

    // 사운드 라이브러리에 등록된 파일도 보호 (키에 할당 안 되어도 유지)
    for key in data.sound_library.keys() {
        paths.collect(app_data_dir, Some(key));
    }

    paths
}

#[cfg(test)]
pub(super) fn collect_local_sound_path_keys(
    app_data_dir: &Path,
    data: &AppStoreData,
) -> HashSet<String> {
    collect_local_sound_paths(app_data_dir, data).keys
}

pub(super) fn iter_all_positions(data: &AppStoreData) -> impl Iterator<Item = &KeyPosition> {
    data.key_positions
        .values()
        .flatten()
        .chain(
            data.stat_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.graph_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.knob_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
}

enum LocalAssetPathResolution {
    Path(PathBuf),
    Unresolved,
    Ignored,
}

fn resolve_local_asset_path(app_data_dir: &Path, path: &str) -> LocalAssetPathResolution {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return LocalAssetPathResolution::Ignored;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
        || lower.starts_with("tauri:")
    {
        return LocalAssetPathResolution::Ignored;
    }

    match file_url_to_path(trimmed) {
        FileUrlPath::Path(path) => classify_absolute_asset_path(app_data_dir, trimmed, path),
        FileUrlPath::Invalid => LocalAssetPathResolution::Unresolved,
        FileUrlPath::NotFileUrl => {
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                classify_absolute_asset_path(app_data_dir, trimmed, path)
            } else if looks_like_unresolved_local_path(trimmed) {
                LocalAssetPathResolution::Unresolved
            } else {
                LocalAssetPathResolution::Ignored
            }
        }
    }
}

// 실존하지 않는 외래 참조는 해석 실패로 취급, sweep 보류 fail-safe 유도
fn classify_absolute_asset_path(
    app_data_dir: &Path,
    raw: &str,
    path: PathBuf,
) -> LocalAssetPathResolution {
    if !path.exists() && is_foreign_portable_asset_reference(app_data_dir, raw) {
        return LocalAssetPathResolution::Unresolved;
    }
    LocalAssetPathResolution::Path(path)
}

fn looks_like_unresolved_local_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let has_windows_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    has_windows_drive
        || value.starts_with('\\')
        || value.contains('/')
        || value.contains('\\')
        || Path::new(value).extension().is_some()
}
