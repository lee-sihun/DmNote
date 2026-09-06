#[cfg(target_os = "macos")]
pub(crate) mod macos_frame_rate;
#[cfg(target_os = "macos")]
pub(crate) mod macos_termination;
#[cfg(target_os = "macos")]
pub(crate) mod macos_window_corners;
pub(crate) mod panel_drag;
#[cfg(target_os = "windows")]
pub(crate) mod windows_window_corners;

#[cfg(unix)]
pub(crate) mod unix_termination;
