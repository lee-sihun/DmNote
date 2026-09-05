/**
 * Grid 키보드 이벤트 핸들링 훅
 * - 방향키로 선택된 요소 이동
 * - Delete 키로 선택된 요소 삭제
 * - Escape 키로 선택 해제
 * - Ctrl+C/V 복사/붙여넣기
 * - Ctrl+Z/Shift+Z Undo/Redo
 */

import { useEffect, useRef } from 'react';
import {
  useGridSelectionStore,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import { reportElementOpError } from '@src/renderer/editor/runtime/intent/elementIntent';
import { useKeyStore } from '@stores/data/useKeyStore';
import { ARROW_KEY_HISTORY_DELAY } from './constants';
import { isMac } from '@utils/core/platform';
import {
  groupSelectedElements,
  ungroupSelectedElements,
} from '@utils/grid/groupActions';
import { useHistoryShortcuts } from './useHistoryShortcuts';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock';
import { isModalLayerActive } from '@components/main/Modal/popupLayer';

interface UseGridKeyboardParams {
  selectedElements: SelectedElement[];
  moveSelectedElements: (
    deltaX: number,
    deltaY: number,
    gestureId?: string,
    syncToOverlay?: boolean,
  ) => void;
  deleteSelectedElements: () => void;
  clearSelection: () => void;
  copySelectedElements: () => void;
  pasteElements: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onMoveForward?: () => void | Promise<void>;
  onMoveBackward?: () => void | Promise<void>;
  newGroupLabel?: string;
  continuousInputStrategy?: 'sync' | 'frame';
}

/**
 * 키보드 핸들러 훅
 */
export function useGridKeyboard({
  selectedElements,
  moveSelectedElements,
  deleteSelectedElements,
  clearSelection,
  copySelectedElements,
  pasteElements,
  onUndo,
  onRedo,
  onMoveForward,
  onMoveBackward,
  newGroupLabel = 'New Group',
  continuousInputStrategy = 'frame',
}: UseGridKeyboardParams): void {
  const lastArrowKeyTime = useRef(0);
  const arrowGestureId = useRef<string | null>(null);
  const lastArrowSelectionSignature = useRef<string | null>(null);
  const selectionSignature = JSON.stringify(
    selectedElements.map(({ type, id }) => ({ type, id })),
  );
  const macOS = isMac();
  const pendingArrowMove = useRef<{
    deltaX: number;
    deltaY: number;
    gestureId: string;
  } | null>(null);
  const arrowMoveFrame = useRef<number | null>(null);

  useHistoryShortcuts({ onUndo, onRedo });

  // 선택 요소 키보드 조작
  useEffect(() => {
    const flushArrowMove = () => {
      if (arrowMoveFrame.current !== null) {
        cancelAnimationFrame(arrowMoveFrame.current);
        arrowMoveFrame.current = null;
      }
      const pending = pendingArrowMove.current;
      pendingArrowMove.current = null;
      if (pending && !isModalLayerActive()) {
        moveSelectedElements(pending.deltaX, pending.deltaY, pending.gestureId);
      }
    };

    const scheduleArrowMove = (
      deltaX: number,
      deltaY: number,
      gestureId: string,
    ) => {
      if (continuousInputStrategy === 'sync') {
        moveSelectedElements(deltaX, deltaY, gestureId);
        return;
      }

      const pending = pendingArrowMove.current;
      pendingArrowMove.current = pending
        ? {
            deltaX: pending.deltaX + deltaX,
            deltaY: pending.deltaY + deltaY,
            gestureId,
          }
        : { deltaX, deltaY, gestureId };
      if (arrowMoveFrame.current !== null) return;
      arrowMoveFrame.current = requestAnimationFrame(() => {
        arrowMoveFrame.current = null;
        flushArrowMove();
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isHistoryEditorFlushLocked()) return;
      if (isModalLayerActive()) return;
      if (typeof window !== 'undefined' && window.__dmn_isKeyListening) {
        return;
      }
      // 입력 요소에서는 무시
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + G: 선택 요소 그룹화
      if (isPrimaryModifierPressed && !e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        if (selectedElements.length < 2) return;

        const selectedKeyType = useKeyStore.getState().selectedKeyType;
        void groupSelectedElements(
          selectedKeyType,
          selectedElements,
          newGroupLabel,
        ).catch(reportElementOpError);
        return;
      }

      // Ctrl/Cmd + Shift + G: 선택 요소 그룹 해제
      if (isPrimaryModifierPressed && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        if (selectedElements.length === 0) return;

        const selectedKeyType = useKeyStore.getState().selectedKeyType;
        void ungroupSelectedElements(selectedKeyType, selectedElements).catch(
          reportElementOpError,
        );
        return;
      }

      // Ctrl+C: 복사 (선택된 요소가 있을 때)
      if (isPrimaryModifierPressed && e.key.toLowerCase() === 'c') {
        if (selectedElements.length > 0) {
          e.preventDefault();
          copySelectedElements();
        }
        return;
      }

      // Ctrl+V: 붙여넣기 (스토어에서 직접 클립보드 확인)
      if (isPrimaryModifierPressed && e.key.toLowerCase() === 'v') {
        const currentClipboard = useGridSelectionStore.getState().clipboard;
        if (currentClipboard.length > 0) {
          e.preventDefault();
          void Promise.resolve(pasteElements()).catch(reportElementOpError);
        }
        return;
      }

      // 선택된 요소가 없으면 무시
      if (selectedElements.length === 0) return;

      // 방향키 처리
      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (arrowKeys.includes(e.key)) {
        e.preventDefault();

        let deltaX = 0;
        let deltaY = 0;

        switch (e.key) {
          case 'ArrowUp':
            deltaY = -1;
            break;
          case 'ArrowDown':
            deltaY = 1;
            break;
          case 'ArrowLeft':
            deltaX = -1;
            break;
          case 'ArrowRight':
            deltaX = 1;
            break;
        }

        // 500ms 내 방향키 입력의 undo 병합
        const now = Date.now();
        if (
          lastArrowSelectionSignature.current !== selectionSignature ||
          !arrowGestureId.current ||
          now - lastArrowKeyTime.current > ARROW_KEY_HISTORY_DELAY
        ) {
          arrowGestureId.current = crypto.randomUUID();
        }
        lastArrowKeyTime.current = now;
        lastArrowSelectionSignature.current = selectionSignature;

        scheduleArrowMove(deltaX, deltaY, arrowGestureId.current);
        return;
      }

      // Delete 키로 선택 요소 삭제
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void Promise.resolve(deleteSelectedElements()).catch(
          reportElementOpError,
        );
        return;
      }

      // Escape 키로 선택 해제 — 상위 레이어(메뉴·패널 페이지)가 소비했으면 양보
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        clearSelection();
        return;
      }

      // ] 키로 앞으로 이동
      if (e.key === ']' && typeof onMoveForward === 'function') {
        e.preventDefault();
        void Promise.resolve(onMoveForward()).catch(reportElementOpError);
        return;
      }

      // [ 키로 뒤로 이동
      if (e.key === '[' && typeof onMoveBackward === 'function') {
        e.preventDefault();
        void Promise.resolve(onMoveBackward()).catch(reportElementOpError);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) flushArrowMove();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      flushArrowMove();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    macOS,
    selectedElements,
    moveSelectedElements,
    deleteSelectedElements,
    clearSelection,
    copySelectedElements,
    pasteElements,
    onMoveForward,
    onMoveBackward,
    newGroupLabel,
    selectionSignature,
    continuousInputStrategy,
  ]);
}
