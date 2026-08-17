import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import type {
  JsLoadResult,
  JsSetContentResult,
  JsTogglePayload,
  JsReloadResult,
  JsRemoveResult,
  JsPluginUpdateResult,
} from '@src/types/plugin/api';
import type { CustomJs, JsStatePayload } from '@src/types/plugin/js';

export const jsApi = {
  get: () => invoke<CustomJs>('js_get'),
  getUse: () => invoke<boolean>('js_get_use'),
  toggle: (enabled: boolean) =>
    invoke<JsTogglePayload>('js_toggle', { enabled }),
  load: () => invoke<JsLoadResult>('js_load'),
  reload: () => invoke<JsReloadResult>('js_reload'),
  remove: (id: string) => invoke<JsRemoveResult>('js_remove_plugin', { id }),
  setPluginEnabled: (id: string, enabled: boolean) =>
    invoke<JsPluginUpdateResult>('js_set_plugin_enabled', { id, enabled }),
  setContent: (content: string) =>
    invoke<JsSetContentResult>('js_set_content', { content }),
  reset: () => invoke<void>('js_reset'),
  onUse: (listener: (payload: JsTogglePayload) => void) =>
    subscribe<JsTogglePayload>('js:use', listener),
  onState: (listener: (payload: JsStatePayload) => void) =>
    subscribe<JsStatePayload>('js:content', listener),
};
