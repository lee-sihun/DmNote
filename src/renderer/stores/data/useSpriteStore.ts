import { create } from 'zustand';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

type CanonicalSpritePositions = CanonicalEditorDocumentV1['spritePositions'];

interface SpriteStoreState {
  positions: CanonicalSpritePositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: CanonicalSpritePositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useSpriteStore = create<SpriteStoreState>((set) => ({
  positions: {},
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
