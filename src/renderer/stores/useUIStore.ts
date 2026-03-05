import { create } from 'zustand';

interface UIState {
  // 기타 설정 팝업(extras popup)의 열림 상태
  isExtrasPopupOpen: boolean;
  setExtrasPopupOpen: (value: boolean) => void;
  // 불러오기/내보내기 팝업의 열림 상태
  isExportImportPopupOpen: boolean;
  setExportImportPopupOpen: (value: boolean) => void;
  // 그리드 영역 (그리드 + 프로퍼티 패널 포함) 호버 상태
  isGridAreaHovered: boolean;
  setGridAreaHovered: (value: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isExtrasPopupOpen: false,
  setExtrasPopupOpen: (value) => set({ isExtrasPopupOpen: value }),
  isExportImportPopupOpen: false,
  setExportImportPopupOpen: (value) => set({ isExportImportPopupOpen: value }),
  isGridAreaHovered: false,
  setGridAreaHovered: (value) => set({ isGridAreaHovered: value }),
}));
