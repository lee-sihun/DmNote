use super::*;

pub(super) fn attach_main_window_close_handler(
    window: WebviewWindow,
    overlay_force_close: Arc<AtomicBool>,
    app_handle: AppHandle,
) {
    #[cfg(target_os = "windows")]
    {
        if let Err(err) = disable_system_context_menu(&window) {
            log::warn!("failed to disable system context menu for main window: {err}");
        }
    }

    let main_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if overlay_force_close.load(Ordering::SeqCst) {
                return;
            }

            let state = app_handle.state::<AppState>();
            if state.store.snapshot().tray_enabled {
                api.prevent_close();
                state.hide_detached_panel_with_main(&app_handle);
                if let Err(err) = main_window.hide() {
                    log::warn!("failed to hide main window for tray mode: {err}");
                }
                if let Err(err) = state.set_main_window_hidden(true) {
                    log::warn!("failed to persist main hidden state: {err}");
                }
                if let Err(err) = state.ensure_tray_icon_for_background(&app_handle) {
                    log::warn!("failed to create tray icon: {err}");
                }
                return;
            }

            api.prevent_close();
            state.request_frontend_shutdown(app_handle.clone());
        }
    });
}

pub(super) fn execute_frontend_lifecycle(
    app_handle: AppHandle,
    action: FrontendLifecycleAction,
    overlay_force_close: Arc<AtomicBool>,
) {
    match action {
        FrontendLifecycleAction::Quit => {
            if overlay_force_close.swap(true, Ordering::SeqCst) {
                return;
            }
            thread::spawn(move || shutdown_application(app_handle));
        }
        FrontendLifecycleAction::Restart => {
            if overlay_force_close.swap(true, Ordering::SeqCst) {
                return;
            }
            let state = app_handle.state::<AppState>();
            state.arm_shutdown_watchdog("app-restart");
            if let Err(err) = state.capture_and_flush_panel_bounds_for_lifecycle(&app_handle) {
                log::warn!("failed to persist panel bounds before restart: {err}");
            }
            state.shutdown();
            state.authorize_process_exit();
            #[cfg(target_os = "macos")]
            match super::super::window::macos_termination::restart_after_canceling_pending_termination(
                &app_handle,
            ) {
                Ok(true) => return,
                Ok(false) => {}
                Err(error) => {
                    log::warn!(
                        "failed to cancel pending macOS termination before restart: {error}"
                    );
                }
            }
            app_handle.request_restart();
        }
    }
}

pub(super) fn tray_menu_labels(_language: &str) -> (&'static str, &'static str) {
    ("Settings", "Quit")
}

pub(super) fn remove_tray_icon(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ICON_ID);
}

pub(super) fn dispatch_remove_tray_icon(app: &AppHandle) -> Result<()> {
    let app_handle = app.clone();
    app.run_on_main_thread(move || remove_tray_icon(&app_handle))?;
    Ok(())
}

fn shutdown_application(app_handle: AppHandle) {
    app_handle
        .state::<AppState>()
        .arm_shutdown_watchdog("background state shutdown");

    let main_hidden = app_handle
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok().map(|visible| !visible))
        .unwrap_or(false);

    {
        let state = app_handle.state::<AppState>();
        let tray_enabled = state.store.snapshot().tray_enabled;
        let persist_hidden = tray_enabled && main_hidden;
        if let Err(err) = state.set_main_window_hidden(persist_hidden) {
            log::warn!("failed to persist main hidden state during shutdown: {err}");
        }
        if let Err(err) = state.capture_and_flush_panel_bounds_for_lifecycle(&app_handle) {
            log::warn!("failed to persist panel bounds during shutdown: {err}");
        }
        state.shutdown();
        state.set_shutdown_watchdog_stage("overlay window close");
    }

    if let Some(overlay) = app_handle.get_webview_window(OVERLAY_LABEL) {
        if let Err(err) = overlay.close() {
            log::warn!("failed to close overlay window during shutdown: {err}");
        }
    }
    if let Some(panel) = app_handle.get_webview_window(PANEL_LABEL) {
        if let Err(err) = panel.destroy() {
            log::warn!("failed to destroy panel window during shutdown: {err}");
        }
    }

    {
        let state = app_handle.state::<AppState>();
        state.authorize_process_exit();
        state.set_shutdown_watchdog_stage("main event loop exit dispatch");
    }
    #[cfg(target_os = "macos")]
    match super::super::window::macos_termination::complete_pending_termination(&app_handle) {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            log::warn!("failed to complete pending macOS termination: {error}");
        }
    }
    let app_for_exit = app_handle.clone();
    if let Err(err) = app_handle.run_on_main_thread(move || {
        remove_tray_icon(&app_for_exit);
        app_for_exit.exit(0);
    }) {
        log::warn!("failed to dispatch tray cleanup during shutdown: {err}");
        app_handle.exit(0);
    }
}
