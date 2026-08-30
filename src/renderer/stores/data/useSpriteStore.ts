import { create } from 'zustand';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

type CanonicalSpritePositions = CanonicalEditorDocumentV1['spritePositions'];

interface SpriteStoreState {
  positions: CanonicalSpritePositions;
  setPositions: (positions: CanonicalSpritePositions) => void;
}

export const useSpriteStore = create<SpriteStoreState>((set) => ({
  positions: {},
  setPositions: (positions) => set({ positions }),
}));
