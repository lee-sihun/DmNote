use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use uuid::Uuid;

use super::atomic_file::{atomic_replace, atomic_replace_from_temp, sync_file_contents};
use super::local_asset_path::{file_url_to_path, FileUrlPath};

pub(crate) fn probe_local_raster_size(image_ref: &str) -> Result<Option<(u32, u32)>> {
    let trimmed = image_ref.trim();
    let path = match file_url_to_path(trimmed) {
        FileUrlPath::Path(path) => path,
        FileUrlPath::Invalid => return Ok(None),
        FileUrlPath::NotFileUrl => PathBuf::from(trimmed),
    };
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
    {
        return Ok(None);
    }

    let size = imagesize::size(&path)
        .with_context(|| format!("failed to read raster image at {}", path.display()))?;
    let Some(width) = u32::try_from(size.width).ok() else {
        return Ok(None);
    };
    let Some(height) = u32::try_from(size.height).ok() else {
        return Ok(None);
    };
    let is_supported = (crate::models::SPRITE_IMAGE_DIMENSION_MIN
        ..=crate::models::SPRITE_IMAGE_DIMENSION_MAX)
        .contains(&width)
        && (crate::models::SPRITE_IMAGE_DIMENSION_MIN..=crate::models::SPRITE_IMAGE_DIMENSION_MAX)
            .contains(&height);
    Ok(is_supported.then_some((width, height)))
}

#[derive(Debug)]
pub(crate) struct ImportedImage {
    pub path: PathBuf,
}

#[derive(Debug)]
pub(crate) struct ImportedFont {
    pub path: PathBuf,
}

