/**
 * Grid 키보드 이벤트 핸들링 훅
 * - 방향키로 선택된 요소 이동
 * - Delete 키로 선택된 요소 삭제
 * - Escape 키로 선택 해제
 * - Ctrl+C/V 복사/붙여넣기
 * - Ctrl+Z/Shift+Z Undo/Redo
 */

import { useEffect, useRef } from "react";
import {
  useGridSelectionStore,
  type SelectedElement,
} from "@stores/useGridSelectionStore";
import { ARROW_KEY_HISTORY_DELAY } from "./constants";
import { isMac } from "@utils/platform";

interface UseGridKeyboardParams {
  selectedElements: SelectedElement[];
  moveSelectedElements: (
    deltaX: number,
    deltaY: number,
    saveHistory?: boolean,
  ) => void;
  deleteSelectedElements: () => void;
  clearSelection: () => void;
  copySelectedElements: () => void;
  pasteElements: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onMoveForward?: () => void;
  onMoveBackward?: () => void;
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
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onMoveForward,
  onMoveBackward,
}: UseGridKeyboardParams): void {
  const lastArrowKeyTime = useRef(0);
  const macOS = isMac();

  // 선택 요소 키보드 조작
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        typeof window !== "undefined" &&
        (window as any).__dmn_isKeyListening
      ) {
        return;
      }
      // 입력 요소에서는 무시
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;

      // Ctrl+C: 복사 (선택된 요소가 있을 때)
      if (isPrimaryModifierPressed && e.key.toLowerCase() === "c") {
        if (selectedElements.length > 0) {
          e.preventDefault();
          copySelectedElements();
        }
        return;
      }

      // Ctrl+V: 붙여넣기 (스토어에서 직접 클립보드 확인)
      if (isPrimaryModifierPressed && e.key.toLowerCase() === "v") {
        const currentClipboard = useGridSelectionStore.getState().clipboard;
        if (currentClipboard.length > 0) {
          e.preventDefault();
          pasteElements();
        }
        return;
      }

      // 선택된 요소가 없으면 무시
      if (selectedElements.length === 0) return;

      // 방향키 처리
      const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (arrowKeys.includes(e.key)) {
        e.preventDefault();

        let deltaX = 0;
        let deltaY = 0;

        switch (e.key) {
          case "ArrowUp":
            deltaY = -1;
            break;
          case "ArrowDown":
            deltaY = 1;
            break;
          case "ArrowLeft":
            deltaX = -1;
            break;
          case "ArrowRight":
            deltaX = 1;
            break;
        }

        // 일정 시간 내 연속 입력이면 히스토리 저장 안함
        const now = Date.now();
        const saveHistory =
          now - lastArrowKeyTime.current > ARROW_KEY_HISTORY_DELAY;
        lastArrowKeyTime.current = now;

        moveSelectedElements(deltaX, deltaY, saveHistory);
        return;
      }

      // Delete 키로 선택 요소 삭제
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedElements();
        return;
      }

      // Escape 키로 선택 해제
      if (e.key === "Escape") {
        clearSelection();
        return;
      }

      // ] 키로 앞으로 (bring forward)
      if (e.key === "]" && typeof onMoveForward === "function") {
        e.preventDefault();
        onMoveForward();
        return;
      }

      // [ 키로 뒤로 (send backward)
      if (e.key === "[" && typeof onMoveBackward === "function") {
        e.preventDefault();
        onMoveBackward();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedElements,
    moveSelectedElements,
    deleteSelectedElements,
    clearSelection,
    copySelectedElements,
    pasteElements,
    onMoveForward,
    onMoveBackward,
  ]);

  // Undo/Redo 단축키 핸들러
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        typeof window !== "undefined" &&
        (window as any).__dmn_isKeyListening
      ) {
        return;
      }
      // 입력 요소에서는 단축키 무시
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;

      // Ctrl+Z: Undo
      if (
        isPrimaryModifierPressed &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (canUndo && typeof onUndo === "function") {
          onUndo();
        }
      }
      // Ctrl+Shift+Z: Redo
      else if (
        isPrimaryModifierPressed &&
        e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (canRedo && typeof onRedo === "function") {
          onRedo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [macOS, canUndo, canRedo, onUndo, onRedo]);
}
