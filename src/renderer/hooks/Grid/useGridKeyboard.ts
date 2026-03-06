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
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { ARROW_KEY_HISTORY_DELAY } from './constants';
import { isMac } from '@utils/core/platform';
import {
  applyGroupIdToSelectedElements,
  buildNextLayerGroupName,
  normalizeLayerGroupsForMode,
  resolveSingleGroupIdFromSelection,
} from '@utils/layerGroupUtils';

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
  newGroupLabel?: string;
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
  newGroupLabel = 'New Group',
}: UseGridKeyboardParams): void {
  const lastArrowKeyTime = useRef(0);
  const macOS = isMac();

  // 선택 요소 키보드 조작
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        const { keyMappings, positions } = useKeyStore.getState();
        const statPos = useStatItemStore.getState().positions;
        const graphPos = useGraphItemStore.getState().positions;
        const pluginElements = usePluginDisplayElementStore.getState().elements;
        const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
        const modeGroups = currentLayerGroups[selectedKeyType] || [];

        const singleGroupId = resolveSingleGroupIdFromSelection(
          selectedKeyType,
          selectedElements,
          positions,
          statPos,
          graphPos,
        );

        let targetGroupId = singleGroupId;
        let nextLayerGroups = currentLayerGroups;
        let createdGroup = false;

        if (!targetGroupId) {
          targetGroupId = crypto.randomUUID();
          const groupName = buildNextLayerGroupName(newGroupLabel, modeGroups);
          nextLayerGroups = {
            ...currentLayerGroups,
            [selectedKeyType]: [
              ...modeGroups,
              {
                id: targetGroupId,
                name: groupName,
              },
            ],
          };
          createdGroup = true;
        }

        const grouped = applyGroupIdToSelectedElements({
          mode: selectedKeyType,
          selectedElements,
          keyPositions: positions,
          statPositions: statPos,
          graphPositions: graphPos,
          targetGroupId,
        });

        const normalized = normalizeLayerGroupsForMode({
          mode: selectedKeyType,
          keyPositions: grouped.keyPositions,
          statPositions: grouped.statPositions,
          graphPositions: grouped.graphPositions,
          layerGroups: nextLayerGroups,
        });

        const hasChange =
          grouped.changed ||
          normalized.positionsChanged ||
          createdGroup ||
          normalized.groupsChanged;
        if (!hasChange) return;

        useHistoryStore
          .getState()
          .pushState(
            keyMappings,
            positions,
            statPos,
            graphPos,
            pluginElements,
            currentLayerGroups,
          );

        useKeyStore.getState().setPositions(normalized.keyPositions);
        useStatItemStore.getState().setPositions(normalized.statPositions);
        useGraphItemStore.getState().setPositions(normalized.graphPositions);

        window.api.keys
          .updatePositions(normalized.keyPositions)
          .catch(() => {});
        window.api.statItems
          .updatePositions(normalized.statPositions)
          .catch(() => {});
        window.api.graphItems
          .updatePositions(normalized.graphPositions)
          .catch(() => {});

        if (createdGroup || normalized.groupsChanged) {
          useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
          window.api.layerGroups.update(normalized.layerGroups).catch(() => {});
        }
        return;
      }

      // Ctrl/Cmd + Shift + G: 선택 요소 그룹 해제
      if (isPrimaryModifierPressed && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        if (selectedElements.length === 0) return;

        const selectedKeyType = useKeyStore.getState().selectedKeyType;
        const { keyMappings, positions } = useKeyStore.getState();
        const statPos = useStatItemStore.getState().positions;
        const graphPos = useGraphItemStore.getState().positions;
        const pluginElements = usePluginDisplayElementStore.getState().elements;
        const currentLayerGroups = useLayerGroupStore.getState().layerGroups;

        const ungrouped = applyGroupIdToSelectedElements({
          mode: selectedKeyType,
          selectedElements,
          keyPositions: positions,
          statPositions: statPos,
          graphPositions: graphPos,
          targetGroupId: undefined,
        });

        const normalized = normalizeLayerGroupsForMode({
          mode: selectedKeyType,
          keyPositions: ungrouped.keyPositions,
          statPositions: ungrouped.statPositions,
          graphPositions: ungrouped.graphPositions,
          layerGroups: currentLayerGroups,
        });

        const hasChange = ungrouped.changed || normalized.groupsChanged;
        if (!hasChange) return;

        useHistoryStore
          .getState()
          .pushState(
            keyMappings,
            positions,
            statPos,
            graphPos,
            pluginElements,
            currentLayerGroups,
          );

        useKeyStore.getState().setPositions(normalized.keyPositions);
        useStatItemStore.getState().setPositions(normalized.statPositions);
        useGraphItemStore.getState().setPositions(normalized.graphPositions);

        window.api.keys
          .updatePositions(normalized.keyPositions)
          .catch(() => {});
        window.api.statItems
          .updatePositions(normalized.statPositions)
          .catch(() => {});
        window.api.graphItems
          .updatePositions(normalized.graphPositions)
          .catch(() => {});

        if (normalized.groupsChanged) {
          useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
          window.api.layerGroups.update(normalized.layerGroups).catch(() => {});
        }
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
          pasteElements();
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

        // 일정 시간 내 연속 입력이면 히스토리 저장 안함
        const now = Date.now();
        const saveHistory =
          now - lastArrowKeyTime.current > ARROW_KEY_HISTORY_DELAY;
        lastArrowKeyTime.current = now;

        moveSelectedElements(deltaX, deltaY, saveHistory);
        return;
      }

      // Delete 키로 선택 요소 삭제
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedElements();
        return;
      }

      // Escape 키로 선택 해제
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      // ] 키로 앞으로 이동
      if (e.key === ']' && typeof onMoveForward === 'function') {
        e.preventDefault();
        onMoveForward();
        return;
      }

      // [ 키로 뒤로 이동
      if (e.key === '[' && typeof onMoveBackward === 'function') {
        e.preventDefault();
        onMoveBackward();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
  ]);

  // Undo/Redo 단축키 처리
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (typeof window !== 'undefined' && window.__dmn_isKeyListening) {
        return;
      }
      // 입력 요소에서는 단축키 무시
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;

      // Ctrl+Z: 실행 취소
      if (
        isPrimaryModifierPressed &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'z'
      ) {
        e.preventDefault();
        if (canUndo && typeof onUndo === 'function') {
          onUndo();
        }
      }
      // Ctrl+Shift+Z: 다시 실행
      else if (
        isPrimaryModifierPressed &&
        e.shiftKey &&
        e.key.toLowerCase() === 'z'
      ) {
        e.preventDefault();
        if (canRedo && typeof onRedo === 'function') {
          onRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [macOS, canUndo, canRedo, onUndo, onRedo]);
}
