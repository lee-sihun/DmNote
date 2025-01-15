import { create } from 'zustand';

export const useSettingsStore = create((set) => ({
  hardwareAcceleration: true, 
  alwaysOnTop: true, 
  setHardwareAcceleration: (value) => set({ hardwareAcceleration: value }),
  setAlwaysOnTop: (value) => set({ alwaysOnTop: value }),
}));