pub(crate) fn import_image_file(
    source_path: &Path,
    images_dir: &Path,
    extension: &str,
) -> Result<ImportedImage> {
    fs::create_dir_all(images_dir).with_context(|| {
        format!(
            "failed to create image directory at {}",
            images_dir.display()
        )
    })?;

    let path = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
    let temp_path = images_dir.join(format!(".image-import-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut source = File::open(source_path)
            .with_context(|| format!("failed to open image at {}", source_path.display()))?;
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .with_context(|| format!("failed to create image temp at {}", temp_path.display()))?;
        io::copy(&mut source, &mut temp).with_context(|| {
            format!(
                "failed to copy image from {} to {}",
                source_path.display(),
                temp_path.display()
            )
        })?;
        sync_file_contents(&temp)
            .with_context(|| format!("failed to sync image temp at {}", temp_path.display()))?;
        drop(temp);
        atomic_replace_from_temp(&temp_path, &path)?;
        Ok(ImportedImage { path })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

pub(crate) fn import_image_bytes(
    bytes: &[u8],
    images_dir: &Path,
    extension: &str,
) -> Result<ImportedImage> {
    fs::create_dir_all(images_dir).with_context(|| {
        format!(
            "failed to create image directory at {}",
            images_dir.display()
        )
    })?;

    let path = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
    atomic_replace(&path, bytes, "image-import")?;
    Ok(ImportedImage { path })
}

pub(crate) fn import_font_file(
    source_path: &Path,
    fonts_dir: &Path,
    extension: &str,
) -> Result<ImportedFont> {
    import_font_file_with_replace(source_path, fonts_dir, extension, atomic_replace_from_temp)
}

fn import_font_file_with_replace<Replace>(
    source_path: &Path,
    fonts_dir: &Path,
    extension: &str,
    replace: Replace,
) -> Result<ImportedFont>
where
    Replace: FnOnce(&Path, &Path) -> Result<()>,
{
    fs::create_dir_all(fonts_dir)
        .with_context(|| format!("failed to create font directory at {}", fonts_dir.display()))?;

    let path = fonts_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
    let temp_path = fonts_dir.join(format!(".font-import-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut source = File::open(source_path)
            .with_context(|| format!("failed to open font at {}", source_path.display()))?;
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .with_context(|| format!("failed to create font temp at {}", temp_path.display()))?;
        io::copy(&mut source, &mut temp).with_context(|| {
            format!(
                "failed to copy font from {} to {}",
                source_path.display(),
                temp_path.display()
            )
        })?;
        sync_file_contents(&temp)
            .with_context(|| format!("failed to sync font temp at {}", temp_path.display()))?;
        drop(temp);
        replace(&temp_path, &path)?;
        Ok(ImportedFont { path })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dmnote-{label}-{}", Uuid::new_v4()))
    }

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }

    #[test]
    fn local_raster_probe_reads_absolute_path_and_file_url() {
        let directory = test_directory("sprite-image-size");
        let path = directory.join("sprite.png");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, png_header(321, 123)).unwrap();

        assert_eq!(
            probe_local_raster_size(path.to_str().unwrap()).unwrap(),
            Some((321, 123))
        );
        assert_eq!(
            probe_local_raster_size(url::Url::from_file_path(&path).unwrap().as_str()).unwrap(),
            Some((321, 123))
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn local_raster_probe_ignores_non_local_and_unsupported_sources() {
        let directory = test_directory("sprite-image-size-ignored");
        let svg = directory.join("sprite.svg");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&svg, b"<svg width=\"10\" height=\"20\"></svg>").unwrap();

        assert_eq!(
            probe_local_raster_size("https://example.com/sprite.png").unwrap(),
            None
        );
        assert_eq!(
            probe_local_raster_size("data:image/png;base64,AAAA").unwrap(),
            None
        );
        assert_eq!(
            probe_local_raster_size("relative/sprite.png").unwrap(),
            None
        );
        assert_eq!(
            probe_local_raster_size(svg.to_str().unwrap()).unwrap(),
            None
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn local_raster_probe_reports_read_failures() {
        let directory = test_directory("sprite-image-size-failure");
        let corrupt = directory.join("corrupt.png");
        let missing = directory.join("missing.png");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&corrupt, b"not-an-image").unwrap();

        assert!(probe_local_raster_size(corrupt.to_str().unwrap()).is_err());
        assert!(probe_local_raster_size(missing.to_str().unwrap()).is_err());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn gif_file_import_keeps_original_bytes_and_extension() {
        let directory = test_directory("gif-original-file");
        let images = directory.join("images");
        let source = directory.join("source.gif");
        let expected = b"GIF89a-original-payload";
        fs::create_dir_all(&directory).unwrap();
        fs::write(&source, expected).unwrap();

        let imported = import_image_file(&source, &images, "gif").unwrap();

        assert_eq!(
            imported.path.extension().and_then(|value| value.to_str()),
            Some("gif")
        );
        assert_eq!(fs::read(&imported.path).unwrap(), expected);
        assert!(!fs::read_dir(&images).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_some_and(|extension| extension == "tmp")));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn repeated_gif_imports_get_independent_original_paths() {
        let directory = test_directory("gif-original-independent");
        let images = directory.join("images");
        let source = directory.join("source.gif");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&source, b"GIF89a-original-payload").unwrap();

        let first = import_image_file(&source, &images, "gif").unwrap();
        let second = import_image_file(&source, &images, "gif").unwrap();

        assert_ne!(first.path, second.path);
        assert_eq!(
            fs::read(first.path).unwrap(),
            fs::read(second.path).unwrap()
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn read_only_gif_source_imports_into_a_writable_managed_file() {
        let directory = test_directory("gif-read-only-source");
        let images = directory.join("images");
        let source = directory.join("source.gif");
        let expected = b"GIF89a-read-only-original";
        fs::create_dir_all(&directory).unwrap();
        fs::write(&source, expected).unwrap();
        let original_permissions = fs::metadata(&source).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&source, permissions).unwrap();

        let imported = import_image_file(&source, &images, "gif").unwrap();

        assert_eq!(fs::read(&imported.path).unwrap(), expected);
        assert!(!fs::metadata(&imported.path)
            .unwrap()
            .permissions()
            .readonly());

        fs::set_permissions(&source, original_permissions).unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn image_byte_import_keeps_payload_and_extension() {
        let directory = test_directory("image-original-bytes");
        let images = directory.join("images");
        let expected = b"GIF89a-embedded-original";

        let imported = import_image_bytes(expected, &images, "gif").unwrap();

        assert_eq!(
            imported.path.extension().and_then(|value| value.to_str()),
            Some("gif")
        );
        assert_eq!(fs::read(&imported.path).unwrap(), expected);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_file_import_removes_temporary_file() {
        let directory = test_directory("image-file-failure");
        let images = directory.join("images");

        assert!(import_image_file(&directory.join("missing.gif"), &images, "gif").is_err());
        assert!(!fs::read_dir(&images).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_some_and(|extension| extension == "tmp")));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn font_file_import_keeps_original_bytes_and_extension() {
        let directory = test_directory("font-atomic-file");
        let fonts = directory.join("fonts");
        let source = directory.join("source.woff2");
        let expected = b"wOF2-original-payload";
        fs::create_dir_all(&directory).unwrap();
        fs::write(&source, expected).unwrap();

        let imported = import_font_file(&source, &fonts, "woff2").unwrap();

        assert_eq!(
            imported.path.extension().and_then(|value| value.to_str()),
            Some("woff2")
        );
        assert_eq!(fs::read(&imported.path).unwrap(), expected);
        assert!(!fs::read_dir(&fonts).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_some_and(|extension| extension == "tmp")));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_font_replace_leaves_no_partial_target_or_temp() {
        let directory = test_directory("font-atomic-failure");
        let fonts = directory.join("fonts");
        let source = directory.join("source.ttf");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&source, b"\x00\x01\x00\x00-original-payload").unwrap();

        let result = import_font_file_with_replace(&source, &fonts, "ttf", |temp, target| {
            assert!(temp.exists());
            assert!(!target.exists());
            anyhow::bail!("injected replace failure")
        });

        assert!(result.is_err());
        assert!(fs::read_dir(&fonts).unwrap().next().is_none());
        fs::remove_dir_all(directory).unwrap();
    }
}
