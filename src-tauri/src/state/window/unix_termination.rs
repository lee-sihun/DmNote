use std::io;

use tokio::signal::unix::{signal, SignalKind};

pub(crate) fn install(request_shutdown: impl Fn() + Send + 'static) -> io::Result<()> {
    let mut termination =
        tauri::async_runtime::block_on(async { signal(SignalKind::terminate()) })?;
    tauri::async_runtime::spawn(async move {
        while termination.recv().await.is_some() {
            log::info!("[Shutdown] SIGTERM received; requesting frontend editor flush");
            request_shutdown();
        }
    });
    Ok(())
}
