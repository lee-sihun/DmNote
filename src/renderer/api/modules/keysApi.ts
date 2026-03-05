import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';
import { rawKeyEventBus } from '@utils/core/rawKeyEventBus';

import type {
  KeyCounterUpdate,
  KeysModeResponse,
  KeysResetAllResponse,
  Unsubscribe,
  ModeChangePayload,
  CustomTabsChangePayload,
  KeyStatePayload,
  CustomTabResult,
  CustomTabDeleteResult,
  RawInputPayload,
} from '@src/types/api';
import type {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from '@src/types/keys';

export const keysApi = {
  get: () => invoke<KeyMappings>('keys_get'),
  update: (mappings: KeyMappings) =>
    invoke<KeyMappings>('keys_update', { mappings }),
  getPositions: () => invoke<KeyPositions>('positions_get'),
  updatePositions: (positions: KeyPositions) =>
    invoke<KeyPositions>('positions_update', { positions }),
  setMode: (mode: string) =>
    invoke<KeysModeResponse>('keys_set_mode', { mode }),
  resetAll: () => invoke<KeysResetAllResponse>('keys_reset_all'),
  resetMode: (mode: string) =>
    invoke<KeysModeResponse>('keys_reset_mode', { mode }),
  setCounters: (counters: KeyCounters) =>
    invoke<KeyCounters>('keys_set_counters', { counters }),
  resetCounters: () => invoke<KeyCounters>('keys_reset_counters'),
  resetCountersMode: (mode: string) =>
    invoke<KeyCounters>('keys_reset_counters_mode', { mode }),
  resetSingleCounter: (mode: string, key: string) =>
    invoke<KeyCounters>('keys_reset_single_counter', { mode, key }),
  onChanged: (listener: (keys: KeyMappings) => void) =>
    subscribe<KeyMappings>('keys:changed', listener),
  onPositionsChanged: (listener: (positions: KeyPositions) => void) =>
    subscribe<KeyPositions>('positions:changed', listener),
  onModeChanged: (listener: (payload: ModeChangePayload) => void) =>
    subscribe<ModeChangePayload>('keys:mode-changed', listener),
  onKeyState: (listener: (payload: KeyStatePayload) => void) =>
    subscribe<KeyStatePayload>('keys:state', listener),
  onRawInput: (listener: (payload: RawInputPayload) => void): Unsubscribe => {
    let unsubscribeFn: (() => void) | null = null;

    rawKeyEventBus
      .subscribe(listener)
      .then((unsub) => {
        unsubscribeFn = unsub;
      })
      .catch((error) => {
        console.error('[API] Failed to subscribe to raw input:', error);
      });

    return () => {
      if (unsubscribeFn) {
        unsubscribeFn();
      }
    };
  },
  onCounterChanged: (listener: (payload: KeyCounterUpdate) => void) =>
    subscribe<KeyCounterUpdate>('keys:counter', listener),
  onCountersChanged: (listener: (payload: KeyCounters) => void) =>
    subscribe<KeyCounters>('keys:counters', listener),
  customTabs: {
    list: () => invoke<CustomTab[]>('custom_tabs_list'),
    create: (name: string) =>
      invoke<CustomTabResult>('custom_tabs_create', { name }),
    delete: (id: string) =>
      invoke<CustomTabDeleteResult>('custom_tabs_delete', { id }),
    select: (id: string) =>
      invoke<CustomTabDeleteResult>('custom_tabs_select', { id }),
    onChanged: (listener: (payload: CustomTabsChangePayload) => void) =>
      subscribe<CustomTabsChangePayload>('customTabs:changed', listener),
  },
};
