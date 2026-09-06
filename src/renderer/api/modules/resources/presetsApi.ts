import { invokeEditorWrite } from '../editor/invokeEditorWrite';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '../shared';
import { runExclusiveLegacyMutation } from '@src/renderer/editor/runtime/lifecycle/legacyEditorMutation';

import type {
  PresetOperationResult,
  PresetSnapshot,
} from '@src/types/plugin/api';

export const presetsApi = {
  save: () => invokeEditorWrite<PresetOperationResult>('preset_save'),
  load: () =>
    runExclusiveLegacyMutation(() =>
      invoke<PresetOperationResult>('preset_load'),
    ),
  saveTab: () => invokeEditorWrite<PresetOperationResult>('preset_save_tab'),
  loadTab: () =>
    runExclusiveLegacyMutation(() =>
      invoke<PresetOperationResult>('preset_load_tab'),
    ),
  onSnapshot: (listener: (snapshot: PresetSnapshot) => void) =>
    subscribe<PresetSnapshot>('preset:snapshot', listener),
};
