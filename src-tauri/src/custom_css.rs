use std::{
    collections::HashSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{
    models::{AppStoreData, CustomCssHistoryEntry},
    state::assets::local_asset_path::path_identity_key,
};

pub(crate) const MAX_CUSTOM_CSS_BYTES: u64 = 1024 * 1024;
pub(crate) const MAX_CUSTOM_CSS_HISTORY_ENTRIES: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CssHistoryErrorCode {
    PathNotAuthorized,
    NotFound,
    NotRegularFile,
    InvalidExtension,
    TooLarge,
    InvalidUtf8,
    IoError,
}

impl CssHistoryErrorCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::PathNotAuthorized => "PATH_NOT_AUTHORIZED",
            Self::NotFound => "NOT_FOUND",
            Self::NotRegularFile => "NOT_REGULAR_FILE",
            Self::InvalidExtension => "INVALID_EXTENSION",
            Self::TooLarge => "TOO_LARGE",
            Self::InvalidUtf8 => "INVALID_UTF8",
            Self::IoError => "IO_ERROR",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CustomCssHistoryStatus {
    Available,
    Missing,
    Invalid,
    TooLarge,
}

#[derive(Debug)]
pub(crate) struct CssPathError {
    pub(crate) code: CssHistoryErrorCode,
    pub(crate) detail: String,
}

impl CssPathError {
    fn new(code: CssHistoryErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct ValidatedCssFile {
    pub(crate) canonical_path: String,
    pub(crate) content: String,
}

pub(crate) fn validate_css_path(path: &Path) -> Result<ValidatedCssFile, CssPathError> {
    let canonical = canonicalize_css_path(path)?;
    let metadata = fs::metadata(&canonical).map_err(map_io_error)?;
    validate_css_metadata(&canonical, &metadata)?;

    let file = File::open(&canonical).map_err(map_io_error)?;
    let open_metadata = file.metadata().map_err(map_io_error)?;
    validate_css_metadata(&canonical, &open_metadata)?;

    let mut bytes =
        Vec::with_capacity((open_metadata.len().min(MAX_CUSTOM_CSS_BYTES) + 1) as usize);
    file.take(MAX_CUSTOM_CSS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(map_io_error)?;
    if bytes.len() as u64 > MAX_CUSTOM_CSS_BYTES {
        return Err(CssPathError::new(
            CssHistoryErrorCode::TooLarge,
            format!("CSS file exceeds {MAX_CUSTOM_CSS_BYTES} bytes"),
        ));
    }

    let content = String::from_utf8(bytes)
        .map_err(|error| CssPathError::new(CssHistoryErrorCode::InvalidUtf8, error.to_string()))?;
    let canonical_path = canonical.into_os_string().into_string().map_err(|_| {
        CssPathError::new(CssHistoryErrorCode::IoError, "CSS path is not valid UTF-8")
    })?;

    Ok(ValidatedCssFile {
        canonical_path,
        content,
    })
}

pub(crate) fn canonicalize_legacy_css_path(path: &str) -> String {
    canonicalize_css_path(Path::new(path))
        .ok()
        .and_then(|canonical| canonical.into_os_string().into_string().ok())
        .unwrap_or_else(|| path.to_string())
}

pub(crate) fn inspect_css_history_status(path: &Path) -> CustomCssHistoryStatus {
    let canonical = match canonicalize_css_path(path) {
        Ok(path) => path,
        Err(error) if error.code == CssHistoryErrorCode::NotFound => {
            return CustomCssHistoryStatus::Missing;
        }
        Err(_) => return CustomCssHistoryStatus::Invalid,
    };
    let metadata = match fs::metadata(&canonical) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return CustomCssHistoryStatus::Missing;
        }
        Err(_) => return CustomCssHistoryStatus::Invalid,
    };
    if !metadata.is_file() || !has_css_extension(&canonical) {
        return CustomCssHistoryStatus::Invalid;
    }
    if metadata.len() > MAX_CUSTOM_CSS_BYTES {
        return CustomCssHistoryStatus::TooLarge;
    }
    CustomCssHistoryStatus::Available
}

pub(crate) fn normalize_custom_css_history(history: &mut Vec<CustomCssHistoryEntry>) -> bool {
    let original = history.clone();
    history.retain(|entry| Path::new(&entry.path).is_absolute());
    history.sort_by_key(|entry| std::cmp::Reverse(entry.loaded_at));

    let mut seen = HashSet::with_capacity(history.len());
    history.retain(|entry| seen.insert(path_identity_key(Path::new(&entry.path))));
    while history.len() > MAX_CUSTOM_CSS_HISTORY_ENTRIES {
        let eviction_index = history
            .iter()
            .enumerate()
            .min_by_key(|(_, entry)| (entry.last_used_at, entry.loaded_at))
            .map(|(index, _)| index)
            .expect("CSS history must contain an eviction candidate");
        history.remove(eviction_index);
    }
    history.sort_by_key(|entry| std::cmp::Reverse(entry.loaded_at));

    *history != original
}

pub(crate) fn migrate_custom_css_history_timestamps(history: &mut [CustomCssHistoryEntry]) -> bool {
    let mut changed = false;
    for entry in history.iter_mut().filter(|entry| entry.loaded_at == 0) {
        entry.loaded_at = entry.last_used_at;
        changed = true;
    }
    changed
}

pub(crate) fn record_custom_css_load(
    history: &mut Vec<CustomCssHistoryEntry>,
    path: String,
    timestamp: i64,
) {
    let identity = path_identity_key(Path::new(&path));
    history.retain(|entry| path_identity_key(Path::new(&entry.path)) != identity);
    history.push(CustomCssHistoryEntry {
        path,
        loaded_at: timestamp,
        last_used_at: timestamp,
    });
    normalize_custom_css_history(history);
}

pub(crate) fn touch_custom_css_history(
    history: &mut [CustomCssHistoryEntry],
    path: &str,
    timestamp: i64,
) -> bool {
    let identity = path_identity_key(Path::new(path));
    let Some(entry) = history
        .iter_mut()
        .find(|entry| path_identity_key(Path::new(&entry.path)) == identity)
    else {
        return false;
    };
    entry.last_used_at = timestamp;
    true
}

pub(crate) fn migrate_custom_css_history_at_load(
    history: &mut Vec<CustomCssHistoryEntry>,
    active_path: Option<&str>,
    timestamp: i64,
) -> bool {
    let original = history.clone();
    migrate_custom_css_history_timestamps(history);

    if let Some(path) = active_path.filter(|path| {
        Path::new(path).is_absolute()
            && !history
                .iter()
                .any(|entry| history_paths_match(&entry.path, path))
    }) {
        history.push(CustomCssHistoryEntry {
            path: path.to_string(),
            loaded_at: timestamp,
            last_used_at: timestamp,
        });
    }

    normalize_custom_css_history(history);
    *history != original
}

pub(crate) fn history_paths_match(left: &str, right: &str) -> bool {
    path_identity_key(Path::new(left)) == path_identity_key(Path::new(right))
}

pub(crate) fn custom_css_settings_diff(state: &AppStoreData) -> serde_json::Value {
    serde_json::json!({
        "useCustomCSS": state.use_custom_css,
        "customCSS": state.custom_css,
    })
}

fn canonicalize_css_path(path: &Path) -> Result<PathBuf, CssPathError> {
    let canonical = fs::canonicalize(path).map_err(map_io_error)?;
    if !canonical.is_absolute() {
        return Err(CssPathError::new(
            CssHistoryErrorCode::IoError,
            "CSS path is not absolute after canonicalization",
        ));
    }
    Ok(canonical)
}

fn validate_css_metadata(path: &Path, metadata: &fs::Metadata) -> Result<(), CssPathError> {
    if !metadata.is_file() {
        return Err(CssPathError::new(
            CssHistoryErrorCode::NotRegularFile,
            "CSS path is not a regular file",
        ));
    }
    if !has_css_extension(path) {
        return Err(CssPathError::new(
            CssHistoryErrorCode::InvalidExtension,
            "canonical CSS path does not have a .css extension",
        ));
    }
    if metadata.len() > MAX_CUSTOM_CSS_BYTES {
        return Err(CssPathError::new(
            CssHistoryErrorCode::TooLarge,
            format!("CSS file exceeds {MAX_CUSTOM_CSS_BYTES} bytes"),
        ));
    }
    Ok(())
}

fn has_css_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("css"))
}

