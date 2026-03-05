/**
 * Grid 유틸리티 함수들
 */

import { useSettingsStore } from '@stores/useSettingsStore';

/**
 * 값을 그리드 스냅에 맞춰 반올림
 * @param value - 스냅할 값
 * @param gridSize - 스냅 크기 (선택적, 기본값은 store에서 가져옴)
 * @returns 스냅된 값
 */
export const snapToGrid = (value: number, gridSize?: number): number => {
  if (!Number.isFinite(value)) return 0;
  const snapSize =
    gridSize ?? useSettingsStore.getState().gridSettings?.gridSnapSize ?? 5;
  return Math.round(value / snapSize) * snapSize;
};

/**
 * 커서 좌표를 그리드에 스냅
 * @param x - X 좌표
 * @param y - Y 좌표
 * @param gridSize - 스냅 크기 (선택적, 기본값은 store에서 가져옴)
 * @returns 스냅된 좌표
 */
export const snapCursorToGrid = (
  x: number,
  y: number,
  gridSize?: number,
): { x: number; y: number } => ({
  x: snapToGrid(x, gridSize),
  y: snapToGrid(y, gridSize),
});
