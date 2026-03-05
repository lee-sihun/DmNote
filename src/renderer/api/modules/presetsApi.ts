import { invoke } from '@tauri-apps/api/core';

import type { PresetOperationResult } from '@src/types/api';

export const presetsApi = {
  save: () => invoke<PresetOperationResult>('preset_save'),
  load: () => invoke<PresetOperationResult>('preset_load'),
  saveTab: () => invoke<PresetOperationResult>('preset_save_tab'),
  loadTab: () => invoke<PresetOperationResult>('preset_load_tab'),
};
