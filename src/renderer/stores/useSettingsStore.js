import { create } from 'zustand';

export const useSettingsStore = create((set) => ({
  hardwareAcceleration: true, 
  alwaysOnTop: true, 
  showKeyCount: false,
  overlayLocked: false, 
  setHardwareAcceleration: (value) => set({ hardwareAcceleration: value }),
  setAlwaysOnTop: (value) => set({ alwaysOnTop: value }),
  setShowKeyCount: (value) => set({ showKeyCount: value }),
  setOverlayLocked: (value) => set({ overlayLocked: value }),
}));