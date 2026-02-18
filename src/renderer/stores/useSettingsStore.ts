import { create } from "zustand";
import {
  NOTE_SETTINGS_DEFAULTS,
  type NoteSettings,
} from "@src/types/noteSettings";
import type { FontSettings } from "@src/types/fonts";
import { DEFAULT_FONT_SETTINGS } from "@src/types/fonts";
import type { OverlayResizeAnchor } from "@src/types/settings";
import type { JsPlugin } from "@src/types/js";
import { DEFAULT_SHORTCUTS, type ShortcutsState } from "@src/types/shortcuts";

export interface GridSettings {
  alignmentGuides: boolean;
  spacingGuides: boolean;
  sizeMatchGuides: boolean;
  minimapEnabled: boolean;
  gridSnapSize: number; // 그리드 스냅 크기 (1-10px)
}

const DEFAULT_GRID_SETTINGS: GridSettings = {
  alignmentGuides: true,
  spacingGuides: true,
  sizeMatchGuides: true,
  minimapEnabled: false,
  gridSnapSize: 5,
};

interface SettingsState {
  hardwareAcceleration: boolean;
  alwaysOnTop: boolean;
  overlayLocked: boolean;
  angleMode: string;
  noteEffect: boolean;
  noteSettings: NoteSettings;
  fontSettings: FontSettings;
  useCustomCSS: boolean;
  customCSSContent: string;
  customCSSPath: string | null;
  useCustomJS: boolean;
  jsPlugins: JsPlugin[];
  backgroundColor: string;
  language: string;
  laboratoryEnabled: boolean;
  developerModeEnabled: boolean;
  trayEnabled: boolean;
  overlayResizeAnchor: OverlayResizeAnchor;
  keyCounterEnabled: boolean;
  gridSettings: GridSettings;
  shortcuts: ShortcutsState;
  setAll: (payload: SettingsStateSnapshot) => void;
  merge: (payload: Partial<SettingsStateSnapshot>) => void;
  setLaboratoryEnabled: (value: boolean) => void;
  setTrayEnabled: (value: boolean) => void;
  setDeveloperModeEnabled: (value: boolean) => void;
  setHardwareAcceleration: (value: boolean) => void;
  setAlwaysOnTop: (value: boolean) => void;
  setUseCustomCSS: (value: boolean) => void;
  setCustomCSSContent: (value: string) => void;
  setCustomCSSPath: (value: string | null) => void;
  setUseCustomJS: (value: boolean) => void;
  setJsPlugins: (value: JsPlugin[]) => void;
  setOverlayLocked: (value: boolean) => void;
  setAngleMode: (value: string) => void;
  setNoteEffect: (value: boolean) => void;
  setNoteSettings: (value: NoteSettings) => void;
  setFontSettings: (value: FontSettings) => void;
  setLanguage: (value: string) => void;
  setBackgroundColor: (value: string) => void;
  setOverlayResizeAnchor: (value: OverlayResizeAnchor) => void;
  setKeyCounterEnabled: (value: boolean) => void;
  setGridSettings: (value: GridSettings) => void;
  setShortcuts: (value: ShortcutsState) => void;
}

export type SettingsStateSnapshot = Omit<
  SettingsState,
  | "setAll"
  | "merge"
  | "setLaboratoryEnabled"
  | "setTrayEnabled"
  | "setHardwareAcceleration"
  | "setAlwaysOnTop"
  | "setUseCustomCSS"
  | "setCustomCSSContent"
  | "setCustomCSSPath"
  | "setUseCustomJS"
  | "setJsPlugins"
  | "setOverlayLocked"
  | "setAngleMode"
  | "setNoteEffect"
  | "setNoteSettings"
  | "setFontSettings"
  | "setLanguage"
  | "setBackgroundColor"
  | "setOverlayResizeAnchor"
  | "setKeyCounterEnabled"
  | "setDeveloperModeEnabled"
  | "setGridSettings"
  | "setShortcuts"
