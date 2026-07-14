use std::path::PathBuf;

use url::Url;

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum FileUrlPath {
    NotFileUrl,
    Path(PathBuf),
    Invalid,
}

pub(crate) fn file_url_to_path(value: &str) -> FileUrlPath {
    let trimmed = value.trim();
    let Some((scheme, _)) = trimmed.split_once(':') else {
        return FileUrlPath::NotFileUrl;
    };
    if !scheme.eq_ignore_ascii_case("file") {
        return FileUrlPath::NotFileUrl;
    }
    if !has_valid_percent_encoding(trimmed) {
        return FileUrlPath::Invalid;
    }

    let Ok(url) = Url::parse(trimmed) else {
        return FileUrlPath::Invalid;
    };
    match url.to_file_path() {
        Ok(path) if path.is_absolute() => FileUrlPath::Path(path),
        _ => FileUrlPath::Invalid,
    }
}

fn has_valid_percent_encoding(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            index += 1;
            continue;
        }
        let Some(high) = bytes.get(index + 1).and_then(|byte| hex_value(*byte)) else {
            return false;
        };
        let Some(low) = bytes.get(index + 2).and_then(|byte| hex_value(*byte)) else {
            return false;
        };
        if high == 0 && low == 0 {
            return false;
        }
        index += 3;
    }
    true
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{file_url_to_path, FileUrlPath};
    use std::path::PathBuf;

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn decodes_file_url_without_treating_plus_as_space() {
        assert_eq!(
            file_url_to_path("file:///tmp/Application%20Support/%ED%95%9C%EA%B8%80%25+a.png"),
            FileUrlPath::Path(PathBuf::from("/tmp/Application Support/한글%+a.png"))
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn accepts_localhost_file_url() {
        assert_eq!(
            file_url_to_path("FILE://localhost/tmp/dmnote.wav"),
            FileUrlPath::Path(PathBuf::from("/tmp/dmnote.wav"))
        );
    }

    #[test]
    fn distinguishes_non_file_and_invalid_file_urls() {
        assert_eq!(
            file_url_to_path("https://example.com/a.png"),
            FileUrlPath::NotFileUrl
        );
        assert_eq!(
            file_url_to_path("file://[invalid/path.png"),
            FileUrlPath::Invalid
        );
        assert_eq!(
            file_url_to_path("file:///tmp/broken%ZZ.png"),
            FileUrlPath::Invalid
        );
        assert_eq!(
            file_url_to_path("file:///tmp/nul%00.png"),
            FileUrlPath::Invalid
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn decodes_windows_drive_and_unc_file_urls() {
        assert_eq!(
            file_url_to_path("file:///C:/Program%20Files/DM%20NOTE/a.wav"),
            FileUrlPath::Path(PathBuf::from(r"C:\Program Files\DM NOTE\a.wav"))
        );
        assert_eq!(
            file_url_to_path("file://server/share/a%20b.wav"),
            FileUrlPath::Path(PathBuf::from(r"\\server\share\a b.wav"))
        );
    }
}
