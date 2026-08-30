pub mod app_state;
pub(crate) mod atomic_file;
pub(crate) mod builtin_sounds;
pub(crate) mod editor;
pub(crate) mod editor_ops;
#[cfg(test)]
mod editor_ops_parity;
pub(crate) mod gesture;
pub(crate) mod history;
pub(crate) mod image_asset;
pub(crate) mod local_asset_path;
#[cfg(target_os = "macos")]
pub(crate) mod macos_frame_rate;
#[cfg(target_os = "macos")]
pub(crate) mod macos_termination;
#[cfg(target_os = "macos")]
pub(crate) mod macos_window_corners;
pub(crate) mod migration;
pub(crate) mod native_element_id;
pub(crate) mod panel_drag;
pub(crate) mod plugin;
pub mod store;
#[cfg(target_os = "windows")]
pub(crate) mod windows_window_corners;

pub(crate) use app_state::PANEL_LABEL;
pub use app_state::{AppState, PanelDragContext};
pub(crate) use panel_drag::{
    PanelDragGeometry, PanelDragHitTestResult, PanelDragOrigin, PanelDragStartMode,
};
pub use store::AppStore;
