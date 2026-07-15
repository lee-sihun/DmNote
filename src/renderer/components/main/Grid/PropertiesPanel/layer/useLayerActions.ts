/**
 * 레이어 패널 액션 훅
 * 가시성 토글, 이름 변경, 컨텍스트 메뉴, 삭제, 그룹 연산 등
 */

import { useState, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  applyGroupIdToSelectedElements,
  buildNextLayerGroupName,
  normalizeLayerGroupsForMode,
  resolveSingleGroupIdFromSelection,
} from '@utils/layerGroupUtils';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { stableStringify } from '@utils/core/stableStringify';
import type { EditorPatchV1 } from '@src/types/editor';
import type { LayerGroups } from '@src/types/layerGroups';
import type { LayerGroupDef } from '@src/types/layerGroups';
import type { ListItem } from '@components/main/Modal/ListPopup';
import type { LayerItem, DisplayItem } from '../types';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

// ============================================================================
// 파라미터 / 반환 타입
// ============================================================================

interface UseLayerActionsParams {
  selectedKeyType: string;
  layerItems: LayerItem[];
  layerGroupsForMode: LayerGroupDef[];
  onSelectionFromPanel?: () => void;
  clearPendingDeselect: () => void;
  displayItemsRef: React.MutableRefObject<DisplayItem[]>;
  setLastClickedIndex: (index: number | null) => void;
  setLastClickedDisplayIndex: (index: number | null) => void;
  t: (key: string) => string;
}

// ============================================================================
// 히스토리 저장 헬퍼
// ============================================================================

function pushCurrentStateToHistory(layerGroups?: LayerGroups) {
  const { keyMappings: km, positions: pos } = useKeyStore.getState();
  const statPos = useStatItemStore.getState().positions;
  const graphPos = useGraphItemStore.getState().positions;
  const pluginEls = usePluginDisplayElementStore.getState().elements;
  useHistoryStore.getState().pushState({
    keyMappings: km,
    positions: pos,
    statPositions: statPos,
    graphPositions: graphPos,
    pluginElements: pluginEls,
    layerGroups,
  });
}

function hasChanged(current: unknown, next: unknown) {
  return stableStringify(current) !== stableStringify(next);
}

// ============================================================================
// 훅
// ============================================================================

