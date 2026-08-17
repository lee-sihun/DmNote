pub mod app_state;
pub(crate) mod atomic_file;
pub(crate) mod builtin_sounds;
pub(crate) mod editor;
pub(crate) mod editor_ops;
#[cfg(test)]
mod editor_ops_parity;
pub(crate) mod gesture;
pub(crate) mod history;
pub(crate) mod local_asset_path;
#[cfg(target_os = "macos")]
pub(crate) mod macos_frame_rate;
#[cfg(target_os = "macos")]
pub(crate) mod macos_termination;
pub(crate) mod migration;
pub(crate) mod native_element_id;
pub(crate) mod plugin;
pub mod store;

pub(crate) use app_state::PANEL_LABEL;
pub use app_state::{AppState, PanelViewState, SelectionSessionSnapshot};
pub use store::AppStore;
