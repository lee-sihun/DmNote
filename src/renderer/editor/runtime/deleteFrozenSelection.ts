import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  deleteLayerSelectionViaAuthority,
  deletePluginElements,
  type LayerDeleteTarget,
} from '@plugins/rpc/pluginElementActions';
import { getPluginAuthorityGeneration } from '@plugins/rpc/pluginRpcClient';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { isNativeElementId } from '../model/elementId';
import {
  ElementIntentAbort,
  applySealedSliceMutation,
  combineReceipts,
  reportElementOpSkipped,
  type ElementIntentReceipt,
} from './elementIntent';
import {
  applyPluginRemovalEagerly,
  runMixedElementDeleteIntent,
  runMixedGestureElementIntent,
} from './mixedElementIntent';
import { normalizeLayerGroupsForMode } from '@utils/layerGroupUtils';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { EditorOpV1 } from '@src/types/editor';

type NativeType = 'key' | 'stat' | 'graph' | 'knob';

interface DeleteDocumentView {
  keys: Record<string, unknown[]>;
  keyPositions: Record<string, Array<{ id: string }>>;
  statPositions: Record<string, Array<{ id: string }>>;
  graphPositions: Record<string, Array<{ id: string }>>;
  knobPositions: Record<string, Array<{ id: string }>>;
  layerGroups: Record<string, unknown[]>;
}

const storeView = (): DeleteDocumentView => ({
  keys: useKeyStore.getState().keyMappings as Record<string, unknown[]>,
  keyPositions: useKeyStore.getState().canonicalPositions as never,
  statPositions: useStatItemStore.getState().positions as never,
  graphPositions: useGraphItemStore.getState().positions as never,
  knobPositions: useKnobItemStore.getState().positions as never,
  layerGroups: useLayerGroupStore.getState().layerGroups as never,
});

