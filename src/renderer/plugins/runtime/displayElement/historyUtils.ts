/**
 * 디스플레이 요소 히스토리 유틸리티
 * Undo/Redo 관련 상태를 관리합니다.
 */

// 히스토리 저장 플래그 (undo/redo 중에는 저장하지 않음)
let isUndoRedoInProgress = false;

/**
 * Undo/Redo 진행 상태를 설정합니다.
 */
export const setUndoRedoInProgress = (inProgress: boolean): void => {
  isUndoRedoInProgress = inProgress;
};

/**
 * 현재 Undo/Redo 진행 상태를 반환합니다.
 */
export const getUndoRedoInProgress = (): boolean => {
  return isUndoRedoInProgress;
};
