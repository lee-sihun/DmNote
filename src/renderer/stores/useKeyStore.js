import { create } from 'zustand'

export const useKeyStore = create((set) => ({
  selectedKeyType: '4key',
  setSelectedKeyType: (keyType) => set({ selectedKeyType: keyType }),
}))