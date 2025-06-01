import { create } from 'zustand';

interface SettingsState {
  hardwareAcceleration: boolean;
  alwaysOnTop: boolean;
  // showKeyCount: boolean;
  overlayLocked: boolean;
  angleMode: string;
  noteEffect: boolean;
  setHardwareAcceleration: (value: boolean) => void;
  setAlwaysOnTop: (value: boolean) => void;
  // setShowKeyCount: (value: boolean) => void;
  setOverlayLocked: (value: boolean) => void;
  setAngleMode: (value: string) => void;
  setNoteEffect: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hardwareAcceleration: true,
  alwaysOnTop: true,
  // showKeyCount: false,
  overlayLocked: false,
  angleMode: 'd3d11',
  noteEffect: false,
  setHardwareAcceleration: (value: boolean) => set({ hardwareAcceleration: value }),
  setAlwaysOnTop: (value: boolean) => set({ alwaysOnTop: value }),
  // setShowKeyCount: (value: boolean) => set({ showKeyCount: value }),
  setOverlayLocked: (value: boolean) => set({ overlayLocked: value }),
  setAngleMode: (value: string) => set({ angleMode: value }),
  setNoteEffect: (value: boolean) => set({ noteEffect: value }),
}));