fn map_io_error(error: std::io::Error) -> CssPathError {
    let code = if error.kind() == std::io::ErrorKind::NotFound {
        CssHistoryErrorCode::NotFound
    } else {
        CssHistoryErrorCode::IoError
    };
    CssPathError::new(code, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dmnote-css-{label}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn history_normalization_filters_deduplicates_sorts_and_caps() {
        let root = test_directory("history-normalize");
        let duplicate = root.join("duplicate.css").to_string_lossy().to_string();
        let mut history = vec![
            CustomCssHistoryEntry {
                path: "relative.css".to_string(),
                loaded_at: 100,
                last_used_at: 100,
            },
            CustomCssHistoryEntry {
                path: duplicate.clone(),
                loaded_at: 1,
                last_used_at: 1,
            },
            CustomCssHistoryEntry {
                path: duplicate.clone(),
                loaded_at: 50,
                last_used_at: 50,
            },
        ];
        for index in 0..12 {
            history.push(CustomCssHistoryEntry {
                path: root
                    .join(format!("entry-{index}.css"))
                    .to_string_lossy()
                    .to_string(),
                loaded_at: index,
                last_used_at: index,
            });
        }

        assert!(normalize_custom_css_history(&mut history));
        assert_eq!(history.len(), MAX_CUSTOM_CSS_HISTORY_ENTRIES);
        assert!(history
            .windows(2)
            .all(|pair| pair[0].loaded_at >= pair[1].loaded_at));
        assert!(history
            .iter()
            .all(|entry| Path::new(&entry.path).is_absolute()));
        assert_eq!(
            history
                .iter()
                .filter(|entry| entry.path == duplicate)
                .count(),
            1
        );
        assert_eq!(
            history
                .iter()
                .find(|entry| entry.path == duplicate)
                .unwrap()
                .last_used_at,
            50
        );
        assert!(!normalize_custom_css_history(&mut history));
    }

    #[test]
    fn activation_updates_lru_without_changing_display_order() {
        let root = test_directory("activation-order");
        let first = root.join("first.css").to_string_lossy().to_string();
        let second = root.join("second.css").to_string_lossy().to_string();
        let mut history = vec![
            CustomCssHistoryEntry {
                path: first.clone(),
                loaded_at: 20,
                last_used_at: 20,
            },
            CustomCssHistoryEntry {
                path: second,
                loaded_at: 10,
                last_used_at: 10,
            },
        ];

        assert!(touch_custom_css_history(&mut history, &first, 30));
        normalize_custom_css_history(&mut history);

        assert_eq!(history[0].path, first);
        assert_eq!(history[0].loaded_at, 20);
        assert_eq!(history[0].last_used_at, 30);
    }

    #[test]
    fn eviction_uses_last_used_at_without_reordering_loaded_at() {
        let root = test_directory("lru-eviction");
        let mut history = (0..=MAX_CUSTOM_CSS_HISTORY_ENTRIES)
            .map(|index| CustomCssHistoryEntry {
                path: root
                    .join(format!("entry-{index}.css"))
                    .to_string_lossy()
                    .to_string(),
                loaded_at: index as i64,
                last_used_at: index as i64,
            })
            .collect::<Vec<_>>();
        history[0].last_used_at = 100;

        normalize_custom_css_history(&mut history);

        assert_eq!(history.len(), MAX_CUSTOM_CSS_HISTORY_ENTRIES);
        assert!(history.iter().any(|entry| entry.loaded_at == 0));
        assert!(!history.iter().any(|entry| entry.loaded_at == 1));
        assert!(history
            .windows(2)
            .all(|pair| pair[0].loaded_at >= pair[1].loaded_at));
    }

    #[test]
    fn validation_accepts_case_insensitive_css_extension() {
        let root = test_directory("valid");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("theme.CSS");
        fs::write(&path, b"body { color: white; }").unwrap();

        let validated = validate_css_path(&path).unwrap();

        assert_eq!(validated.content, "body { color: white; }");
        assert!(Path::new(&validated.canonical_path).is_absolute());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn css_history_wire_values_match_the_api_contract() {
        let codes = [
            (
                CssHistoryErrorCode::PathNotAuthorized,
                "PATH_NOT_AUTHORIZED",
            ),
            (CssHistoryErrorCode::NotFound, "NOT_FOUND"),
            (CssHistoryErrorCode::NotRegularFile, "NOT_REGULAR_FILE"),
            (CssHistoryErrorCode::InvalidExtension, "INVALID_EXTENSION"),
            (CssHistoryErrorCode::TooLarge, "TOO_LARGE"),
            (CssHistoryErrorCode::InvalidUtf8, "INVALID_UTF8"),
            (CssHistoryErrorCode::IoError, "IO_ERROR"),
        ];
        for (code, expected) in codes {
            assert_eq!(serde_json::to_value(code).unwrap(), expected);
        }
        assert_eq!(
            serde_json::to_value(CustomCssHistoryStatus::TooLarge).unwrap(),
            "tooLarge"
        );
    }

    #[test]
    fn validation_rejects_oversized_and_non_utf8_files() {
        let root = test_directory("invalid-content");
        fs::create_dir_all(&root).unwrap();
        let oversized = root.join("oversized.css");
        fs::write(&oversized, vec![b'a'; MAX_CUSTOM_CSS_BYTES as usize + 1]).unwrap();
        let non_utf8 = root.join("non-utf8.css");
        fs::write(&non_utf8, [0xFF]).unwrap();

        assert_eq!(
            validate_css_path(&oversized).unwrap_err().code,
            CssHistoryErrorCode::TooLarge
        );
        assert_eq!(
            validate_css_path(&non_utf8).unwrap_err().code,
            CssHistoryErrorCode::InvalidUtf8
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn validation_checks_the_canonical_target_extension() {
        use std::os::unix::fs::symlink;

        let root = test_directory("symlink-extension");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("secret.txt");
        let alias = root.join("theme.css");
        fs::write(&target, b"not css").unwrap();
        symlink(&target, &alias).unwrap();

        assert_eq!(
            validate_css_path(&alias).unwrap_err().code,
            CssHistoryErrorCode::InvalidExtension
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn legacy_symlink_canonicalization_does_not_require_valid_content() {
        use std::os::unix::fs::symlink;

        let root = test_directory("legacy-symlink-canonical");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.css");
        let alias = root.join("alias.css");
        fs::write(&target, vec![b'a'; MAX_CUSTOM_CSS_BYTES as usize + 1]).unwrap();
        symlink(&target, &alias).unwrap();

        let canonical = fs::canonicalize(&target)
            .unwrap()
            .to_string_lossy()
            .to_string();

        assert_eq!(
            canonicalize_legacy_css_path(&alias.to_string_lossy()),
            canonical
        );
        assert_eq!(
            validate_css_path(&alias).unwrap_err().code,
            CssHistoryErrorCode::TooLarge
        );

        fs::write(&target, b"body {}").unwrap();
        assert_eq!(validate_css_path(&alias).unwrap().canonical_path, canonical);

        let other_target = root.join("other.css");
        fs::write(&other_target, b"html {}").unwrap();
        fs::remove_file(&alias).unwrap();
        symlink(&other_target, &alias).unwrap();
        let retargeted = canonicalize_legacy_css_path(&alias.to_string_lossy());
        assert!(!history_paths_match(&canonical, &retargeted));
        let _ = fs::remove_dir_all(root);
    }
}
