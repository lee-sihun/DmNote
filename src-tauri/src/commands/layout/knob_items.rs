use tauri::{AppHandle, Emitter, State};

use crate::{errors::CmdResult, models::KnobPositions, state::AppState};

#[tauri::command]
pub fn knob_positions_get(state: State<'_, AppState>) -> CmdResult<KnobPositions> {
    Ok(state.store.snapshot().knob_positions)
}

#[tauri::command]
pub fn knob_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: KnobPositions,
) -> CmdResult<KnobPositions> {
    let updated = state.store.update_knob_positions(positions)?;
    app.emit("knobPositions:changed", &updated)?;
    state.refresh_obs_snapshot();
    Ok(updated)
}
