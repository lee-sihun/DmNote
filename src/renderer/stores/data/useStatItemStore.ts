import { create } from 'zustand';
import type { StatItemPositions } from '@src/types/key/statItems';

interface StatItemStoreState {
  positions: StatItemPositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: StatItemPositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useStatItemStore = create<StatItemStoreState>((set) => ({
  positions: {} as StatItemPositions,
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
