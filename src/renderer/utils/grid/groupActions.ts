/**
 * 그룹/언그룹 공용 액션
 * Grid.tsx, useGridKeyboard.ts, LayerTabContent.tsx에서 공유
 */

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import {
  applyGroupIdToSelectedElements,
  buildNextLayerGroupName,
  normalizeLayerGroupsForMode,
  resolveSingleGroupIdFromSelection,
} from '@utils/layerGroupUtils';

/**
 * 선택된 요소들을 그룹화
 * @returns 변경이 있었는지 여부
 */
export async function groupSelectedElements(
  selectedKeyType: string,
  selectedElements: SelectedElement[],
  newGroupLabel: string,
): Promise<boolean> {
  if (selectedElements.length === 0) return false;

  const { keyMappings, positions } = useKeyStore.getState();
  const statPos = useStatItemStore.getState().positions;
  const graphPos = useGraphItemStore.getState().positions;
  const knobPos = useKnobItemStore.getState().positions;
  const pluginEls = usePluginDisplayElementStore.getState().elements;
  const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
  const modeGroups = currentLayerGroups[selectedKeyType] || [];

  const singleGroupId = resolveSingleGroupIdFromSelection(
    selectedKeyType,
    selectedElements,
    positions,
    statPos,
    graphPos,
    knobPos,
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
        { id: targetGroupId, name: groupName },
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
    knobPositions: knobPos,
    targetGroupId,
  });

  const normalized = normalizeLayerGroupsForMode({
    mode: selectedKeyType,
    keyPositions: grouped.keyPositions,
    statPositions: grouped.statPositions,
    graphPositions: grouped.graphPositions,
    knobPositions: grouped.knobPositions,
    layerGroups: nextLayerGroups,
  });

  const hasChange =
    grouped.changed ||
    normalized.positionsChanged ||
    createdGroup ||
    normalized.groupsChanged;
  if (!hasChange) return false;

  // 히스토리 저장
  useHistoryStore.getState().pushState({
    keyMappings,
    positions,
    statPositions: statPos,
    graphPositions: graphPos,
    pluginElements: pluginEls,
    layerGroups: currentLayerGroups,
  });

  // 스토어 반영
  useKeyStore.getState().setPositions(normalized.keyPositions);
  useStatItemStore.getState().setPositions(normalized.statPositions);
  useGraphItemStore.getState().setPositions(normalized.graphPositions);
  useKnobItemStore.getState().setPositions(normalized.knobPositions);
  if (createdGroup || normalized.groupsChanged) {
    useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
  }

  // 참조와 그룹 정의를 같은 revision으로 저장
  await editorCoordinator
    .commitPatch({
      schemaVersion: 1,
      keyPositions: normalized.keyPositions,
      statPositions: normalized.statPositions,
      graphPositions: normalized.graphPositions,
      knobPositions: normalized.knobPositions,
      layerGroups: normalized.layerGroups,
    })
    .catch(() => {});

  return true;
}

/**
 * 선택된 요소들의 그룹 해제
 * @returns 변경이 있었는지 여부
 */
export async function ungroupSelectedElements(
  selectedKeyType: string,
  selectedElements: SelectedElement[],
): Promise<boolean> {
  if (selectedElements.length === 0) return false;

  const { keyMappings, positions } = useKeyStore.getState();
  const statPos = useStatItemStore.getState().positions;
  const graphPos = useGraphItemStore.getState().positions;
  const knobPos = useKnobItemStore.getState().positions;
  const pluginEls = usePluginDisplayElementStore.getState().elements;
  const currentLayerGroups = useLayerGroupStore.getState().layerGroups;

  const ungrouped = applyGroupIdToSelectedElements({
    mode: selectedKeyType,
    selectedElements,
    keyPositions: positions,
    statPositions: statPos,
    graphPositions: graphPos,
    knobPositions: knobPos,
    targetGroupId: undefined,
  });

  const normalized = normalizeLayerGroupsForMode({
    mode: selectedKeyType,
    keyPositions: ungrouped.keyPositions,
    statPositions: ungrouped.statPositions,
    graphPositions: ungrouped.graphPositions,
    knobPositions: ungrouped.knobPositions,
    layerGroups: currentLayerGroups,
  });

  const hasChange = ungrouped.changed || normalized.groupsChanged;
  if (!hasChange) return false;

  // 히스토리 저장
  useHistoryStore.getState().pushState({
    keyMappings,
    positions,
    statPositions: statPos,
    graphPositions: graphPos,
    pluginElements: pluginEls,
    layerGroups: currentLayerGroups,
  });

  // 스토어 반영
  useKeyStore.getState().setPositions(normalized.keyPositions);
  useStatItemStore.getState().setPositions(normalized.statPositions);
  useGraphItemStore.getState().setPositions(normalized.graphPositions);
  useKnobItemStore.getState().setPositions(normalized.knobPositions);
  if (normalized.groupsChanged) {
    useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
  }

  await editorCoordinator
    .commitPatch({
      schemaVersion: 1,
      keyPositions: normalized.keyPositions,
      statPositions: normalized.statPositions,
      graphPositions: normalized.graphPositions,
      knobPositions: normalized.knobPositions,
      layerGroups: normalized.layerGroups,
    })
    .catch(() => {});

  return true;
}
