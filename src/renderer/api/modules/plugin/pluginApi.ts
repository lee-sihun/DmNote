import { invokeEditorWrite } from '../editor/invokeEditorWrite';
import { invoke } from '@tauri-apps/api/core';

export const pluginApi = {
  storage: {
    get: <T = unknown>(key: string) =>
      invoke<T | null>('plugin_storage_get', { key }),

    set: (key: string, value: unknown) =>
      invokeEditorWrite<void>('plugin_storage_set', { key, value }),

    remove: (key: string) =>
      invokeEditorWrite<void>('plugin_storage_remove', { key }),

    clear: () => invokeEditorWrite<void>('plugin_storage_clear'),

    keys: () => invoke<string[]>('plugin_storage_keys'),

    hasData: (prefix: string) =>
      invoke<boolean>('plugin_storage_has_data', { prefix }),

    clearByPrefix: (prefix: string) =>
      invokeEditorWrite<number>('plugin_storage_clear_by_prefix', { prefix }),
  },
  registerCleanup: () => {
    console.warn(
      '[Plugin API] registerCleanup is managed by useCustomJsInjection and should not be called directly from dmnoteApi',
    );
  },
  defineElement: () => {
    console.warn(
      '[Plugin API] defineElement is managed by useCustomJsInjection and should not be called directly from dmnoteApi',
    );
  },
  defineSettings: () => {
    console.warn(
      '[Plugin API] defineSettings is managed by useCustomJsInjection and should not be called directly from dmnoteApi',
    );
    return {
      get: () => ({}),
      set: async () => {},
      open: async () => false,
      reset: async () => {},
      subscribe: () => () => {},
    };
  },
};
