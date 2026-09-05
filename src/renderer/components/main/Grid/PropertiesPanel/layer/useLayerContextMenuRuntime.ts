import { useRef, useState } from 'react';
import type React from 'react';

import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { buildNextLayerGroupName } from '@utils/layerGroupUtils';
import type { LayerGroups, LayerGroupDef } from '@src/types/layerGroups';
import type { ListItem } from '@components/main/Modal/ListPopup';
import type { DisplayItem, LayerItem } from '../types';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { deleteFrozenSelection } from '@src/renderer/editor/runtime/intent/deleteFrozenSelection';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import {
  createLayerActionMutations,
  stableSelectionGroupId,
} from './layerActionMutations';

export interface UseLayerContextMenuRuntimeParams {
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

export const useLayerContextMenuRuntime = ({
  selectedKeyType,
  layerItems,
  layerGroupsForMode,
  onSelectionFromPanel,
  clearPendingDeselect,
  displayItemsRef,
  setLastClickedIndex,
  setLastClickedDisplayIndex,
  t,
}: UseLayerContextMenuRuntimeParams) => {
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

  const {
    handleToggleVisibility,
    handleToggleGroupVisibility,
    handleLayerRenameCommit,
    handleGroupRenameCommit,
    setGroupIdOnSelected,
  } = createLayerActionMutations({
    selectedKeyType,
    layerItems,
    onSelectionFromPanel,
    clearPendingDeselect,
    setRenamingItemId,
  });

  // 컨텍스트 메뉴 아이템 (동적)
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
        const elements: SelectedElement[] = children.map((child) =>
          child.type === 'plugin'
            ? { type: 'plugin', id: child.id }
            : {
                type: child.type,
                id: child.id,
                ...(child.index === undefined ? {} : { index: child.index }),
              },
        );
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
      const stableGroup = stableSelectionGroupId(
        selectedKeyType,
        selectedElements,
      );
      if (!stableGroup.stable) return;
      const singleGroupId = stableGroup.groupId;

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
        const elements: SelectedElement[] =
          contextMenuItem.type === 'plugin'
            ? [{ type: 'plugin', id: contextMenuItem.id }]
            : isNativeElementId(contextMenuItem.id)
            ? [
                {
                  type: contextMenuItem.type,
                  id: contextMenuItem.id,
                  index: contextMenuItem.index,
                },
              ]
            : [];
        if (elements.length > 0) {
          await setGroupIdOnSelected(undefined, elements);
          onSelectionFromPanel?.();
          useGridSelectionStore.getState().clearSelection();
        }
      }
      setContextMenuOpen(false);
      return;
    }

    if (itemId === 'delete') {
      const selectedElements =
        useGridSelectionStore.getState().selectedElements;
      if (selectedElements.length === 0) return;
      onSelectionFromPanel?.();
      await deleteFrozenSelection(selectedElements);
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
};
