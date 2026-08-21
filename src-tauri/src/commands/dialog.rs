use rfd::AsyncFileDialog;
use tauri::WebviewWindow;

/// 파일 선택창을 호출한 창에 붙여서 만든다.
/// 부모를 지정하지 않으면 macOS는 앱이 고른 다른 창에 시트를 붙이고,
/// Windows는 다이얼로그가 창 뒤로 가려질 수 있다
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(unused_variables, unused_mut)
)]
pub(crate) fn parented_file_dialog(
    window: &WebviewWindow,
    filter_name: &str,
    extensions: &[&str],
) -> AsyncFileDialog {
    let mut dialog = AsyncFileDialog::new().add_filter(filter_name, extensions);
    #[cfg(any(windows, target_os = "macos"))]
    {
        dialog = dialog.set_parent(window);
    }
    dialog
}
