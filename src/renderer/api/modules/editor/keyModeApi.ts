import { invoke } from '@tauri-apps/api/core';

import type { KeysModeResponse } from '@src/types/plugin/api';

export const setKeyMode = (mode: string) =>
  invoke<KeysModeResponse>('keys_set_mode', { mode });
