/**
 * 레이어 패널 액션 훅
 * 가시성 토글, 이름 변경, 컨텍스트 메뉴, 삭제, 그룹 연산 등
 */

import { setPluginElementsHidden } from '@plugins/runtime/displayElement/pluginElementActions';
import { useState, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { buildNextLayerGroupName } from '@utils/layerGroupUtils';
import type { LayerGroups } from '@src/types/layerGroups';
import type { LayerGroupDef } from '@src/types/layerGroups';
import type { ListItem } from '@components/main/Modal/ListPopup';
import type { LayerItem, DisplayItem } from '../types';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { deleteFrozenSelection } from '@src/renderer/editor/runtime/deleteFrozenSelection';
import { reportElementOpSkipped } from '@src/renderer/editor/runtime/elementIntent';
import {
  patchElementHiddenById,
  patchElementLayerNameById,
  renameLayerGroupById,
} from '@src/renderer/editor/runtime/elementOps';
import { layerItemToSelectedElement } from './layerPanelModel';
import {
  setMixedElementGroups,
  setMixedLayerGroupHidden,
} from '@src/renderer/editor/runtime/mixedElementGroups';
import {
  selectPropertyPanelPluginElements,
  usePluginDisplayElementStore,
} from '@stores/plugin/usePluginDisplayElementStore';
import {
  resolveElementById,
  type NativeElementType,
} from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import type {
  EditorElementGroupTargetV1,
  EditorTargetLayerGroupV1,
} from '@src/types/editor';

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

const stableSelectionGroupId = (
  mode: string,
  elements: readonly SelectedElement[],
): { stable: boolean; groupId?: string } => {
  const native = elements.filter(
    (element): element is SelectedElement & { type: NativeElementType } =>
      element.type === 'key' ||
      element.type === 'stat' ||
      element.type === 'graph' ||
      element.type === 'knob' ||
      element.type === 'sprite',
  );
  const plugin = elements.filter((element) => element.type === 'plugin');
  if (
    (native.length === 0 && plugin.length === 0) ||
    native.some(({ id }) => !isNativeElementId(id))
  ) {
    return { stable: false };
  }
  const modeGroupIds = new Set(
    (useLayerGroupStore.getState().layerGroups[mode] ?? []).map(
      (group) => group.id,
    ),
  );
  const groupIds = new Set<string>();
  for (const element of native) {
    const locator = resolveElementById(element.type, element.id);
    if (!locator || locator.mode !== mode) return { stable: true };
    if (element.type === 'sprite') {
      const groupId =
        useSpriteStore.getState().positions[mode]?.[locator.index]?.groupId;
      if (groupId) groupIds.add(groupId);
      continue;
    }
    const record =
      element.type === 'key'
        ? useKeyStore.getState().canonicalPositions
        : element.type === 'stat'
        ? useStatItemStore.getState().positions
        : element.type === 'graph'
        ? useGraphItemStore.getState().positions
        : useKnobItemStore.getState().positions;
    const groupId = record[mode]?.[locator.index]?.groupId;
    if (groupId) groupIds.add(groupId);
  }
  // 플러그인 소속도 단일 그룹 판정에 포함 - 모드 def가 있는 groupId만 유효.
  // 패널 창의 elements는 항상 비어 있으므로 창별 미러 셀렉터를 경유한다
  const pluginElements = selectPropertyPanelPluginElements(
    usePluginDisplayElementStore.getState(),
  );
  for (const element of plugin) {
    const groupId = pluginElements.find(
      (candidate) => candidate.fullId === element.id,
    )?.groupId;
    if (groupId && modeGroupIds.has(groupId)) groupIds.add(groupId);
  }
  return groupIds.size === 1
    ? { stable: true, groupId: [...groupIds][0] }
    : { stable: true };
};

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

    if (item.type !== 'plugin' && isNativeElementId(item.id)) {
      try {
        const target = {
          elementType: item.type,
          id: item.id,
          hidden: !item.hidden,
        };
        await patchElementHiddenById(
          target.elementType,
          target.id,
          target.hidden,
        );
      } catch (error) {
        console.error(`Failed to toggle ${item.type} visibility`, error);
      }
      return;
    }

    if (item.type === 'plugin') {
      const applied = await setPluginElementsHidden([
        { fullId: item.id, hidden: !item.hidden },
      ]);
      if (!applied) reportElementOpSkipped('panel plugin visibility toggle');
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
    const nativeChildren = children.filter((child) => child.type !== 'plugin');

    try {
      if (nativeChildren.some((child) => !isNativeElementId(child.id))) {
        return;
      }
      // 혼합·plugin-only 분기는 mixed 진입점이 판정 (native-only는 위임)
      await setMixedLayerGroupHidden(selectedKeyType, groupId, newHidden);
    } catch (error) {
      console.error('Failed to toggle group visibility', error);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 레이어 이름 변경 커밋
  // ──────────────────────────────────────────────────────────────────────────

  const handleLayerRenameCommit = async (item: LayerItem, value: string) => {
    setRenamingItemId(null);
    const trimmed = value.trim();
    const newLayerName = trimmed === '' ? null : trimmed;

    if (item.type !== 'plugin' && isNativeElementId(item.id)) {
      try {
        const target = {
          elementType: item.type,
          id: item.id,
          patch: { property: 'layerName', value: newLayerName },
        } as const;
        await patchElementLayerNameById(
          target.elementType,
          target.id,
          target.patch.value,
        );
      } catch (error) {
        console.error(`Failed to rename ${item.type} layer`, error);
      }
      return;
    }

    // canonical ID가 없는 native layer는 저장 경계에 진입시키지 않는다
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 그룹 이름 변경 커밋
  // ──────────────────────────────────────────────────────────────────────────

  const handleGroupRenameCommit = async (groupId: string, value: string) => {
    setRenamingItemId(null);
    const trimmed = value.trim();
    if (trimmed === '') return;

    const currentGroups = useLayerGroupStore.getState().layerGroups;
    const currentModeGroups = currentGroups[selectedKeyType] || [];
    const currentGroup = currentModeGroups.find(
      (group) => group.id === groupId,
    );
    if (!currentGroup || currentGroup.name === trimmed) return;

    try {
      await renameLayerGroupById(selectedKeyType, groupId, trimmed);
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
      historyLayerGroups?: LayerGroups;
      layerGroupsForNormalization?: LayerGroups;
    },
  ) => {
    const selectedForUpdate =
      elementsOverride ?? useGridSelectionStore.getState().selectedElements;
    if (selectedForUpdate.length === 0) return false;

    const nativeTargets = selectedForUpdate.flatMap(
      (element): EditorElementGroupTargetV1[] =>
        element.type === 'key' ||
        element.type === 'stat' ||
        element.type === 'graph' ||
        element.type === 'knob' ||
        element.type === 'sprite'
          ? [{ elementType: element.type, id: element.id }]
          : [],
    );
    const pluginTargets = selectedForUpdate
      .filter((element) => element.type === 'plugin')
      .map((element) => element.id);
    if (nativeTargets.length === 0 && pluginTargets.length === 0) return false;
    const stableTargets =
      nativeTargets.every(({ id }) => isNativeElementId(id)) &&
      new Set(nativeTargets.map(({ id }) => id)).size ===
        nativeTargets.length &&
      new Set(pluginTargets).size === pluginTargets.length;
    if (stableTargets) {
      let targetGroup: EditorTargetLayerGroupV1 | null = null;
      if (targetGroupId) {
        const currentGroups = useLayerGroupStore.getState().layerGroups;
        const currentModeGroups = currentGroups[selectedKeyType] ?? [];
        const creatingGroup = options?.layerGroupsForNormalization?.[
          selectedKeyType
        ]?.find(
          (group) =>
            group.id === targetGroupId &&
            !currentModeGroups.some((current) => current.id === group.id),
        );
        targetGroup = creatingGroup
          ? { kind: 'create', id: creatingGroup.id, name: creatingGroup.name }
          : { kind: 'existing', id: targetGroupId };
      }
      return setMixedElementGroups(
        selectedKeyType,
        nativeTargets,
        pluginTargets,
        targetGroup,
      );
    }
    return false;
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
      toggleSelection(layerItemToSelectedElement(item));
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
      // 빈 선택이어도 메뉴는 닫는다
      if (selectedElements.length > 0) {
        onSelectionFromPanel?.();
        await deleteFrozenSelection(selectedElements);
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
