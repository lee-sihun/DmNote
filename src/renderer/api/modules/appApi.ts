import { invoke } from '@tauri-apps/api/core';

import type { AppAutoUpdateResult } from '@src/types/api';
import type { BootstrapPayload } from '@src/types/app';

export const appApi = {
  bootstrap: () => invoke<BootstrapPayload>('app_bootstrap'),
  autoUpdate: (tag: string) =>
    invoke<AppAutoUpdateResult>('app_auto_update', { tag }),
  openExternal: (url: string) => invoke<void>('app_open_external', { url }),
  restart: () => invoke<void>('app_restart'),
  quit: () => invoke<void>('app_quit'),
};

export const windowApi = {
  type: (window as any).__dmn_window_type as 'main' | 'overlay',
  minimize: () => invoke<void>('window_minimize'),
  close: () => invoke<void>('window_close'),
  showMain: () => invoke<void>('window_show_main'),
  openDevtoolsAll: () => invoke<void>('window_open_devtools_all'),
};
