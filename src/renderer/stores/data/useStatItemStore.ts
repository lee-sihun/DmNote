import { create } from 'zustand';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

type CanonicalStatItemPositions = CanonicalEditorDocumentV1['statPositions'];

interface StatItemStoreState {
  positions: CanonicalStatItemPositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: CanonicalStatItemPositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useStatItemStore = create<StatItemStoreState>((set) => ({
  positions: {},
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
