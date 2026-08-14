import { create } from 'zustand';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

type CanonicalKnobItemPositions = CanonicalEditorDocumentV1['knobPositions'];

interface KnobItemStoreState {
  positions: CanonicalKnobItemPositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: CanonicalKnobItemPositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useKnobItemStore = create<KnobItemStoreState>((set) => ({
  positions: {},
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
