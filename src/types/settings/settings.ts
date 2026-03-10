import {
  type NoteSettings,
  normalizeNoteSettings,
} from '@src/types/settings/noteSettings';
import {
  type FontSettings,
  normalizeFontSettings,
} from '@src/types/settings/fonts';
import { type CustomCss } from '@src/types/plugin/css';
import { type CustomJs } from '@src/types/plugin/js';
import type { ShortcutsState } from '@src/types/settings/shortcuts';
import {
  getDefaultSettingsState,
  getDefaultGridSettings,
} from '@src/renderer/defaults';

export type OverlayResizeAnchor =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center'
  | 'fixed-position';

export interface GridSettings {
  alignmentGuides: boolean;
  spacingGuides: boolean;
  sizeMatchGuides: boolean;
  minimapEnabled: boolean;
  gridSnapSize: number; // 그리드 스냅 크기 (1-10px)
}

/** @deprecated Use getDefaultGridSettings() from @src/renderer/defaults */
export const DEFAULT_GRID_SETTINGS: GridSettings = getDefaultGridSettings();

export interface SettingsState {
  hardwareAcceleration: boolean;
  alwaysOnTop: boolean;
  overlayLocked: boolean;
  noteEffect: boolean;
  noteSettings: NoteSettings;
  fontSettings: FontSettings;
  angleMode: string;
  language: string;
  laboratoryEnabled: boolean;
  developerModeEnabled: boolean;
  trayEnabled: boolean;
  autoUpdateEnabled: boolean;
  backgroundColor: string;
  useCustomCSS: boolean;
  customCSS: CustomCss;
  useCustomJS: boolean;
  customJS: CustomJs;
  overlayResizeAnchor: OverlayResizeAnchor;
  keyCounterEnabled: boolean;
  gridSettings: GridSettings;
  shortcuts: ShortcutsState;
  obsModeEnabled: boolean;
}

/** @deprecated Use getDefaultSettingsState() from @src/renderer/defaults */
export const DEFAULT_SETTINGS_STATE: SettingsState = getDefaultSettingsState();

export type SettingsPatchInput = Partial<
  Omit<
    SettingsState,
    | 'noteSettings'
    | 'fontSettings'
    | 'customCSS'
    | 'customJS'
    | 'gridSettings'
    | 'shortcuts'
  >
> & {
  noteSettings?: Partial<NoteSettings>;
  fontSettings?: FontSettings;
  customCSS?: Partial<CustomCss>;
  customJS?: Partial<CustomJs>;
  gridSettings?: Partial<GridSettings>;
  shortcuts?: Partial<ShortcutsState>;
};

export type SettingsPatch = Partial<
  Omit<
    SettingsState,
    | 'noteSettings'
    | 'fontSettings'
    | 'customCSS'
    | 'customJS'
    | 'gridSettings'
    | 'shortcuts'
  >
> & {
  noteSettings?: NoteSettings;
  fontSettings?: FontSettings;
  customCSS?: CustomCss;
  customJS?: CustomJs;
  gridSettings?: GridSettings;
  shortcuts?: ShortcutsState;
};

export interface SettingsDiff {
  changed: SettingsPatch;
  full?: SettingsState;
}

export function normalizeSettingsPatch(
  patch: SettingsPatchInput,
  current: SettingsState,
): SettingsPatch {
  const next: SettingsPatch = {};
  const entries = Object.entries(patch) as Array<
    [keyof SettingsPatchInput, SettingsPatchInput[keyof SettingsPatchInput]]
  >;

  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (key === 'noteSettings') {
      next.noteSettings = normalizeNoteSettings({
        ...current.noteSettings,
        ...(value as Partial<NoteSettings>),
      });
      continue;
    }
    if (key === 'fontSettings') {
      next.fontSettings = normalizeFontSettings(value as FontSettings);
      continue;
    }
    if (key === 'customCSS') {
      next.customCSS = {
        ...current.customCSS,
        ...(value as Partial<CustomCss>),
      } as CustomCss;
      continue;
    }
    if (key === 'customJS') {
      next.customJS = {
        ...current.customJS,
        ...(value as Partial<CustomJs>),
      } as CustomJs;
      continue;
    }
    if (key === 'gridSettings') {
      next.gridSettings = {
        ...current.gridSettings,
        ...(value as Partial<GridSettings>),
      } as GridSettings;
      continue;
    }
    if (key === 'shortcuts') {
      next.shortcuts = {
        ...current.shortcuts,
        ...(value as Partial<ShortcutsState>),
      } as ShortcutsState;
      continue;
    }
    (next as Record<string, unknown>)[key as string] = value;
  }

  return next;
}
