use tauri::AppHandle;

use crate::{commands::run_blocking, errors::CmdResult, models::SpritePositions};

#[tauri::command]
pub async fn sprite_positions_get(app: AppHandle) -> CmdResult<SpritePositions> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().sprite_positions)).await
}
