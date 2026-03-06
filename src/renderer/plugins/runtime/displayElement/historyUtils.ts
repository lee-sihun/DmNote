/**
 * 디스플레이 요소 히스토리 유틸리티
 * Undo/Redo 관련 상태 및 히스토리 저장 기능을 관리합니다.
 */

import { useKeyStore } from '@stores/useKeyStore';
import { useStatItemStore } from '@stores/useStatItemStore';
import { useGraphItemStore } from '@stores/useGraphItemStore';
import { usePluginDisplayElementStore } from '@stores/usePluginDisplayElementStore';
import { useHistoryStore } from '@stores/useHistoryStore';

// 히스토리 저장 플래그 (undo/redo 중에는 저장하지 않음)
let isUndoRedoInProgress = false;

// undo/redo 상태 변경 시각 (이벤트 레이스로 인한 플리커 억제용)
let undoRedoChangedAt = 0;

// 초기 로드 플래그 (플러그인 초기 로드 중에는 히스토리 저장하지 않음)
let isInitialLoading = false;

/**
 * 현재 상태를 히스토리에 저장합니다.
 */
export const saveToHistory = (): void => {
  if (isUndoRedoInProgress) return;
  if (isInitialLoading) return;
  if (window.__dmn_window_type !== 'main') return;

  const { keyMappings, positions } = useKeyStore.getState();
  const statPositions = useStatItemStore.getState().positions;
  const graphPositions = useGraphItemStore.getState().positions;
  const pluginElements = usePluginDisplayElementStore.getState().elements;
  useHistoryStore
    .getState()
    .pushState(
      keyMappings,
      positions,
      statPositions,
      graphPositions,
      pluginElements,
    );
};

/**
 * Undo/Redo 진행 상태를 설정합니다.
 */
export const setUndoRedoInProgress = (inProgress: boolean): void => {
  isUndoRedoInProgress = inProgress;
  undoRedoChangedAt = Date.now();
};

/**
 * 초기 로드 상태를 설정합니다.
 */
export const setInitialLoading = (loading: boolean): void => {
  isInitialLoading = loading;
};

/**
 * 현재 Undo/Redo 진행 상태를 반환합니다.
 */
export const getUndoRedoInProgress = (): boolean => {
  return isUndoRedoInProgress;
};

/**
 * undo/redo 진행 상태가 마지막으로 변경된 시각(ms)을 반환합니다.
 * (true->false 전환 직후 도착하는 이벤트를 잠시 무시하는 용도)
 */
export const getUndoRedoChangedAt = (): number => {
  return undoRedoChangedAt;
};

/**
 * 현재 초기 로드 상태를 반환합니다.
 */
export const getInitialLoading = (): boolean => {
  return isInitialLoading;
};
