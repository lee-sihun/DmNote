import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';
import { trackEditorWrite } from '@src/renderer/editor/runtime/editorWriteBarrier';

import type {
  SettingsState,
  SettingsPatchInput,
  SettingsDiff,
} from '@src/types/settings/settings';

export const settingsApi = {
  get: () => invoke<SettingsState>('settings_get'),
  update: (patch: SettingsPatchInput) =>
    trackEditorWrite(invoke<SettingsState>('settings_update', { patch })),
  onChanged: (listener: (diff: SettingsDiff) => void) =>
    subscribe<SettingsDiff>('settings:changed', listener),
};
