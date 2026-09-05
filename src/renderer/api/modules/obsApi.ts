import { invokeEditorWrite } from './invokeEditorWrite';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import type { ObsStatus } from '@src/types/obs';

export const obsApi = {
  start: () => invokeEditorWrite<ObsStatus>('obs_start'),
  stop: () => invoke<ObsStatus>('obs_stop'),
  status: () => invoke<ObsStatus>('obs_status'),
  regenerateToken: () => invokeEditorWrite<ObsStatus>('obs_regenerate_token'),
  onStatus: (listener: (status: ObsStatus) => void) =>
    subscribe<ObsStatus>('obs:status', listener),
  // OBS WS 재연결/lag 복구 신호 (ipcShim 로컬 합성 이벤트 — 네이티브에서는 발화하지 않음)
  onResync: (listener: () => void) => subscribe<null>('obs:resync', listener),
};
