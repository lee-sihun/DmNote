import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import type {
  CssLoadResult,
  CssSetContentResult,
  CssTogglePayload,
} from '@src/types/plugin/api';
import type { CustomCss } from '@src/types/plugin/css';

export const cssApi = {
  get: () => invoke<CustomCss>('css_get'),
  getUse: () => invoke<boolean>('css_get_use'),
  toggle: (enabled: boolean) =>
    invoke<CssTogglePayload>('css_toggle', { enabled }),
  load: () => invoke<CssLoadResult>('css_load'),
  setContent: (content: string) =>
    invoke<CssSetContentResult>('css_set_content', { content }),
  reset: () => invoke<void>('css_reset'),
  onUse: (listener: (payload: CssTogglePayload) => void) =>
    subscribe<CssTogglePayload>('css:use', listener),
  onContent: (listener: (payload: CustomCss) => void) =>
    subscribe<CustomCss>('css:content', listener),
  tab: {
    getAll: () =>
      invoke<import('@src/types/plugin/css').TabCssOverrides>(
        'css_tab_get_all',
      ),
    get: (tabId: string) =>
      invoke<import('@src/types/plugin/api').TabCssResponse>('css_tab_get', {
        tabId,
      }),
    load: (tabId: string) =>
      invoke<import('@src/types/plugin/api').TabCssLoadResult>('css_tab_load', {
        tabId,
      }),
    clear: (tabId: string) =>
      invoke<import('@src/types/plugin/api').TabCssClearResult>(
        'css_tab_clear',
        {
          tabId,
        },
      ),
    toggle: (tabId: string, enabled: boolean) =>
      invoke<import('@src/types/plugin/api').TabCssToggleResult>(
        'css_tab_toggle',
        {
          tabId,
          enabled,
        },
      ),
    set: (tabId: string, css: import('@src/types/plugin/css').TabCss | null) =>
      invoke<import('@src/types/plugin/api').TabCssSetResult>('css_tab_set', {
        tabId,
        css,
      }),
    onChanged: (
      listener: (
        payload: import('@src/types/plugin/api').TabCssResponse,
      ) => void,
    ) =>
      subscribe<import('@src/types/plugin/api').TabCssResponse>(
        'tabCss:changed',
        listener,
      ),
  },
};