>;

const initialState: SettingsStateSnapshot = {
  hardwareAcceleration: true,
  alwaysOnTop: true,
  overlayLocked: false,
  angleMode: "d3d11",
  noteEffect: false,
  noteSettings: NOTE_SETTINGS_DEFAULTS,
  fontSettings: DEFAULT_FONT_SETTINGS,
  useCustomCSS: false,
  customCSSContent: "",
  customCSSPath: null,
  useCustomJS: false,
  jsPlugins: [],
  backgroundColor: "transparent",
  language: "ko",
  laboratoryEnabled: false,
  developerModeEnabled: false,
  trayEnabled: false,
  overlayResizeAnchor: "top-left",
  keyCounterEnabled: false,
  gridSettings: DEFAULT_GRID_SETTINGS,
  shortcuts: DEFAULT_SHORTCUTS,
};

function mergeSnapshot(
  prev: SettingsStateSnapshot,
  patch: Partial<SettingsStateSnapshot>
): SettingsStateSnapshot {
  const next: SettingsStateSnapshot = {
    ...prev,
    ...patch,
  };

  if (patch.noteSettings) {
    next.noteSettings = {
      ...prev.noteSettings,
      ...patch.noteSettings,
    };
  }
  if (patch.fontSettings) {
    next.fontSettings = {
      customFonts: patch.fontSettings.customFonts.map((font) => ({
        ...font,
      })),
    };
  }
  if (
    patch.customCSSContent !== undefined ||
    patch.customCSSPath !== undefined
  ) {
    next.customCSSContent = patch.customCSSContent ?? prev.customCSSContent;
    next.customCSSPath = patch.customCSSPath ?? prev.customCSSPath;
  }
  if (patch.jsPlugins !== undefined) {
    next.jsPlugins = patch.jsPlugins
      ? patch.jsPlugins.map((plugin) => ({ ...plugin }))
      : prev.jsPlugins;
  }
  if (patch.gridSettings) {
    next.gridSettings = {
      ...prev.gridSettings,
      ...patch.gridSettings,
    };
  }
  if (patch.shortcuts) {
    next.shortcuts = {
      ...prev.shortcuts,
      ...patch.shortcuts,
    };
  }
  return next;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...initialState,
  setAll: (payload) => set(() => mergeSnapshot(initialState, payload)),
  merge: (payload) => set((state) => mergeSnapshot(state, payload)),
  setDeveloperModeEnabled: (value) => set({ developerModeEnabled: value }),
  setHardwareAcceleration: (value) => set({ hardwareAcceleration: value }),
  setAlwaysOnTop: (value) => set({ alwaysOnTop: value }),
  setUseCustomCSS: (value) => set({ useCustomCSS: value }),
  setCustomCSSContent: (value) => set({ customCSSContent: value }),
  setCustomCSSPath: (value) => set({ customCSSPath: value }),
  setUseCustomJS: (value) => set({ useCustomJS: value }),
  setJsPlugins: (value) => set({ jsPlugins: value }),
  setOverlayLocked: (value) => set({ overlayLocked: value }),
  setAngleMode: (value) => set({ angleMode: value }),
  setNoteEffect: (value) => set({ noteEffect: value }),
  setNoteSettings: (value) => set({ noteSettings: value }),
  setFontSettings: (value) => set({ fontSettings: value }),
  setLanguage: (value) => set({ language: value }),
  setLaboratoryEnabled: (value) => set({ laboratoryEnabled: value }),
  setTrayEnabled: (value) => set({ trayEnabled: value }),
  setBackgroundColor: (value) => set({ backgroundColor: value }),
  setOverlayResizeAnchor: (value) => set({ overlayResizeAnchor: value }),
  setKeyCounterEnabled: (value) => set({ keyCounterEnabled: value }),
  setGridSettings: (value) => set({ gridSettings: value }),
  setShortcuts: (value) => set({ shortcuts: value }),
}));
