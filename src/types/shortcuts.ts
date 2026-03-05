export type ShortcutBinding = {
  key: string; // KeyboardEvent.code (e.g., "KeyO", "Tab", "Digit1")
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type ShortcutsState = {
  toggleOverlay: ShortcutBinding;
  toggleOverlayLock: ShortcutBinding;
  toggleAlwaysOnTop: ShortcutBinding;
  switchKeyMode: ShortcutBinding;
  toggleSettingsPanel: ShortcutBinding;
  zoomIn: ShortcutBinding;
  zoomOut: ShortcutBinding;
  resetZoom: ShortcutBinding;
};

import { getDefaultShortcuts } from '@src/renderer/defaults';

/** @deprecated Use getDefaultShortcuts() from @src/renderer/defaults */
export const DEFAULT_SHORTCUTS: ShortcutsState = getDefaultShortcuts();
