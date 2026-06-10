import { create } from 'zustand';
import type { DialItemPositions } from '@src/types/key/dials';

interface DialItemStoreState {
  positions: DialItemPositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: DialItemPositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useDialItemStore = create<DialItemStoreState>((set) => ({
  positions: {} as DialItemPositions,
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
