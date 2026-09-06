// lib와 bin의 독립 state 모듈 컴파일
#![allow(dead_code)]

use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
};

use anyhow::{bail, Result};
use cocoa::{
    base::{id, nil},
    foundation::NSUInteger,
};
use objc::{
    class, msg_send,
    runtime::{
        class_addMethod, class_getInstanceMethod, object_getClass, Imp, Object, Sel, BOOL, NO, YES,
    },
    sel, sel_impl,
};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

const NS_TERMINATE_CANCEL: NSUInteger = 0;
const NS_TERMINATE_NOW: NSUInteger = 1;
const NS_TERMINATE_LATER: NSUInteger = 2;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static TERMINATION_PENDING: AtomicBool = AtomicBool::new(false);

extern "C" fn application_should_terminate(_: &Object, _: Sel, _: id) -> NSUInteger {
    match catch_unwind(AssertUnwindSafe(handle_termination_request)) {
        Ok(reply) => reply,
        Err(_) => {
            TERMINATION_PENDING.store(false, Ordering::SeqCst);
            log::error!("panic while handling macOS termination request");
            NS_TERMINATE_CANCEL
        }
    }
}

fn handle_termination_request() -> NSUInteger {
    let Some(app_handle) = APP_HANDLE.get() else {
        log::error!("macOS termination handler has no app handle");
        return NS_TERMINATE_CANCEL;
    };
    let Some(state) = app_handle.try_state::<AppState>() else {
        log::error!("macOS termination handler has no app state");
        return NS_TERMINATE_CANCEL;
    };

    if state.is_process_exit_authorized() {
        return NS_TERMINATE_NOW;
    }

    TERMINATION_PENDING.store(true, Ordering::SeqCst);
    log::info!("macOS termination request deferred for editor flush");
    state.request_frontend_shutdown(app_handle.clone());
    NS_TERMINATE_LATER
}

fn reply_to_pending_termination(allow: BOOL) {
    unsafe {
        let application: id = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![application, replyToApplicationShouldTerminate: allow];
    }
}

pub fn complete_pending_termination(app_handle: &AppHandle) -> Result<bool> {
    if !TERMINATION_PENDING.swap(false, Ordering::SeqCst) {
        return Ok(false);
    }

    if let Err(error) = app_handle.run_on_main_thread(|| reply_to_pending_termination(YES)) {
        TERMINATION_PENDING.store(true, Ordering::SeqCst);
        return Err(error.into());
    }
    Ok(true)
}

pub fn cancel_pending_termination(app_handle: &AppHandle) -> Result<bool> {
    if !TERMINATION_PENDING.swap(false, Ordering::SeqCst) {
        return Ok(false);
    }

    if let Err(error) = app_handle.run_on_main_thread(|| reply_to_pending_termination(NO)) {
        TERMINATION_PENDING.store(true, Ordering::SeqCst);
        return Err(error.into());
    }
    Ok(true)
}

pub fn restart_after_canceling_pending_termination(app_handle: &AppHandle) -> Result<bool> {
    if !TERMINATION_PENDING.swap(false, Ordering::SeqCst) {
        return Ok(false);
    }

    let app_for_restart = app_handle.clone();
    if let Err(error) = app_handle.run_on_main_thread(move || {
        reply_to_pending_termination(NO);
        app_for_restart.request_restart();
    }) {
        TERMINATION_PENDING.store(true, Ordering::SeqCst);
        return Err(error.into());
    }
    Ok(true)
}

pub fn install(app_handle: &AppHandle) -> Result<()> {
    if APP_HANDLE.set(app_handle.clone()).is_err() {
        bail!("macOS termination handler was already installed");
    }

    unsafe {
        let application: id = msg_send![class!(NSApplication), sharedApplication];
        let delegate: id = msg_send![application, delegate];
        if delegate.is_null() {
            bail!("macOS application delegate is unavailable");
        }

        let delegate_class = object_getClass(delegate);
        if delegate_class.is_null() {
            bail!("macOS application delegate class is unavailable");
        }

        let selector = sel!(applicationShouldTerminate:);
        if !class_getInstanceMethod(delegate_class, selector).is_null() {
            bail!("macOS application delegate already handles termination");
        }

        let implementation: Imp = std::mem::transmute::<
            extern "C" fn(&Object, Sel, id) -> NSUInteger,
            Imp,
        >(application_should_terminate);
        let type_encoding = b"Q@:@\0";
        if class_addMethod(
            delegate_class.cast_mut(),
            selector,
            implementation,
            type_encoding.as_ptr().cast(),
        ) == NO
        {
            bail!("failed to install macOS termination handler");
        }

        let _: () = msg_send![application, setDelegate: nil];
        let _: () = msg_send![application, setDelegate: delegate];
        let responds: BOOL = msg_send![delegate, respondsToSelector: selector];
        if responds == NO {
            bail!("macOS application delegate did not register termination handler");
        }
    }

    Ok(())
}
