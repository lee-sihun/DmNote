use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use uuid::Uuid;

use super::atomic_file::{atomic_replace, atomic_replace_from_temp, sync_file_contents};

#[derive(Debug)]
pub(crate) struct ImportedImage {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dmnote-{label}-{}", Uuid::new_v4()))
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
        let mut permissions = fs::metadata(&source).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&source, permissions).unwrap();

        let imported = import_image_file(&source, &images, "gif").unwrap();

        assert_eq!(fs::read(&imported.path).unwrap(), expected);
        assert!(!fs::metadata(&imported.path)
            .unwrap()
            .permissions()
            .readonly());

        let mut permissions = fs::metadata(&source).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            permissions.set_mode(permissions.mode() | 0o200);
        }
        #[cfg(windows)]
        permissions.set_readonly(false);
        fs::set_permissions(&source, permissions).unwrap();
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
}
