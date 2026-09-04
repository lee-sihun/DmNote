import { useSyncExternalStore } from 'react';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  selectPropertyPanelPluginElements,
  usePluginDisplayElementStore,
} from '@stores/plugin/usePluginDisplayElementStore';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import {
  composePreviewPositions,
  getPreviewOverlayVersion,
  subscribePreviewOverlay,
} from '@src/renderer/editor/runtime/previewOverlay';
import type { EditorElementTypeV1 } from '@src/types/editor';
import type { BatchGeometryTarget } from '@src/renderer/editor/runtime/elementOps';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { StatItemPosition } from '@src/types/key/statItems';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { slotCanonical, slotDisplayName } from '@utils/keySlot';
import { isPluginVisibleInMode } from '@utils/layerGroupUtils';
import { resolveResizablePluginElementSize } from '@utils/plugin/pluginElementMeasurement';

export const usePropertiesPanelSelection = () => {
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const positions = useKeyStore((state) => state.positions);
  const canonicalPositions = useKeyStore((state) => state.canonicalPositions);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const canonicalStatItemPositions = useStatItemStore(
    (state) => state.positions,
  );
  const canonicalGraphItemPositions = useGraphItemStore(
    (state) => state.positions,
  );
  const canonicalKnobItemPositions = useKnobItemStore(
    (state) => state.positions,
  );
  useSyncExternalStore(
    subscribePreviewOverlay,
    getPreviewOverlayVersion,
    getPreviewOverlayVersion,
  );

  const statItemPositions = composePreviewPositions(
    'statPosition',
    canonicalStatItemPositions,
  );
  const graphItemPositions = composePreviewPositions(
    'graphPosition',
    canonicalGraphItemPositions,
  );
  const knobItemPositions = composePreviewPositions(
    'knobPosition',
    canonicalKnobItemPositions,
  );
  const pluginElements = usePluginDisplayElementStore(
    selectPropertyPanelPluginElements,
  );
  const pluginDefinitions = usePluginDisplayElementStore(
    (state) => state.definitions,
  );

  const selectedKeyElements = selectedElements.filter(
    (element) => element.type === 'key',
  );
  const selectedStatElements = selectedElements.filter(
    (element) => element.type === 'stat',
  );
  const selectedGraphElements = selectedElements.filter(
    (element) => element.type === 'graph',
  );
  const selectedKnobElements = selectedElements.filter(
    (element) => element.type === 'knob',
  );
  const selectedKeyLikeElements = selectedElements.filter(
    (element) => element.type === 'key' || element.type === 'stat',
  );
  const selectedBatchStyleElements = selectedElements.filter(
    (element) =>
      element.type === 'key' ||
      element.type === 'stat' ||
      element.type === 'graph' ||
      element.type === 'knob',
  );
  const selectedPluginElements = selectedElements.filter(
    (element) => element.type === 'plugin',
  );

  const selectedPluginElement = (() => {
    if (selectedPluginElements.length !== 1) return null;
    return (
      pluginElements.find(
        (element) => element.fullId === selectedPluginElements[0].id,
      ) ?? null
    );
  })();

  // invalid native ID 또는 모드에서 사라진 plugin이 섞이면 fail-closed
  const stableBatchGeometryTargets: BatchGeometryTarget[] | null =
    selectedBatchStyleElements.every(
      (element) => element.id.length > 0 && isNativeElementId(element.id),
    )
      ? selectedBatchStyleElements.map((element) => ({
          type: element.type as EditorElementTypeV1,
          id: element.id,
        }))
      : null;
  const stablePluginGeometryElements = (() => {
    const resolved: Array<{
      fullId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    for (const selected of selectedPluginElements) {
      const element = pluginElements.find(
        (candidate) => candidate.fullId === selected.id,
      );
      if (!element || !isPluginVisibleInMode(element, selectedKeyType)) {
        return null;
      }
      const size = resolveResizablePluginElementSize(element);
      resolved.push({
        fullId: element.fullId,
        x: element.position.x,
        y: element.position.y,
        width: size.width,
        height: size.height,
      });
    }
    return resolved;
  })();
  const stablePluginGeometryTargets =
    stablePluginGeometryElements?.map((element) => element.fullId) ?? null;

  const selectedPluginDefinition = selectedPluginElement?.definitionId
    ? pluginDefinitions.get(selectedPluginElement.definitionId) ?? null
    : null;
  const pluginSettingsUI = selectedPluginDefinition?.settingsUI ?? 'panel';
  const hasSinglePluginSelection =
    selectedPluginElements.length === 1 && !!selectedPluginElement;
  const showModalHint =
    hasSinglePluginSelection && pluginSettingsUI === 'modal';
  const showSettings = hasSinglePluginSelection && pluginSettingsUI !== 'modal';
  const isPluginResizable =
    hasSinglePluginSelection && !!selectedPluginDefinition?.resizable;
  const pluginDisplaySize = {
    width:
      selectedPluginElement?.measuredSize?.width ??
      selectedPluginElement?.estimatedSize?.width ??
      200,
    height:
      selectedPluginElement?.measuredSize?.height ??
      selectedPluginElement?.estimatedSize?.height ??
      150,
  };

  const singleKeyId =
    selectedKeyElements.length === 1 ? selectedKeyElements[0].id : null;
  const singleKeyIndex = singleKeyId
    ? (positions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleKeyId,
      )
    : -1;
  const singleKeyPosition =
    singleKeyIndex >= 0 ? positions[selectedKeyType]?.[singleKeyIndex] : null;
  const singleCanonicalKeyPosition = singleKeyId
    ? (canonicalPositions[selectedKeyType] ?? []).find(
        (position) => position.id === singleKeyId,
      ) ?? null
    : null;
  const singleKeySlot =
    singleKeyIndex >= 0
      ? keyMappings[selectedKeyType]?.[singleKeyIndex] ?? null
      : null;
  const singleKeyCode =
    singleKeySlot != null ? slotCanonical(singleKeySlot) : null;
  const singleKeyInfo =
    singleKeySlot != null && singleKeyCode
      ? typeof singleKeySlot === 'string'
        ? getKeyInfoByGlobalKey(singleKeySlot)
        : {
            browserKey: singleKeyCode,
            globalKey: singleKeyCode,
            displayName: slotDisplayName(singleKeySlot),
          }
      : null;

  const singleStatId =
    selectedStatElements.length === 1 ? selectedStatElements[0].id : null;
  const singleStatIndex = singleStatId
    ? (statItemPositions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleStatId,
      )
    : -1;
  const singleStatPosition: StatItemPosition | null =
    singleStatIndex >= 0
      ? statItemPositions[selectedKeyType]?.[singleStatIndex] ?? null
      : null;
  const singleGraphId =
    selectedGraphElements.length === 1 ? selectedGraphElements[0].id : null;
  const singleGraphIndex = singleGraphId
    ? (graphItemPositions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleGraphId,
      )
    : -1;
  const singleGraphPosition: GraphItemPosition | null =
    singleGraphIndex >= 0
      ? graphItemPositions[selectedKeyType]?.[singleGraphIndex] ?? null
      : null;
  const singleKnobId =
    selectedKnobElements.length === 1 ? selectedKnobElements[0].id : null;
  const singleKnobIndex = singleKnobId
    ? (knobItemPositions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleKnobId,
      )
    : -1;
  const singleKnobPosition: KnobItemPosition | null =
    singleKnobIndex >= 0
      ? knobItemPositions[selectedKeyType]?.[singleKnobIndex] ?? null
      : null;

  const allLayerGroups = useLayerGroupStore((state) => state.layerGroups);
  const layerGroupsForMode = allLayerGroups[selectedKeyType] || [];
  const selectedGroupInfo = (() => {
    if (selectedElements.length < 2) return null;

    const keyModePositions = positions[selectedKeyType] || [];
    const statModePositions = statItemPositions[selectedKeyType] || [];
    const graphModePositions = graphItemPositions[selectedKeyType] || [];
    const knobModePositions = knobItemPositions[selectedKeyType] || [];
    const modeGroupIds = new Set(layerGroupsForMode.map((group) => group.id));
    let groupId: string | undefined;

    for (const element of selectedElements) {
      let currentGroupId: string | undefined;
      if (element.type === 'key') {
        currentGroupId = keyModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'stat') {
        currentGroupId = statModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'graph') {
        currentGroupId = graphModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'knob') {
        currentGroupId = knobModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'plugin') {
        const pluginGroupId = pluginElements.find(
          (candidate) => candidate.fullId === element.id,
        )?.groupId;
        currentGroupId =
          pluginGroupId && modeGroupIds.has(pluginGroupId)
            ? pluginGroupId
            : undefined;
      } else {
        return null;
      }

      if (!currentGroupId) return null;
      if (!groupId) groupId = currentGroupId;
      else if (groupId !== currentGroupId) return null;
    }
    if (!groupId) return null;

    const totalMembers =
      keyModePositions.filter((position) => position?.groupId === groupId)
        .length +
      statModePositions.filter((position) => position?.groupId === groupId)
        .length +
      graphModePositions.filter((position) => position?.groupId === groupId)
        .length +
      knobModePositions.filter((position) => position?.groupId === groupId)
        .length +
      pluginElements.filter(
        (element) =>
          isPluginVisibleInMode(element, selectedKeyType) &&
          element.groupId === groupId,
      ).length;
    if (totalMembers < 2 || totalMembers !== selectedElements.length) {
      return null;
    }

    const groupDefinition = layerGroupsForMode.find(
      (group) => group.id === groupId,
    );
    if (!groupDefinition) return null;
    return {
      id: groupDefinition.id,
      name: groupDefinition.name,
      memberCount: totalMembers,
    };
  })();

  return {
    selectedElements,
    selectedKeyType,
    positions,
    canonicalPositions,
    keyMappings,
    statItemPositions,
    graphItemPositions,
    knobItemPositions,
    pluginElements,
    selectedKeyElements,
    selectedStatElements,
    selectedGraphElements,
    selectedKnobElements,
    selectedKeyLikeElements,
    selectedBatchStyleElements,
    selectedPluginElements,
    selectedPluginElement,
    stableBatchGeometryTargets,
    stablePluginGeometryElements,
    stablePluginGeometryTargets,
    selectedPluginDefinition,
    hasSinglePluginSelection,
    showModalHint,
    showSettings,
    isPluginResizable,
    pluginDisplaySize,
    singleKeyIndex,
    singleKeyPosition,
    singleCanonicalKeyPosition,
    singleKeySlot,
    singleKeyCode,
    singleKeyInfo,
    singleStatIndex,
    singleStatPosition,
    singleGraphIndex,
    singleGraphPosition,
    singleKnobPosition,
    selectedGroupInfo,
  };
};
