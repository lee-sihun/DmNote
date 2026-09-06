import { create } from 'zustand';

interface SelectionRotationState {
  selectionKey: string | null;
  referenceRotation: number;
  setReference: (selectionKey: string | null, rotation: number) => void;
}

// 선택을 유지하는 동안만 공통 틀의 시작 방향을 기억
export const useSelectionRotationStore = create<SelectionRotationState>(
  (set, get) => ({
    selectionKey: null,
    referenceRotation: 0,
    setReference: (selectionKey, referenceRotation) => {
      if (get().selectionKey === selectionKey) return;
      set({ selectionKey, referenceRotation });
    },
  }),
);
