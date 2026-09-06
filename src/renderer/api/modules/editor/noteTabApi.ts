import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '../shared';

export const noteTabApi = {
  getAll: () =>
    invoke<import('@src/types/settings/noteSettings').TabNoteOverrides>(
      'note_tab_get_all',
    ),
  get: (tabId: string) =>
    invoke<import('@src/types/plugin/api').TabNoteResponse>('note_tab_get', {
      tabId,
    }),
  set: (
    tabId: string,
    settings: import('@src/types/settings/noteSettings').TabNoteSettings | null,
  ) =>
    invoke<import('@src/types/plugin/api').TabNoteSetResult>('note_tab_set', {
      tabId,
      settings,
    }),
  clear: (tabId: string) =>
    invoke<import('@src/types/plugin/api').TabNoteClearResult>(
      'note_tab_clear',
      {
        tabId,
      },
    ),
  onChanged: (
    listener: (
      payload: import('@src/types/plugin/api').TabNoteResponse,
    ) => void,
  ) =>
    subscribe<import('@src/types/plugin/api').TabNoteResponse>(
      'tabNote:changed',
      listener,
    ),
  onChangedAll: (
    listener: (
      payload: import('@src/types/settings/noteSettings').TabNoteOverrides,
    ) => void,
  ) =>
    subscribe<import('@src/types/settings/noteSettings').TabNoteOverrides>(
      'tabNote:changed_all',
      listener,
    ),
};
