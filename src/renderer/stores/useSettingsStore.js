import { create } from 'zustand';

export const useSettingsStore = create((set) => ({
  hardwareAcceleration: false,  // 임시 초기값
  setHardwareAcceleration: (value) => set({ hardwareAcceleration: value }),
}));