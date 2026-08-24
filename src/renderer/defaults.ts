import type {
  KeyCounterSettings,
  CounterAnimationBezier,
} from '@src/types/key/keys';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import type { GridSettings, SettingsState } from '@src/types/settings/settings';
import type { ShortcutsState } from '@src/types/settings/shortcuts';
import type { FontSettings } from '@src/types/settings/fonts';
import {
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_COUNTER_FONT_SIZE,
  DEFAULT_COUNTER_FONT_WEIGHT,
} from '@utils/core/elementDefaults';
import { NOTE_SETTINGS_CONSTRAINTS } from '@src/types/settings/noteSettingsConstraints';
import { isMac } from '@utils/core/platform';

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
    ? { ...FALLBACK_GRID_SETTINGS(), ..._defaults.settings.gridSettings }
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
  return (
    _defaults?.counterSettings.animation.presetId ?? FALLBACK_COUNTER_PRESET_ID
  );
}

// ── Fallback values (used only before bootstrap completes) ──

const FALLBACK_COUNTER_PRESET_ID = 'builtin-ease-out';

function FALLBACK_COUNTER_SETTINGS(): KeyCounterSettings {
  return {
    enabled: true,
    placement: 'inside',
    align: 'bottom',
    alignMode: 'center',
    fill: { idle: DEFAULT_ELEMENT_FONT, active: DEFAULT_ELEMENT_ACTIVE_FONT },
    stroke: { idle: 'transparent', active: 'transparent' },
    gap: 4,
    fontSize: DEFAULT_COUNTER_FONT_SIZE,
    fontWeight: DEFAULT_COUNTER_FONT_WEIGHT,
    fontBold: false,
    fontFamily: null,
    fontItalic: false,
    fontUnderline: false,
    fontStrikethrough: false,
    animation: {
      enabled: false,
      presetId: FALLBACK_COUNTER_PRESET_ID,
      bezier: [0.25, 0.46, 0.45, 0.94],
      scale: 1.1,
      durationMs: 300,
    },
  };
}

// 노트 설정 canonical 기본값, Rust NoteSettings::default 미러
// 숫자 기본값의 원천은 NOTE_SETTINGS_CONSTRAINTS, 나머지는 여기가 유일 선언
export const NOTE_SETTINGS_FALLBACK = Object.freeze({
  frameLimit: NOTE_SETTINGS_CONSTRAINTS.frameLimit.default,
  speed: NOTE_SETTINGS_CONSTRAINTS.speed.default,
  trackHeight: NOTE_SETTINGS_CONSTRAINTS.trackHeight.default,
  reverse: false,
  fadePosition: 'auto',
  fadeTopPx: NOTE_SETTINGS_CONSTRAINTS.fadeTopPx.default,
  fadeBottomPx: NOTE_SETTINGS_CONSTRAINTS.fadeBottomPx.default,
  reverseFadeTopPx: NOTE_SETTINGS_CONSTRAINTS.reverseFadeTopPx.default,
  reverseFadeBottomPx: NOTE_SETTINGS_CONSTRAINTS.reverseFadeBottomPx.default,
  delayedNoteEnabled: false,
  shortNoteThresholdMs: NOTE_SETTINGS_CONSTRAINTS.shortNoteThresholdMs.default,
  shortNoteMinLengthPx: NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.default,
  keyDisplayDelayMs: NOTE_SETTINGS_CONSTRAINTS.keyDisplayDelayMs.default,
} as const);

// 반환 타입 주석이 NOTE_SETTINGS_FALLBACK의 전 필드 포함을 컴파일 타임에 보장
function FALLBACK_NOTE_SETTINGS(): NoteSettings {
  return { ...NOTE_SETTINGS_FALLBACK };
}

function FALLBACK_GRID_SETTINGS(): GridSettings {
  return {
    alignmentGuides: true,
    spacingGuides: true,
    sizeMatchGuides: true,
    minimapEnabled: true,
    gridSnapSize: 5,
    overlayPadding: 30,
  };
}

// 백엔드 SettingsState 기본과 동일 규칙 - macOS는 Cmd, 그 외는 Ctrl
const primaryModifierShortcut = (key: string, shift = false) => ({
  key,
  ctrl: !isMac(),
  shift,
  alt: false,
  meta: isMac(),
});

function FALLBACK_SHORTCUTS(): ShortcutsState {
  return {
    toggleOverlay: primaryModifierShortcut('KeyO', true),
    toggleOverlayLock: { key: '' },
    toggleAlwaysOnTop: { key: '' },
    switchKeyMode: {
      key: 'Tab',
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    },
    toggleSettingsPanel: primaryModifierShortcut('KeyB'),
    zoomIn: primaryModifierShortcut('Equal'),
    zoomOut: primaryModifierShortcut('Minus'),
    resetZoom: primaryModifierShortcut('Digit0'),
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
    angleMode: isMac() ? 'metal' : 'd3d11',
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
    obsModeEnabled: false,
  };
}
