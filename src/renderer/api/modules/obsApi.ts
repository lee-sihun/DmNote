import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import type { ObsStatus } from '@src/types/obs';

export const obsApi = {
  start: (port?: number) => invoke<ObsStatus>('obs_start', { port }),
  stop: () => invoke<ObsStatus>('obs_stop'),
  status: () => invoke<ObsStatus>('obs_status'),
  onStatus: (listener: (status: ObsStatus) => void) =>
    subscribe<ObsStatus>('obs:status', listener),
};