export const deleteFrozenSelection = async (
  selectedElements: readonly SelectedElement[],
  _selectedKeyType: string,
  options: {
    expectedAuthorityGeneration?: number;
    propagateErrors?: boolean;
  } = {},
): Promise<void> => {
  if (selectedElements.length === 0) return;
  const assertExpectedAuthorityGeneration = () => {
    if (
      options.expectedAuthorityGeneration !== undefined &&
      options.expectedAuthorityGeneration !== getPluginAuthorityGeneration()
    ) {
      throw new ElementIntentAbort('plugin authority generation changed');
    }
  };
  if (window.__dmn_window_type === 'panel') {
    const targets: LayerDeleteTarget[] = [];
    const seen = new Set<string>();
    for (const element of selectedElements) {
      if (
        element.id.trim().length === 0 ||
        seen.has(element.id) ||
        (element.type !== 'plugin' && !isNativeElementId(element.id))
      ) {
        reportElementOpSkipped('panel batch delete (unstable target)');
        return;
      }
      seen.add(element.id);
      targets.push({ elementType: element.type, id: element.id });
    }
    if (targets.length > 4096) {
      reportElementOpSkipped('panel batch delete (too many targets)');
      return;
    }
    useGridSelectionStore.getState().clearSelection();
    const deleted = await deleteLayerSelectionViaAuthority(targets);
    if (!deleted) reportElementOpSkipped('panel batch delete');
    return;
  }
  assertExpectedAuthorityGeneration();
  const gestureId = crypto.randomUUID();
  const stableTargets: Array<{ type: NativeType; id: string }> = [];
  const seenNativeIds = new Set<string>();
  for (const element of selectedElements) {
    if (element.type === 'plugin') continue;
    if (!isNativeElementId(element.id) || seenNativeIds.has(element.id)) {
      reportElementOpSkipped('batch delete (invalid native target)');
      return;
    }
    seenNativeIds.add(element.id);
    const type = element.type as NativeType;
    stableTargets.push({ type, id: element.id });
  }
  const pluginFullIds = selectedElements
    .filter((element) => element.type === 'plugin')
    .map((element) => element.id);
  const pluginIds = [
    ...new Set(
      usePluginDisplayElementStore
        .getState()
        .elements.filter((element) => pluginFullIds.includes(element.fullId))
        .map((element) => element.pluginId),
    ),
  ];
  const hasNative = stableTargets.length > 0;

  const collectRemoval = (document: DeleteDocumentView) => {
    const fields = {
      key: 'keyPositions',
      stat: 'statPositions',
      graph: 'graphPositions',
      knob: 'knobPositions',
    } as const;
    const removal = new Map<NativeType, Map<string, Set<number>>>();
    let found = 0;
    const mark = (type: NativeType, mode: string, index: number) => {
      const byMode = removal.get(type) ?? new Map<string, Set<number>>();
      const indices = byMode.get(mode) ?? new Set<number>();
      indices.add(index);
      byMode.set(mode, indices);
      removal.set(type, byMode);
      found += 1;
    };
    for (const target of stableTargets) {
      for (const [mode, list] of Object.entries(
        document[fields[target.type]],
      )) {
        const index = list.findIndex((position) => position.id === target.id);
        if (index >= 0) {
          mark(target.type, mode, index);
          break;
        }
      }
    }
    return { removal, found };
  };

  const applyRemoval = (
    document: DeleteDocumentView,
    removal: ReadonlyMap<NativeType, ReadonlyMap<string, ReadonlySet<number>>>,
  ) => {
    const next = {
      keys: { ...document.keys },
      keyPositions: { ...document.keyPositions },
      statPositions: { ...document.statPositions },
      graphPositions: { ...document.graphPositions },
      knobPositions: { ...document.knobPositions },
    };
    const affectedModes = new Set<string>();
    for (const [type, byMode] of removal) {
      const field =
        type === 'key'
          ? 'keyPositions'
          : type === 'stat'
          ? 'statPositions'
          : type === 'graph'
          ? 'graphPositions'
          : 'knobPositions';
      for (const [mode, indices] of byMode) {
        affectedModes.add(mode);
        next[field] = {
          ...next[field],
          [mode]: (next[field][mode] ?? []).filter(
            (_, index) => !indices.has(index),
          ),
        };
        if (type === 'key') {
          const pairLength = (next.keys[mode] ?? []).length;
          if (pairLength !== (document.keyPositions[mode] ?? []).length) {
            throw new ElementIntentAbort('key pair length mismatch');
          }
          for (const index of indices) {
            if (index < 0 || index >= pairLength) {
              throw new ElementIntentAbort('key pair index out of range');
            }
          }
          next.keys = {
            ...next.keys,
            [mode]: (next.keys[mode] ?? []).filter(
              (_, index) => !indices.has(index),
            ),
          };
        }
      }
    }
    let layerGroups = document.layerGroups;
    let groupsChanged = false;
    for (const mode of affectedModes) {
      const normalized = normalizeLayerGroupsForMode({
        mode,
        keyPositions: next.keyPositions as never,
        statPositions: next.statPositions as never,
        graphPositions: next.graphPositions as never,
        knobPositions: next.knobPositions as never,
        layerGroups: layerGroups as never,
      });
      next.keyPositions = normalized.keyPositions as never;
      next.statPositions = normalized.statPositions as never;
      next.graphPositions = normalized.graphPositions as never;
      next.knobPositions = normalized.knobPositions as never;
      if (normalized.groupsChanged) {
        layerGroups = normalized.layerGroups as never;
        groupsChanged = true;
      }
    }
    return { next, layerGroups, groupsChanged, affectedModes };
  };

  useGridSelectionStore.getState().clearSelection();
  try {
    if (pluginIds.length > 0) {
      beginMixedGestureTransaction(gestureId, pluginIds);
    }
    const eagerView = storeView();
    const eagerPlan = collectRemoval(eagerView);
    const eagerModes = new Set<string>();
    for (const byMode of eagerPlan.removal.values()) {
      for (const mode of byMode.keys()) eagerModes.add(mode);
    }
    const editorReceipt = hasNative
      ? applySealedSliceMutation({
          modes: [...eagerModes],
          fields: [
            'keys',
            'keyPositions',
            'statPositions',
            'graphPositions',
            'knobPositions',
            'layerGroups',
          ],
          mutate: () => {
            if (eagerPlan.found === 0) return;
            const applied = applyRemoval(eagerView, eagerPlan.removal);
            useKeyStore
              .getState()
              .setKeyMappingsAndPositions(
                applied.next.keys as never,
                applied.next.keyPositions as never,
              );
            useStatItemStore
              .getState()
              .setPositions(applied.next.statPositions as never);
            useGraphItemStore
              .getState()
              .setPositions(applied.next.graphPositions as never);
            useKnobItemStore
              .getState()
              .setPositions(applied.next.knobPositions as never);
            if (applied.groupsChanged) {
              useLayerGroupStore
                .getState()
                .setLayerGroups(applied.layerGroups as never);
            }
          },
        })
      : null;
    let pluginReceipt: ElementIntentReceipt | null = null;
    try {
      pluginReceipt = applyPluginRemovalEagerly(pluginFullIds, () => {
        if (pluginFullIds.length > 0) {
          deletePluginElements(pluginFullIds, gestureId);
        }
      });
    } catch (error) {
      editorReceipt?.rollback();
      throw error;
    }
    const receipt = combineReceipts(editorReceipt, pluginReceipt);
    if (stableTargets.length > 0) {
      const ops: EditorOpV1[] = stableTargets.map((target) => ({
        kind: 'deleteElement',
        elementType: target.type,
        id: target.id,
      }));
      try {
        await runMixedElementDeleteIntent({
          gestureId,
          pluginIds,
          deletedPluginFullIds: pluginFullIds,
          ops,
          receipt,
          expectedAuthorityGeneration: options.expectedAuthorityGeneration,
        });
      } catch (error) {
        if (options.propagateErrors) throw error;
        console.error('Failed to persist selected element deletion', error);
      }
      return;
    }

    try {
      if (pluginFullIds.length > 0) {
        const deleted = new Set(pluginFullIds);
        await runMixedGestureElementIntent({
          gestureId,
          initialPluginIds: pluginIds,
          pluginScope: () => pluginIds,
          receipt,
          // 여기는 stableTargets가 빈 plugin 전용 경로다. native 삭제 대상이
          // 없어 editor patch는 항상 비고, plugin projection만 정산한다
          generate: ({ pluginProjection }) => {
            const desired = pluginProjection.filter(
              (element) => !deleted.has(element.fullId),
            );
            if (desired.length === pluginProjection.length) {
              return { kind: 'satisfied' };
            }
            return {
              kind: 'patch',
              patch: null,
              desiredPluginProjection: desired,
            };
          },
          skipContext: 'batch delete settlement',
          expectedAuthorityGeneration: options.expectedAuthorityGeneration,
        });
      }
    } catch (error) {
      if (options.propagateErrors) throw error;
      console.error('Failed to persist selected element deletion', error);
    }
  } finally {
    cancelUncommittedMixedGestureTransaction(gestureId);
  }
};
