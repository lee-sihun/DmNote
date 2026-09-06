import { invokeEditorWrite } from '../editor/invokeEditorWrite';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '../shared';

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
    invokeEditorWrite<JsTogglePayload>('js_toggle', { enabled }),
  load: () => invokeEditorWrite<JsLoadResult>('js_load'),
  reload: () => invokeEditorWrite<JsReloadResult>('js_reload'),
  remove: (id: string) =>
    invokeEditorWrite<JsRemoveResult>('js_remove_plugin', { id }),
  setPluginEnabled: (id: string, enabled: boolean) =>
    invokeEditorWrite<JsPluginUpdateResult>('js_set_plugin_enabled', {
      id,
      enabled,
    }),
  setContent: (content: string) =>
    invokeEditorWrite<JsSetContentResult>('js_set_content', { content }),
  reset: () => invokeEditorWrite<void>('js_reset'),
  onUse: (listener: (payload: JsTogglePayload) => void) =>
    subscribe<JsTogglePayload>('js:use', listener),
  onState: (listener: (payload: JsStatePayload) => void) =>
    subscribe<JsStatePayload>('js:content', listener),
};
