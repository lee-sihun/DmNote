/**
 * 그룹/언그룹 공용 액션
 * Grid.tsx, useGridKeyboard.ts, LayerTabContent.tsx에서 공유
 */

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { setElementGroupsByTargets } from '@src/renderer/editor/runtime/elementOps';
import { setElementGroupsViaAuthority } from '@plugins/rpc/pluginElementActions';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { buildNextLayerGroupName } from '@utils/layerGroupUtils';
import type { EditorElementGroupTargetV1 } from '@src/types/editor';

const stableGroupTargets = (
  elements: readonly SelectedElement[],
): EditorElementGroupTargetV1[] | null => {
  const targets = elements.flatMap((element) =>
    element.type === 'key' ||
    element.type === 'stat' ||
    element.type === 'graph' ||
    element.type === 'knob'
      ? [{ elementType: element.type, id: element.id }]
      : [],
  );
  if (targets.length === 0) return [];
  return targets.every(({ id }) => isNativeElementId(id)) &&
    new Set(targets.map(({ id }) => id)).size === targets.length
    ? targets
    : null;
};

const currentGroupId = (
  mode: string,
  target: EditorElementGroupTargetV1,
): string | undefined => {
  const locator = resolveElementById(target.elementType, target.id);
  if (!locator || locator.mode !== mode) return undefined;
  const record =
    target.elementType === 'key'
      ? useKeyStore.getState().canonicalPositions
      : target.elementType === 'stat'
      ? useStatItemStore.getState().positions
      : target.elementType === 'graph'
      ? useGraphItemStore.getState().positions
      : useKnobItemStore.getState().positions;
  return record[mode]?.[locator.index]?.groupId;
};

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

  const stableTargets = stableGroupTargets(selectedElements);
  if (stableTargets?.length === 0) return false;
  if (!stableTargets) return false;
  const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
  const groupIds = new Set(
    stableTargets
      .map((target) => currentGroupId(selectedKeyType, target))
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const existingId = groupIds.size === 1 ? [...groupIds][0] : undefined;
  const targetGroup = existingId
    ? ({ kind: 'existing', id: existingId } as const)
    : ({
        kind: 'create',
        id: crypto.randomUUID(),
        name: buildNextLayerGroupName(
          newGroupLabel,
          currentLayerGroups[selectedKeyType] ?? [],
        ),
      } as const);
  return window.__dmn_window_type === 'panel'
    ? setElementGroupsViaAuthority(selectedKeyType, stableTargets, targetGroup)
    : setElementGroupsByTargets(selectedKeyType, stableTargets, targetGroup);
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

  const stableTargets = stableGroupTargets(selectedElements);
  if (stableTargets?.length === 0) return false;
  if (!stableTargets) return false;
  return window.__dmn_window_type === 'panel'
    ? setElementGroupsViaAuthority(selectedKeyType, stableTargets, null)
    : setElementGroupsByTargets(selectedKeyType, stableTargets, null);
}
