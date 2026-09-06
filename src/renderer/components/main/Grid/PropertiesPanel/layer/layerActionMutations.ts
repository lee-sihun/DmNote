import { setPluginElementsHidden } from '@plugins/runtime/displayElement/pluginElementActions';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { LayerGroups } from '@src/types/layerGroups';
import type { LayerItem } from '../types';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { reportElementOpSkipped } from '@src/renderer/editor/runtime/intent/elementIntent';
import {
  patchElementHiddenById,
  patchElementLayerNameById,
  renameLayerGroupById,
} from '@src/renderer/editor/runtime/operations/elementOps';
import {
  setMixedElementGroups,
  setMixedLayerGroupHidden,
} from '@src/renderer/editor/runtime/intent/mixedElementGroups';
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

export const stableSelectionGroupId = (
  mode: string,
  elements: readonly SelectedElement[],
): { stable: boolean; groupId?: string } => {
  const native = elements.filter(
    (element): element is SelectedElement & { type: NativeElementType } =>
      element.type === 'key' ||
      element.type === 'stat' ||
      element.type === 'graph' ||
      element.type === 'knob',
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

interface CreateLayerActionMutationsOptions {
  selectedKeyType: string;
  layerItems: LayerItem[];
  onSelectionFromPanel?: () => void;
  clearPendingDeselect: () => void;
  setRenamingItemId: (id: string | null) => void;
}

export const createLayerActionMutations = ({
  selectedKeyType,
  layerItems,
  onSelectionFromPanel,
  clearPendingDeselect,
  setRenamingItemId,
}: CreateLayerActionMutationsOptions) => {
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
        element.type === 'knob'
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

  return {
    handleToggleVisibility,
    handleToggleGroupVisibility,
    handleLayerRenameCommit,
    handleGroupRenameCommit,
    setGroupIdOnSelected,
  };
};
