import { create } from 'zustand';
import type {
  GuideLine,
  ElementBounds,
  SpacingGuide,
  SizeMatchGuide,
} from '@utils/smartGuides';

interface SmartGuidesState {
  // 현재 활성화된 가이드라인들
  activeGuides: GuideLine[];
  // 간격 가이드라인들
  spacingGuides: SpacingGuide[];
  // 크기 일치 가이드라인들
  sizeMatchGuides: SizeMatchGuide[];
  // 드래그 중인 요소의 bounds
  draggedBounds: ElementBounds | null;
  // 스마트 가이드 활성화 여부
  isActive: boolean;

  // Actions
  setActiveGuides: (guides: GuideLine[]) => void;
  setSpacingGuides: (guides: SpacingGuide[]) => void;
  setSizeMatchGuides: (guides: SizeMatchGuide[]) => void;
  setDraggedBounds: (bounds: ElementBounds | null) => void;
  clearGuides: () => void;
}

export const useSmartGuidesStore = create<SmartGuidesState>((set) => ({
  activeGuides: [],
  spacingGuides: [],
  sizeMatchGuides: [],
  draggedBounds: null,
  isActive: false,

  setActiveGuides: (guides) =>
    set((state) => ({
      activeGuides: guides,
      isActive:
        guides.length > 0 ||
        state.spacingGuides.length > 0 ||
        state.sizeMatchGuides.length > 0,
    })),

  setSpacingGuides: (guides) =>
    set((state) => ({
      spacingGuides: guides,
      isActive:
        state.activeGuides.length > 0 ||
        guides.length > 0 ||
        state.sizeMatchGuides.length > 0,
    })),

  setSizeMatchGuides: (guides) =>
    set((state) => ({
      sizeMatchGuides: guides,
      isActive:
        state.activeGuides.length > 0 ||
        state.spacingGuides.length > 0 ||
        guides.length > 0,
    })),

  setDraggedBounds: (bounds) =>
    set({
      draggedBounds: bounds,
    }),

  clearGuides: () =>
    set({
      activeGuides: [],
      spacingGuides: [],
      sizeMatchGuides: [],
      draggedBounds: null,
      isActive: false,
    }),
}));
