import { create } from 'zustand';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

type CanonicalGraphItemPositions = CanonicalEditorDocumentV1['graphPositions'];

interface GraphItemStoreState {
  positions: CanonicalGraphItemPositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: CanonicalGraphItemPositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useGraphItemStore = create<GraphItemStoreState>((set) => ({
  positions: {},
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
