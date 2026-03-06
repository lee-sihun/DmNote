import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GridViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface GridViewStore {
  // 모드별 뷰 상태 (4key, 5key, 6key, 8key 등)
  viewStates: Record<string, GridViewState>;

  // 현재 모드의 뷰 상태 가져오기
  getViewState: (mode: string) => GridViewState;

  // 줌 설정
  setZoom: (mode: string, zoom: number) => void;

  // 팬 설정
  setPan: (mode: string, panX: number, panY: number) => void;

  // 뷰 리셋 (특정 모드)
  resetView: (mode: string) => void;

  // 모든 뷰 리셋
  resetAllViews: () => void;
}

const DEFAULT_VIEW_STATE: GridViewState = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

// 줌 제한값
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 4.0;
export const ZOOM_STEP = 0.1;

// 그리드 위치 제한값 (다중 모니터 환경 지원)
export const MIN_GRID_POSITION = -8000;
export const MAX_GRID_POSITION = 8000;

// 줌 값 클램핑 유틸리티
export const clampZoom = (zoom: number): number => {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
};

// 그리드 위치 클램핑 유틸리티
export const clampGridPosition = (value: number): number => {
  return Math.min(Math.max(value, MIN_GRID_POSITION), MAX_GRID_POSITION);
};

export const useGridViewStore = create<GridViewStore>()(
  persist(
    (set, get) => ({
      viewStates: {},

      getViewState: (mode: string): GridViewState => {
        return get().viewStates[mode] || { ...DEFAULT_VIEW_STATE };
      },

      setZoom: (mode: string, zoom: number) => {
        const clampedZoom = clampZoom(zoom);
        set((state) => ({
          viewStates: {
            ...state.viewStates,
            [mode]: {
              ...state.viewStates[mode],
              zoom: clampedZoom,
              panX: state.viewStates[mode]?.panX ?? 0,
              panY: state.viewStates[mode]?.panY ?? 0,
            },
          },
        }));
      },

      setPan: (mode: string, panX: number, panY: number) => {
        set((state) => ({
          viewStates: {
            ...state.viewStates,
            [mode]: {
              ...state.viewStates[mode],
              zoom: state.viewStates[mode]?.zoom ?? 1,
              panX,
              panY,
            },
          },
        }));
      },

      resetView: (mode: string) => {
        set((state) => ({
          viewStates: {
            ...state.viewStates,
            [mode]: { ...DEFAULT_VIEW_STATE },
          },
        }));
      },

      resetAllViews: () => {
        set({ viewStates: {} });
      },
    }),
    {
      name: 'dmnote-grid-view',
      partialize: (state) => ({ viewStates: state.viewStates }),
    },
  ),
);
