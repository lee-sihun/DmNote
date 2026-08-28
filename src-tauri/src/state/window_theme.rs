use anyhow::{Context, Result};
use tauri::{window::Color, Theme, WebviewWindow};

use crate::models::UiTheme;

// tokens/dark.css, tokens/light.css의 --ui-bg-app과 같은 값
const MAIN_DARK_BACKGROUND: Color = Color(0x13, 0x13, 0x15, 0xFF);
const MAIN_LIGHT_BACKGROUND: Color = Color(0xCC, 0xD3, 0xDC, 0xFF);

pub(crate) fn resolve_theme(preference: UiTheme, native_theme: Option<Theme>) -> Theme {
    match preference {
        UiTheme::Light => Theme::Light,
        UiTheme::Dark => Theme::Dark,
        UiTheme::System => native_theme.unwrap_or(Theme::Dark),
    }
}

fn main_background_color(theme: Theme) -> Color {
    match theme {
        Theme::Light => MAIN_LIGHT_BACKGROUND,
        Theme::Dark => MAIN_DARK_BACKGROUND,
        _ => MAIN_DARK_BACKGROUND,
    }
}

pub(crate) fn apply_main_window_background(window: &WebviewWindow, theme: Theme) -> Result<()> {
    window
        .set_background_color(Some(main_background_color(theme)))
        .context("failed to apply main window background color")
}

pub(crate) fn apply_main_window_theme(window: &WebviewWindow, preference: UiTheme) -> Result<()> {
    window
        .set_theme(preference.as_tauri_theme())
        .context("failed to apply main window theme")?;

    // System 전환 직후의 실제 테마를 읽어 네이티브 표면과 같은 색을 사용
    let native_theme = (preference == UiTheme::System)
        .then(|| window.theme().ok())
        .flatten();
    apply_main_window_background(window, resolve_theme(preference, native_theme))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_theme_ignores_native_theme() {
        assert_eq!(
            resolve_theme(UiTheme::Light, Some(Theme::Dark)),
            Theme::Light
        );
        assert_eq!(
            resolve_theme(UiTheme::Dark, Some(Theme::Light)),
            Theme::Dark
        );
    }

    #[test]
    fn system_theme_uses_native_theme_with_dark_fallback() {
        assert_eq!(
            resolve_theme(UiTheme::System, Some(Theme::Light)),
            Theme::Light
        );
        assert_eq!(resolve_theme(UiTheme::System, None), Theme::Dark);
    }

    #[test]
    fn background_color_matches_resolved_theme() {
        assert_eq!(main_background_color(Theme::Light), MAIN_LIGHT_BACKGROUND);
        assert_eq!(main_background_color(Theme::Dark), MAIN_DARK_BACKGROUND);
    }
}
