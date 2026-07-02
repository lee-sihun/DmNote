import { create } from 'zustand';
import type { KnobItemPositions } from '@src/types/key/knobs';

interface KnobItemStoreState {
  positions: KnobItemPositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: KnobItemPositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useKnobItemStore = create<KnobItemStoreState>((set) => ({
  positions: {} as KnobItemPositions,
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
