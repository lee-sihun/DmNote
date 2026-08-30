/**
 * 그룹/언그룹 공용 액션
 * Grid.tsx, useGridKeyboard.ts, LayerTabContent.tsx에서 공유
 */

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  selectPropertyPanelPluginElements,
  usePluginDisplayElementStore,
} from '@stores/plugin/usePluginDisplayElementStore';
import { setMixedElementGroups } from '@src/renderer/editor/runtime/mixedElementGroups';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { buildNextLayerGroupName } from '@utils/layerGroupUtils';
import type { EditorElementGroupTargetV1 } from '@src/types/editor';

interface SplitGroupTargets {
  native: EditorElementGroupTargetV1[];
  // 플러그인은 fullId 대상 - 소속 저장은 pluginChanges가 운반
  plugin: string[];
}

// 대상 분리만 담당 - 소실·모드 이탈 검증은 커밋 진입점이 fail-closed로 수행
const splitGroupTargets = (
  elements: readonly SelectedElement[],
): SplitGroupTargets | null => {
  const native = elements.flatMap((element) =>
    element.type === 'key' ||
    element.type === 'stat' ||
    element.type === 'graph' ||
    element.type === 'knob' ||
    element.type === 'sprite'
      ? [{ elementType: element.type, id: element.id }]
      : [],
  );
  const plugin = elements
    .filter((element) => element.type === 'plugin')
    .map((element) => element.id);
  if (
    !native.every(({ id }) => isNativeElementId(id)) ||
    new Set(native.map(({ id }) => id)).size !== native.length ||
    new Set(plugin).size !== plugin.length
  ) {
    return null;
  }
  return { native, plugin };
};

const currentNativeGroupId = (
  mode: string,
  target: EditorElementGroupTargetV1,
): string | undefined => {
  const locator = resolveElementById(target.elementType, target.id);
  if (!locator || locator.mode !== mode) return undefined;
  if (target.elementType === 'sprite') {
    return (
      useSpriteStore.getState().positions[mode]?.[locator.index]?.groupId ??
      undefined
    );
  }
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

const currentPluginGroupId = (
  mode: string,
  fullId: string,
): string | undefined => {
  // 패널 창의 elements는 항상 비어 있으므로 창별 미러 셀렉터를 경유한다
  const element = selectPropertyPanelPluginElements(
    usePluginDisplayElementStore.getState(),
  ).find((candidate) => candidate.fullId === fullId);
  if (!element?.groupId) return undefined;
  // 현재 모드에 def가 있는 groupId만 유효 (읽기 가드와 동일 규칙)
  return (useLayerGroupStore.getState().layerGroups[mode] ?? []).some(
    (group) => group.id === element.groupId,
  )
    ? element.groupId
    : undefined;
};

const dispatchGroupChange = (
  mode: string,
  targets: SplitGroupTargets,
  targetGroup:
    | { kind: 'existing'; id: string }
    | { kind: 'create'; id: string; name: string }
    | null,
): Promise<boolean> =>
  setMixedElementGroups(mode, targets.native, targets.plugin, targetGroup);

/**
 * 선택된 요소들을 그룹화 (native+plugin 혼합 지원)
 * @returns 변경이 있었는지 여부
 */
export async function groupSelectedElements(
  selectedKeyType: string,
  selectedElements: SelectedElement[],
  newGroupLabel: string,
): Promise<boolean> {
  if (selectedElements.length === 0) return false;

  const targets = splitGroupTargets(selectedElements);
  if (!targets || (targets.native.length === 0 && targets.plugin.length === 0))
    return false;
  const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
  const groupIds = new Set(
    [
      ...targets.native.map((target) =>
        currentNativeGroupId(selectedKeyType, target),
      ),
      ...targets.plugin.map((fullId) =>
        currentPluginGroupId(selectedKeyType, fullId),
      ),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0),
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
  return dispatchGroupChange(selectedKeyType, targets, targetGroup);
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

  const targets = splitGroupTargets(selectedElements);
  if (!targets || (targets.native.length === 0 && targets.plugin.length === 0))
    return false;
  return dispatchGroupChange(selectedKeyType, targets, null);
}
