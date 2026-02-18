import { create } from "zustand";
import type { GraphItemPositions } from "@src/types/graphItems";

interface GraphItemStoreState {
  positions: GraphItemPositions;
  isLocalUpdateInProgress: boolean;
  setPositions: (positions: GraphItemPositions) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useGraphItemStore = create<GraphItemStoreState>((set) => ({
  positions: {} as GraphItemPositions,
  isLocalUpdateInProgress: false,
  setPositions: (positions) => set({ positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));