export function useLayerActions({
  selectedKeyType,
  layerItems,
  layerGroupsForMode,
  onSelectionFromPanel,
  clearPendingDeselect,
  displayItemsRef,
  setLastClickedIndex,
  setLastClickedDisplayIndex,
  t,
}: UseLayerActionsParams) {
  // 컨텍스트 메뉴 상태
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [contextMenuItem, setContextMenuItem] = useState<LayerItem | null>(
    null,
  );
  const [contextMenuGroupId, setContextMenuGroupId] = useState<string | null>(
    null,
  );

  // 인라인 이름 변경 상태
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);

  // ──────────────────────────────────────────────────────────────────────────
  // 가시성 토글
  // ──────────────────────────────────────────────────────────────────────────

  const handleToggleVisibility = async (
    e: React.MouseEvent,
    item: LayerItem,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    clearPendingDeselect();
    onSelectionFromPanel?.();

    pushCurrentStateToHistory();

    if (item.type === 'key' && item.index !== undefined) {
      const pos = useKeyStore.getState().positions;
      const currentPositions = pos[selectedKeyType] || [];
      const current = currentPositions[item.index];
      if (!current) return;

      const updatedPositions = { ...pos };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...current,
        hidden: !current.hidden,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useKeyStore.getState().setLocalUpdateInProgress(true);
      useKeyStore.getState().setPositions(updatedPositions);
      try {
        await window.api.keys.updatePositions(updatedPositions);
      } catch (error) {
        console.error('Failed to toggle key visibility', error);
      } finally {
        useKeyStore.getState().setLocalUpdateInProgress(false);
      }
      return;
    }

    if (item.type === 'stat' && item.index !== undefined) {
      const current = useStatItemStore.getState().positions;
      const currentPositions = current[selectedKeyType] || [];
      const target = currentPositions[item.index];
      if (!target) return;

      const updatedPositions = { ...current };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...target,
        hidden: !target.hidden,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useStatItemStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setPositions(updatedPositions);
      try {
        await window.api.statItems.updatePositions(updatedPositions);
      } catch (error) {
        console.error('Failed to toggle stat item visibility', error);
      } finally {
        useStatItemStore.getState().setLocalUpdateInProgress(false);
      }
      return;
    }

    if (item.type === 'graph' && item.index !== undefined) {
      const current = useGraphItemStore.getState().positions;
      const currentPositions = current[selectedKeyType] || [];
      const target = currentPositions[item.index];
      if (!target) return;

      const updatedPositions = { ...current };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...target,
        hidden: !target.hidden,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useGraphItemStore.getState().setLocalUpdateInProgress(true);
      useGraphItemStore.getState().setPositions(updatedPositions);
      try {
        await window.api.graphItems.updatePositions(updatedPositions);
      } catch (error) {
        console.error('Failed to toggle graph item visibility', error);
      } finally {
        useGraphItemStore.getState().setLocalUpdateInProgress(false);
      }
      return;
    }

    if (item.type === 'knob' && item.index !== undefined) {
      const current = useKnobItemStore.getState().positions;
      const currentPositions = current[selectedKeyType] || [];
      const target = currentPositions[item.index];
      if (!target) return;

      const updatedPositions = { ...current };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...target,
        hidden: !target.hidden,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useKnobItemStore.getState().setLocalUpdateInProgress(true);
      useKnobItemStore.getState().setPositions(updatedPositions);
      try {
        await window.api.knobItems.updatePositions(updatedPositions);
      } catch (error) {
        console.error('Failed to toggle knob item visibility', error);
      } finally {
        useKnobItemStore.getState().setLocalUpdateInProgress(false);
      }
      return;
    }

    if (item.type === 'plugin') {
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const el = currentPluginElements.find((p) => p.fullId === item.id);
      if (!el) return;
      usePluginDisplayElementStore
        .getState()
        .updateElement(item.id, { hidden: !el.hidden });
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 그룹 전체 표시/숨김 토글
  // ──────────────────────────────────────────────────────────────────────────

  const handleToggleGroupVisibility = async (
    e: React.MouseEvent,
    groupId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const children = layerItems.filter((item) => item.groupId === groupId);
    if (children.length === 0) return;

    const allHidden = children.every((c) => c.hidden);
    const newHidden = !allHidden;

    pushCurrentStateToHistory();

    const changes: EditorPatchV1 = { schemaVersion: 1 };

    // 키 positions
    const keyChildren = children.filter(
      (c) => c.type === 'key' && c.index !== undefined,
    );
    if (keyChildren.length > 0) {
      const pos = useKeyStore.getState().positions;
      const updatedPositions = { ...pos };
      const modePositions = [...(pos[selectedKeyType] || [])];
      keyChildren.forEach((c) => {
        if (c.index !== undefined && modePositions[c.index]) {
          modePositions[c.index] = {
            ...modePositions[c.index],
            hidden: newHidden,
          };
        }
      });
      updatedPositions[selectedKeyType] = modePositions;
      useKeyStore.getState().setPositions(updatedPositions);
      changes.keyPositions = updatedPositions;
    }

    // 통계 positions
    const statChildren = children.filter(
      (c) => c.type === 'stat' && c.index !== undefined,
    );
    if (statChildren.length > 0) {
      const current = useStatItemStore.getState().positions;
      const modePositions = [...(current[selectedKeyType] || [])];
      statChildren.forEach((c) => {
        if (c.index !== undefined && modePositions[c.index]) {
          modePositions[c.index] = {
            ...modePositions[c.index],
            hidden: newHidden,
          };
        }
      });
      const updatedPositions = {
        ...current,
        [selectedKeyType]: modePositions,
      };
      useStatItemStore.getState().setPositions(updatedPositions);
      changes.statPositions = updatedPositions;
    }

    // 그래프 positions
    const graphChildren = children.filter(
      (c) => c.type === 'graph' && c.index !== undefined,
    );
    if (graphChildren.length > 0) {
      const current = useGraphItemStore.getState().positions;
      const modePositions = [...(current[selectedKeyType] || [])];
      graphChildren.forEach((c) => {
        if (c.index !== undefined && modePositions[c.index]) {
          modePositions[c.index] = {
            ...modePositions[c.index],
            hidden: newHidden,
          };
        }
      });
      const updatedPositions = {
        ...current,
        [selectedKeyType]: modePositions,
      };
      useGraphItemStore.getState().setPositions(updatedPositions);
      changes.graphPositions = updatedPositions;
    }

    // 노브 positions
    const knobChildren = children.filter(
      (c) => c.type === 'knob' && c.index !== undefined,
    );
    if (knobChildren.length > 0) {
      const current = useKnobItemStore.getState().positions;
      const modePositions = [...(current[selectedKeyType] || [])];
      knobChildren.forEach((c) => {
        if (c.index !== undefined && modePositions[c.index]) {
          modePositions[c.index] = {
            ...modePositions[c.index],
            hidden: newHidden,
          };
        }
      });
      const updatedPositions = {
        ...current,
        [selectedKeyType]: modePositions,
      };
      useKnobItemStore.getState().setPositions(updatedPositions);
      changes.knobPositions = updatedPositions;
    }

    if (Object.keys(changes).length > 1) {
      try {
        await editorCoordinator.commitPatch(changes);
      } catch (error) {
        console.error('Failed to toggle group visibility', error);
      }
    }

    // 플러그인
    const pluginChildren = children.filter((c) => c.type === 'plugin');
    pluginChildren.forEach((c) => {
      usePluginDisplayElementStore
        .getState()
        .updateElement(c.id, { hidden: newHidden });
    });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 레이어 이름 변경 커밋
  // ──────────────────────────────────────────────────────────────────────────

  const handleLayerRenameCommit = async (item: LayerItem, value: string) => {
    setRenamingItemId(null);
    const trimmed = value.trim();
    const newLayerName = trimmed === '' ? undefined : trimmed;

    if (item.type === 'key' && item.index !== undefined) {
      const { positions: pos } = useKeyStore.getState();
      const currentPositions = pos[selectedKeyType] || [];
      const current = currentPositions[item.index];
      if (!current) return;

      const updatedPositions = { ...pos };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...current,
        layerName: newLayerName,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useKeyStore.getState().setLocalUpdateInProgress(true);
      useKeyStore.getState().setPositions(updatedPositions);
      try {
        await window.api.keys.updatePositions(updatedPositions);
      } finally {
        useKeyStore.getState().setLocalUpdateInProgress(false);
      }
    } else if (item.type === 'stat' && item.index !== undefined) {
      const current = useStatItemStore.getState().positions;
      const currentPositions = current[selectedKeyType] || [];
      const target = currentPositions[item.index];
      if (!target) return;

      const updatedPositions = { ...current };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...target,
        layerName: newLayerName,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useStatItemStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setPositions(updatedPositions);
      try {
        await window.api.statItems.updatePositions(updatedPositions);
      } finally {
        useStatItemStore.getState().setLocalUpdateInProgress(false);
      }
    } else if (item.type === 'graph' && item.index !== undefined) {
      const current = useGraphItemStore.getState().positions;
      const currentPositions = current[selectedKeyType] || [];
      const target = currentPositions[item.index];
      if (!target) return;

      const updatedPositions = { ...current };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...target,
        layerName: newLayerName,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useGraphItemStore.getState().setLocalUpdateInProgress(true);
      useGraphItemStore.getState().setPositions(updatedPositions);
      try {
        await window.api.graphItems.updatePositions(updatedPositions);
      } finally {
        useGraphItemStore.getState().setLocalUpdateInProgress(false);
      }
    } else if (item.type === 'knob' && item.index !== undefined) {
      const current = useKnobItemStore.getState().positions;
      const currentPositions = current[selectedKeyType] || [];
      const target = currentPositions[item.index];
      if (!target) return;

      const updatedPositions = { ...current };
      const updatedModePositions = [...currentPositions];
      updatedModePositions[item.index] = {
        ...target,
        layerName: newLayerName,
      };
      updatedPositions[selectedKeyType] = updatedModePositions;

      useKnobItemStore.getState().setLocalUpdateInProgress(true);
      useKnobItemStore.getState().setPositions(updatedPositions);
      try {
        await window.api.knobItems.updatePositions(updatedPositions);
      } finally {
        useKnobItemStore.getState().setLocalUpdateInProgress(false);
      }
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 그룹 이름 변경 커밋
  // ──────────────────────────────────────────────────────────────────────────

  const handleGroupRenameCommit = async (groupId: string, value: string) => {
    setRenamingItemId(null);
    const trimmed = value.trim();
    if (trimmed === '') return;

    const { keyMappings: km, positions: pos } = useKeyStore.getState();
    const statPos = useStatItemStore.getState().positions;
    const graphPos = useGraphItemStore.getState().positions;
    const pluginEls = usePluginDisplayElementStore.getState().elements;
    const currentGroups = useLayerGroupStore.getState().layerGroups;
    const currentModeGroups = currentGroups[selectedKeyType] || [];
    const currentGroup = currentModeGroups.find(
      (group) => group.id === groupId,
    );
    if (!currentGroup || currentGroup.name === trimmed) return;

    useHistoryStore.getState().pushState({
      keyMappings: km,
      positions: pos,
      statPositions: statPos,
      graphPositions: graphPos,
      pluginElements: pluginEls,
      layerGroups: currentGroups,
    });

    const updated: LayerGroups = {
      ...currentGroups,
      [selectedKeyType]: currentModeGroups.map((group) =>
        group.id === groupId ? { ...group, name: trimmed } : group,
      ),
    };

    useLayerGroupStore.getState().setLayerGroups(updated);
    try {
      await window.api.layerGroups.update(updated);
    } catch (error) {
      console.error('Failed to rename group', error);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 선택된 레이어들에 groupId 설정
  // ──────────────────────────────────────────────────────────────────────────

  const setGroupIdOnSelected = async (
    targetGroupId: string | undefined,
    elementsOverride?: SelectedElement[],
    options?: {
      skipHistory?: boolean;
      historyLayerGroups?: LayerGroups;
      layerGroupsForNormalization?: LayerGroups;
    },
  ) => {
    const selectedForUpdate =
      elementsOverride ?? useGridSelectionStore.getState().selectedElements;
    if (selectedForUpdate.length === 0) return false;

    const { keyMappings: km, positions: pos } = useKeyStore.getState();
    const currentStatPositions = useStatItemStore.getState().positions;
    const currentGraphPositions = useGraphItemStore.getState().positions;
    const currentPluginElements =
      usePluginDisplayElementStore.getState().elements;
    const storeLayerGroups = useLayerGroupStore.getState().layerGroups;
    const historyLayerGroups = options?.historyLayerGroups ?? storeLayerGroups;
    const layerGroupsForNormalization =
      options?.layerGroupsForNormalization ?? storeLayerGroups;

    const currentKnobPositions = useKnobItemStore.getState().positions;
    const grouped = applyGroupIdToSelectedElements({
      mode: selectedKeyType,
      selectedElements: selectedForUpdate,
      keyPositions: pos,
      statPositions: currentStatPositions,
      graphPositions: currentGraphPositions,
      knobPositions: currentKnobPositions,
      targetGroupId,
    });

    const normalized = normalizeLayerGroupsForMode({
      mode: selectedKeyType,
      keyPositions: grouped.keyPositions,
      statPositions: grouped.statPositions,
      graphPositions: grouped.graphPositions,
      knobPositions: grouped.knobPositions,
      layerGroups: layerGroupsForNormalization,
    });

    const shouldPersistGroups =
      normalized.groupsChanged ||
      options?.layerGroupsForNormalization !== undefined;
    const hasChange =
      grouped.changed || normalized.positionsChanged || shouldPersistGroups;
    if (!hasChange) return false;

    if (!options?.skipHistory) {
      useHistoryStore.getState().pushState({
        keyMappings: km,
        positions: pos,
        statPositions: currentStatPositions,
        graphPositions: currentGraphPositions,
        pluginElements: currentPluginElements,
        layerGroups: historyLayerGroups,
      });
    }

    useKeyStore.getState().setPositions(normalized.keyPositions);
    useStatItemStore.getState().setPositions(normalized.statPositions);
    useGraphItemStore.getState().setPositions(normalized.graphPositions);
    useKnobItemStore.getState().setPositions(normalized.knobPositions);

    if (shouldPersistGroups) {
      useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
    }

    const changes: EditorPatchV1 = { schemaVersion: 1 };
    if (hasChanged(pos, normalized.keyPositions)) {
      changes.keyPositions = normalized.keyPositions;
    }
    if (hasChanged(currentStatPositions, normalized.statPositions)) {
      changes.statPositions = normalized.statPositions;
    }
    if (hasChanged(currentGraphPositions, normalized.graphPositions)) {
      changes.graphPositions = normalized.graphPositions;
    }
    if (hasChanged(currentKnobPositions, normalized.knobPositions)) {
      changes.knobPositions = normalized.knobPositions;
    }
    if (hasChanged(storeLayerGroups, normalized.layerGroups)) {
      changes.layerGroups = normalized.layerGroups;
    }

    await editorCoordinator.commitPatch(changes);

    return true;
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 컨텍스트 메뉴 아이템 (동적)
  // ──────────────────────────────────────────────────────────────────────────

  const contextMenuItems: ListItem[] = (() => {
    if (contextMenuGroupId) {
      return [
        {
          id: 'renameGroup',
          label: t('contextMenu.renameGroup') || 'Rename',
        },
        { id: 'ungroup', label: t('contextMenu.ungroup') || 'Ungroup' },
      ];
    }

    const selectedElements = useGridSelectionStore.getState().selectedElements;
    const items: ListItem[] = [
      { id: 'rename', label: t('contextMenu.rename') || 'Rename' },
    ];

    if (selectedElements.length >= 2 && !contextMenuItem?.groupId) {
      items.push({
        id: 'groupSelected',
        label: t('contextMenu.groupSelected') || 'Group',
      });
    }

    if (contextMenuItem?.groupId) {
      items.push({
        id: 'removeFromGroup',
        label: t('contextMenu.removeFromGroup') || 'Remove from Group',
      });
    }

    items.push({
      id: 'delete',
      label: t('propertiesPanel.delete') || 'Delete',
    });

    return items;
  })();

  // ──────────────────────────────────────────────────────────────────────────
  // 우클릭 핸들러
  // ──────────────────────────────────────────────────────────────────────────

  const handleContextMenu = (
    e: React.MouseEvent,
    item: LayerItem,
    index: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    clearPendingDeselect();
    onSelectionFromPanel?.();

    const selectedElements = useGridSelectionStore.getState().selectedElements;
    const isSelected = selectedElements.some((el) => el.id === item.id);

    if (!isSelected) {
      const { clearSelection, toggleSelection } =
        useGridSelectionStore.getState();
      clearSelection();
      if (item.type === 'key' && item.index !== undefined) {
        toggleSelection({ type: 'key', id: item.id, index: item.index });
      } else if (item.type === 'stat' && item.index !== undefined) {
        toggleSelection({ type: 'stat', id: item.id, index: item.index });
      } else if (item.type === 'graph' && item.index !== undefined) {
        toggleSelection({ type: 'graph', id: item.id, index: item.index });
      } else if (item.type === 'knob' && item.index !== undefined) {
        toggleSelection({ type: 'knob', id: item.id, index: item.index });
      } else if (item.type === 'plugin') {
        toggleSelection({ type: 'plugin', id: item.id });
      }
      setLastClickedIndex(index);
      const displayIdx = displayItemsRef.current.findIndex(
        (di) => di.displayType === 'layer' && di.item.id === item.id,
      );
      setLastClickedDisplayIndex(displayIdx !== -1 ? displayIdx : null);
    }

    setContextMenuItem(item);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);
  };

  // 그룹 헤더 우클릭
  const handleGroupHeaderContextMenu = (
    e: React.MouseEvent,
    groupId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    clearPendingDeselect();
    setContextMenuGroupId(groupId);
    setContextMenuItem(null);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 컨텍스트 메뉴 선택 핸들러
  // ──────────────────────────────────────────────────────────────────────────

  const handleContextMenuSelect = async (itemId: string) => {
    // 그룹 헤더 컨텍스트 메뉴 처리
    if (contextMenuGroupId) {
      if (itemId === 'renameGroup') {
        const groupDef = layerGroupsForMode.find(
          (g) => g.id === contextMenuGroupId,
        );
        setRenamingItemId(`group:${contextMenuGroupId}`);
        setRenameValue(groupDef?.name || '');
        setContextMenuOpen(false);
        setContextMenuGroupId(null);
        requestAnimationFrame(() => {
          renameInputRef.current?.focus();
          renameInputRef.current?.select();
        });
        return;
      }
      if (itemId === 'ungroup') {
        const children = layerItems.filter(
          (item) => item.groupId === contextMenuGroupId,
        );
        const elements: SelectedElement[] = children.map((child) => ({
          type: child.type,
          id: child.id,
          index: child.index,
        }));
        await setGroupIdOnSelected(undefined, elements);

        onSelectionFromPanel?.();
        useGridSelectionStore.getState().clearSelection();
        setContextMenuOpen(false);
        setContextMenuGroupId(null);
        return;
      }
      setContextMenuOpen(false);
      setContextMenuGroupId(null);
      return;
    }

    if (itemId === 'rename') {
      if (contextMenuItem) {
        setRenamingItemId(contextMenuItem.id);
        setRenameValue(contextMenuItem.name);
        setContextMenuOpen(false);
        requestAnimationFrame(() => {
          renameInputRef.current?.focus();
          renameInputRef.current?.select();
        });
      }
      return;
    }

    // 선택 항목 그룹화
    if (itemId === 'groupSelected') {
      const selectedElements =
        useGridSelectionStore.getState().selectedElements;
      if (selectedElements.length < 2) return;

      const currentGroups = useLayerGroupStore.getState().layerGroups;
      const modeGroups = currentGroups[selectedKeyType] || [];
      const keyPos = useKeyStore.getState().positions;
      const statPos = useStatItemStore.getState().positions;
      const graphPos = useGraphItemStore.getState().positions;
      const knobPos = useKnobItemStore.getState().positions;

      const singleGroupId = resolveSingleGroupIdFromSelection(
        selectedKeyType,
        selectedElements,
        keyPos,
        statPos,
        graphPos,
        knobPos,
      );

      if (singleGroupId) {
        await setGroupIdOnSelected(singleGroupId);
      } else {
        const groupId = crypto.randomUUID();
        const groupName = buildNextLayerGroupName(
          t('layerGroup.newGroup') || 'New Group',
          modeGroups,
        );
        const nextGroups: LayerGroups = {
          ...currentGroups,
          [selectedKeyType]: [...modeGroups, { id: groupId, name: groupName }],
        };

        await setGroupIdOnSelected(groupId, undefined, {
          historyLayerGroups: currentGroups,
          layerGroupsForNormalization: nextGroups,
        });
      }

      setContextMenuOpen(false);
      return;
    }

    // 그룹에서 제거
    if (itemId === 'removeFromGroup') {
      if (contextMenuItem) {
        const elements: SelectedElement[] = [
          {
            type: contextMenuItem.type,
            id: contextMenuItem.id,
            index: contextMenuItem.index,
          },
        ];
        await setGroupIdOnSelected(undefined, elements);
        onSelectionFromPanel?.();
        useGridSelectionStore.getState().clearSelection();
      }
      setContextMenuOpen(false);
      return;
    }

    if (itemId === 'delete') {
      const selectedElements =
        useGridSelectionStore.getState().selectedElements;
      if (selectedElements.length === 0) return;

      const keysToDelete = selectedElements
        .filter((el) => el.type === 'key' && el.index !== undefined)
        .map((el) => el.index as number);

      const statsToDelete = selectedElements
        .filter((el) => el.type === 'stat' && el.index !== undefined)
        .map((el) => el.index as number);

      const graphsToDelete = selectedElements
        .filter((el) => el.type === 'graph' && el.index !== undefined)
        .map((el) => el.index as number);

      const knobsToDelete = selectedElements
        .filter((el) => el.type === 'knob' && el.index !== undefined)
        .map((el) => el.index as number);

      const pluginsToDelete = selectedElements
        .filter((el) => el.type === 'plugin')
        .map((el) => el.id);

      // 히스토리 저장
      if (
        keysToDelete.length > 0 ||
        statsToDelete.length > 0 ||
        graphsToDelete.length > 0 ||
        knobsToDelete.length > 0 ||
        pluginsToDelete.length > 0
      ) {
        const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
        pushCurrentStateToHistory(currentLayerGroups);
      }

      // 선택 해제
      onSelectionFromPanel?.();
      useGridSelectionStore.getState().clearSelection();

      const { keyMappings: currentMappings, positions: currentKeyPositions } =
        useKeyStore.getState();
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const currentKnobPositions = useKnobItemStore.getState().positions;
      const currentLayerGroups = useLayerGroupStore.getState().layerGroups;

      const keyDeleteSet = new Set(keysToDelete);
      const statDeleteSet = new Set(statsToDelete);
      const graphDeleteSet = new Set(graphsToDelete);
      const knobDeleteSet = new Set(knobsToDelete);

      const nextMappings =
        keysToDelete.length > 0
          ? {
              ...currentMappings,
              [selectedKeyType]: (
                currentMappings[selectedKeyType] || []
              ).filter((_, index) => !keyDeleteSet.has(index)),
            }
          : currentMappings;
      const nextKeyPositions =
        keysToDelete.length > 0
          ? {
              ...currentKeyPositions,
              [selectedKeyType]: (
                currentKeyPositions[selectedKeyType] || []
              ).filter((_, index) => !keyDeleteSet.has(index)),
            }
          : currentKeyPositions;
      const nextStatPositions =
        statsToDelete.length > 0
          ? {
              ...currentStatPositions,
              [selectedKeyType]: (
                currentStatPositions[selectedKeyType] || []
              ).filter((_, index) => !statDeleteSet.has(index)),
            }
          : currentStatPositions;
      const nextGraphPositions =
        graphsToDelete.length > 0
          ? {
              ...currentGraphPositions,
              [selectedKeyType]: (
                currentGraphPositions[selectedKeyType] || []
              ).filter((_, index) => !graphDeleteSet.has(index)),
            }
          : currentGraphPositions;
      const nextKnobPositions =
        knobsToDelete.length > 0
          ? {
              ...currentKnobPositions,
              [selectedKeyType]: (
                currentKnobPositions[selectedKeyType] || []
              ).filter((_, index) => !knobDeleteSet.has(index)),
            }
          : currentKnobPositions;

      // 플러그인 삭제
      if (pluginsToDelete.length > 0) {
        const currentElements =
          usePluginDisplayElementStore.getState().elements;
        const deleteSet = new Set(pluginsToDelete);
        const newElements = currentElements.filter(
          (el) => !deleteSet.has(el.fullId),
        );
        usePluginDisplayElementStore.getState().setElements(newElements);
      }

      const normalized = normalizeLayerGroupsForMode({
        mode: selectedKeyType,
        keyPositions: nextKeyPositions,
        statPositions: nextStatPositions,
        graphPositions: nextGraphPositions,
        knobPositions: nextKnobPositions,
        layerGroups: currentLayerGroups,
      });

      if (hasChanged(currentMappings, nextMappings)) {
        useKeyStore
          .getState()
          .setKeyMappingsAndPositions(nextMappings, normalized.keyPositions);
      } else if (hasChanged(currentKeyPositions, normalized.keyPositions)) {
        useKeyStore.getState().setPositions(normalized.keyPositions);
      }
      if (hasChanged(currentStatPositions, normalized.statPositions)) {
        useStatItemStore.getState().setPositions(normalized.statPositions);
      }
      if (hasChanged(currentGraphPositions, normalized.graphPositions)) {
        useGraphItemStore.getState().setPositions(normalized.graphPositions);
      }
      if (hasChanged(currentKnobPositions, normalized.knobPositions)) {
        useKnobItemStore.getState().setPositions(normalized.knobPositions);
      }
      if (hasChanged(currentLayerGroups, normalized.layerGroups)) {
        useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
      }

      const changes: EditorPatchV1 = { schemaVersion: 1 };
      if (hasChanged(currentMappings, nextMappings)) {
        changes.keys = nextMappings;
        changes.keyPositions = normalized.keyPositions;
      } else if (hasChanged(currentKeyPositions, normalized.keyPositions)) {
        changes.keyPositions = normalized.keyPositions;
      }
      if (hasChanged(currentStatPositions, normalized.statPositions)) {
        changes.statPositions = normalized.statPositions;
      }
      if (hasChanged(currentGraphPositions, normalized.graphPositions)) {
        changes.graphPositions = normalized.graphPositions;
      }
      if (hasChanged(currentKnobPositions, normalized.knobPositions)) {
        changes.knobPositions = normalized.knobPositions;
      }
      if (hasChanged(currentLayerGroups, normalized.layerGroups)) {
        changes.layerGroups = normalized.layerGroups;
      }

      if (Object.keys(changes).length > 1) {
        try {
          await editorCoordinator.commitPatch(changes);
        } catch (error) {
          console.error('Failed to delete layers', error);
        }
      }
    }

    setContextMenuOpen(false);
  };

  return {
    // 컨텍스트 메뉴 상태
    contextMenuOpen,
    contextMenuPosition,
    contextMenuItems,
    setContextMenuOpen,
    setContextMenuGroupId,

    // 이름 변경 상태
    renamingItemId,
    renameValue,
    setRenameValue,
    renameInputRef,
    renameCancelledRef,
    setRenamingItemId,

    // 핸들러
    handleToggleVisibility,
    handleToggleGroupVisibility,
    handleLayerRenameCommit,
    handleGroupRenameCommit,
    handleContextMenu,
    handleGroupHeaderContextMenu,
    handleContextMenuSelect,
    setGroupIdOnSelected,
  };
}
