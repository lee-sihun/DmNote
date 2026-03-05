import type {
  KeyCounterSettings,
  CounterAnimationBezier,
} from '@src/types/keys';
import type { NoteSettings } from '@src/types/noteSettings';
import type { GridSettings, SettingsState } from '@src/types/settings';
import type { ShortcutsState } from '@src/types/shortcuts';
import type { FontSettings } from '@src/types/fonts';

export interface DefaultsPayload {
  settings: SettingsState;
  counterSettings: KeyCounterSettings;
}

let _defaults: DefaultsPayload | null = null;

export function initDefaults(payload: DefaultsPayload): void {
  _defaults = payload;
}

export function getDefaults(): DefaultsPayload | null {
  return _defaults;
}

export function getDefaultCounterSettings(): KeyCounterSettings {
  const d = _defaults?.counterSettings;
  if (d) {
    return {
      ...d,
      fill: { ...d.fill },
      stroke: { ...d.stroke },
      animation: {
        ...d.animation,
        bezier: [...d.animation.bezier] as CounterAnimationBezier,
      },
    };
  }
  return FALLBACK_COUNTER_SETTINGS();
}

export function getDefaultNoteSettings(): NoteSettings {
  return _defaults?.settings.noteSettings
    ? { ..._defaults.settings.noteSettings }
    : FALLBACK_NOTE_SETTINGS();
}

export function getDefaultGridSettings(): GridSettings {
  return _defaults?.settings.gridSettings
    ? { ..._defaults.settings.gridSettings }
    : FALLBACK_GRID_SETTINGS();
}

export function getDefaultShortcuts(): ShortcutsState {
  return _defaults?.settings.shortcuts
    ? { ..._defaults.settings.shortcuts }
    : FALLBACK_SHORTCUTS();
}

export function getDefaultFontSettings(): FontSettings {
  return _defaults?.settings.fontSettings
    ? { customFonts: [..._defaults.settings.fontSettings.customFonts] }
    : { customFonts: [] };
}

export function getDefaultSettingsState(): SettingsState {
  if (_defaults?.settings) {
    return {
      ..._defaults.settings,
      noteSettings: getDefaultNoteSettings(),
      fontSettings: getDefaultFontSettings(),
      gridSettings: getDefaultGridSettings(),
      shortcuts: getDefaultShortcuts(),
      customCSS: {
        ...(_defaults.settings.customCSS ?? { path: null, content: '' }),
      },
      customJS: {
        ...(_defaults.settings.customJS ?? {
          path: null,
          content: '',
          plugins: [],
        }),
      },
    };
  }
  return FALLBACK_SETTINGS_STATE();
}

export function getDefaultCounterAnimationPresetId(): string {
  return _defaults?.counterSettings.animation.presetId ?? 'builtin-ease-out';
}

// ── Fallback values (used only before bootstrap completes) ──

function FALLBACK_COUNTER_SETTINGS(): KeyCounterSettings {
  return {
    enabled: true,
    placement: 'inside',
    align: 'top',
    alignMode: 'center',
    fill: { idle: 'rgba(121, 121, 121, 0.9)', active: '#FFFFFF' },
    stroke: { idle: 'transparent', active: 'transparent' },
    gap: 6,
    fontSize: 16,
    fontWeight: 700,
    fontFamily: null,
    fontItalic: false,
    fontUnderline: false,
    fontStrikethrough: false,
    animation: {
      enabled: false,
      presetId: 'builtin-ease-out',
      bezier: [0.25, 0.46, 0.45, 0.94],
      scale: 1.1,
      durationMs: 300,
    },
  };
}

function FALLBACK_NOTE_SETTINGS(): NoteSettings {
  return {
    frameLimit: 0,
    speed: 180,
    trackHeight: 150,
    reverse: false,
    fadePosition: 'auto',
    fadeTopPx: 50,
    fadeBottomPx: 0,
    reverseFadeTopPx: 0,
    reverseFadeBottomPx: 50,
    delayedNoteEnabled: false,
    shortNoteThresholdMs: 50,
    shortNoteMinLengthPx: 30,
    keyDisplayDelayMs: 0,
  };
}

function FALLBACK_GRID_SETTINGS(): GridSettings {
  return {
    alignmentGuides: true,
    spacingGuides: true,
    sizeMatchGuides: true,
    minimapEnabled: true,
    gridSnapSize: 5,
  };
}

function FALLBACK_SHORTCUTS(): ShortcutsState {
  return {
    toggleOverlay: {
      key: 'KeyO',
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
    },
    toggleOverlayLock: { key: '' },
    toggleAlwaysOnTop: { key: '' },
    switchKeyMode: {
      key: 'Tab',
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    },
    toggleSettingsPanel: {
      key: 'KeyB',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    },
    zoomIn: { key: 'Equal', ctrl: true, shift: false, alt: false, meta: false },
    zoomOut: {
      key: 'Minus',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    },
    resetZoom: {
      key: 'Digit0',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    },
  };
}

function FALLBACK_SETTINGS_STATE(): SettingsState {
  return {
    hardwareAcceleration: true,
    alwaysOnTop: true,
    overlayLocked: false,
    noteEffect: false,
    noteSettings: FALLBACK_NOTE_SETTINGS(),
    fontSettings: { customFonts: [] },
    angleMode: 'd3d11',
    language: 'ko',
    laboratoryEnabled: false,
    developerModeEnabled: false,
    trayEnabled: false,
    autoUpdateEnabled: true,
    backgroundColor: 'transparent',
    useCustomCSS: false,
    customCSS: { path: null, content: '' },
    useCustomJS: false,
    customJS: { path: null, content: '', plugins: [] },
    overlayResizeAnchor: 'top-left',
    keyCounterEnabled: false,
    gridSettings: FALLBACK_GRID_SETTINGS(),
    shortcuts: FALLBACK_SHORTCUTS(),
  };
}
