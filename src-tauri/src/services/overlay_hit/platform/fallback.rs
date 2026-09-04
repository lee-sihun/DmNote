use anyhow::Result;
use tauri::{AppHandle, WebviewWindow};

use super::{HitRegionStatus, OverlayHitDesiredState};

#[derive(Default)]
pub(super) struct NativeState;

pub(super) fn parent_identity(overlay: Option<&WebviewWindow>) -> Result<Option<usize>> {
    Ok(overlay.map(|_| 1))
}

pub(super) fn reconcile(
    _app: &AppHandle,
    _overlay: Option<&WebviewWindow>,
    _desired: &OverlayHitDesiredState,
    _native: &mut NativeState,
) -> Result<HitRegionStatus> {
    Ok(HitRegionStatus::Applied)
}
