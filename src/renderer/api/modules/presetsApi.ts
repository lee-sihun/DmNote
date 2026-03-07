import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import type {
  PresetOperationResult,
  PresetSnapshot,
} from '@src/types/plugin/api';

export const presetsApi = {
  save: () => invoke<PresetOperationResult>('preset_save'),
  load: () => invoke<PresetOperationResult>('preset_load'),
  saveTab: () => invoke<PresetOperationResult>('preset_save_tab'),
  loadTab: () => invoke<PresetOperationResult>('preset_load_tab'),
  onSnapshot: (listener: (snapshot: PresetSnapshot) => void) =>
    subscribe<PresetSnapshot>('preset:snapshot', listener),
};
