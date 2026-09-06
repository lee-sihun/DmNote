pub mod app_state;
pub(crate) mod assets;
pub(crate) mod atomic_file;
pub(crate) mod editor;
pub(crate) mod editor_ops;
#[cfg(test)]
mod editor_ops_parity;
pub(crate) mod gesture;
pub(crate) mod history;
pub(crate) mod migration;
pub(crate) mod native_element_id;
pub(crate) mod plugin;
pub mod store;
pub(crate) mod tab_metadata;
pub(crate) mod window;

pub(crate) use app_state::PANEL_LABEL;
pub use app_state::{AppState, PanelDragContext};
pub use store::AppStore;
pub(crate) use window::panel_drag::{
    PanelDragGeometry, PanelDragHitTestResult, PanelDragOrigin, PanelDragStartMode,
};
