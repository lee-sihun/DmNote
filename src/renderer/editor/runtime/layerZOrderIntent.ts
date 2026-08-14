import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { assertCanonicalEditorDocument } from '@src/types/editor';
import {
  applyPropertyIntentsEagerly,
  combineReceipts,
  ElementIntentAbort,
  type ElementIntentReceipt,
} from './elementIntent';
import { runMixedGestureElementIntent } from './mixedElementIntent';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import { isPluginVisibleInMode } from '@utils/layerGroupUtils';
import { boxesOverlap } from '../model/zOrder';
import { isNativeElementId } from '../model/elementId';

import type {
  CanonicalEditorDocumentV1,
  EditorElementTypeV1,
  EditorReorderElementsOpV1,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

type NativeType = EditorElementTypeV1;
type ZOrderAction = 'front' | 'back' | 'forward' | 'backward';

export type StableLayerTarget =
  | { type: NativeType; id: string }
  | { type: 'plugin'; id: string };

export const orderStableZTargetsForBatch = (
  targets: readonly StableLayerTarget[],
): StableLayerTarget[] => [
  ...targets.filter((target) => target.type === 'plugin'),
  ...targets.filter((target) => target.type !== 'plugin'),
];

interface NativeEntry {
  type: NativeType;
  id: string;
  zIndex: number;
  position: {
    dx: number;
    dy: number;
    width: number;
    height: number;
  };
}

interface ZOrderPlan {
  nativeZ: Map<string, { type: NativeType; zIndex: number }>;
  pluginZ: Map<string, number>;
}

const localDocument = (): CanonicalEditorDocumentV1 => ({
  schemaVersion: 1,
  keys: useKeyStore.getState().keyMappings,
  keyPositions: useKeyStore.getState().canonicalPositions,
  statPositions: useStatItemStore.getState().positions,
  graphPositions: useGraphItemStore.getState().positions,
  knobPositions: useKnobItemStore.getState().positions,
  layerGroups: useLayerGroupStore.getState().layerGroups,
});

const nativeEntries = (
  document: CanonicalEditorDocumentV1,
  mode: string,
): NativeEntry[] => {
  const records = [
    ['key', document.keyPositions],
    ['stat', document.statPositions],
    ['graph', document.graphPositions],
    ['knob', document.knobPositions],
  ] as const;
  return records.flatMap(([type, record]) =>
    (record[mode] ?? []).map((position, index) => ({
      type,
      id: position.id,
      zIndex: position.zIndex ?? index,
      position,
    })),
  );
};

const pluginBounds = (element: PluginDisplayElementInternal) => ({
  x: element.position.x,
  y: element.position.y,
  width: element.measuredSize?.width ?? element.estimatedSize?.width ?? 100,
  height: element.measuredSize?.height ?? element.estimatedSize?.height ?? 100,
});

const resolvePlan = (
  mode: string,
  targets: readonly StableLayerTarget[],
  action: ZOrderAction,
  document: CanonicalEditorDocumentV1,
  pluginProjection: readonly PluginDisplayElementInternal[],
): ZOrderPlan => {
  const native = nativeEntries(document, mode);
  const plugins = pluginProjection.filter((element) =>
    isPluginVisibleInMode(element, mode),
  );
  const nativeById = new Map(native.map((entry) => [entry.id, entry]));
  const pluginById = new Map(
    plugins.map((element) => [element.fullId, element]),
  );
  const seen = new Set<string>();
  targets.forEach((target) => {
    if (
      (target.type !== 'plugin' && !isNativeElementId(target.id)) ||
      (target.type === 'plugin' && target.id.length === 0) ||
      seen.has(target.id)
    )
      throw new ElementIntentAbort('z-order target invalid');
    seen.add(target.id);
    if (target.type === 'plugin') {
      if (!pluginById.has(target.id))
        throw new ElementIntentAbort('z-order target missing');
      return;
    }
    const entry = nativeById.get(target.id);
    if (!entry || entry.type !== target.type)
      throw new ElementIntentAbort('z-order target missing');
  });

  const nativeZ = new Map<string, { type: NativeType; zIndex: number }>();
  const pluginZ = new Map<string, number>();
  const allZ = [
    ...native.map((entry) => entry.zIndex),
    ...plugins.map((element) => element.zIndex ?? 0),
  ];
  if (action === 'front' || action === 'back') {
    const edge =
      action === 'front' ? Math.max(0, ...allZ) : Math.min(0, ...allZ);
    targets.forEach((target, order) => {
      const zIndex = action === 'front' ? edge + 1 + order : edge - 1 - order;
      if (target.type === 'plugin') pluginZ.set(target.id, zIndex);
      else nativeZ.set(target.id, { type: target.type, zIndex });
    });
    return { nativeZ, pluginZ };
  }

  targets.forEach((target) => {
    if (target.type !== 'key' && target.type !== 'plugin') {
      const entry = nativeById.get(target.id)!;
      nativeZ.set(target.id, {
        type: target.type,
        zIndex: entry.zIndex + (action === 'forward' ? 1 : -1),
      });
      return;
    }
    const currentZ =
      target.type === 'key'
        ? nativeById.get(target.id)!.zIndex
        : pluginById.get(target.id)!.zIndex ?? 0;
    const targetBox =
      target.type === 'key'
        ? (() => {
            const position = nativeById.get(target.id)!.position;
            return {
              x: position.dx,
              y: position.dy,
              width: position.width,
              height: position.height,
            };
          })()
        : pluginBounds(pluginById.get(target.id)!);
    const candidates: number[] = [];
    native.forEach((entry) => {
      if (entry.type !== 'key' || entry.id === target.id) return;
      const above = action === 'forward' && entry.zIndex > currentZ;
      const below = action === 'backward' && entry.zIndex < currentZ;
      if (
        (above || below) &&
        boxesOverlap(targetBox, {
          x: entry.position.dx,
          y: entry.position.dy,
          width: entry.position.width,
          height: entry.position.height,
        })
      ) {
        candidates.push(entry.zIndex);
      }
    });
    plugins.forEach((element) => {
      if (element.fullId === target.id) return;
      const zIndex = element.zIndex ?? 0;
      const above = action === 'forward' && zIndex > currentZ;
      const below = action === 'backward' && zIndex < currentZ;
      if ((above || below) && boxesOverlap(targetBox, pluginBounds(element))) {
        candidates.push(zIndex);
      }
    });
    const zIndex =
      candidates.length === 0
        ? currentZ + (action === 'forward' ? 1 : -1)
        : action === 'forward'
        ? Math.min(...candidates) + 1
        : Math.max(...candidates) - 1;
    if (target.type === 'plugin') pluginZ.set(target.id, zIndex);
    else nativeZ.set(target.id, { type: 'key', zIndex });
  });
  return { nativeZ, pluginZ };
};

const opFromPlan = (
  mode: string,
  plan: ZOrderPlan,
): EditorReorderElementsOpV1 | null => {
  const zUpdates = [...plan.nativeZ].map(([id, value]) => ({
    elementType: value.type,
    id,
    zIndex: value.zIndex,
  }));
  return zUpdates.length === 0
    ? null
    : {
        kind: 'reorderElements',
        mode,
        completeModeOrder: false,
        zUpdates,
        groupUpdates: [],
      };
};

const desiredPlugins = (
  projection: readonly PluginDisplayElementInternal[],
  plan: ZOrderPlan,
): PluginDisplayElementInternal[] =>
  projection.map((element) => {
    const zIndex = plan.pluginZ.get(element.fullId);
    return zIndex === undefined || zIndex === element.zIndex
      ? element
      : { ...element, zIndex };
  });

const applyPluginZEagerly = (plan: ZOrderPlan): ElementIntentReceipt | null => {
  const store = usePluginDisplayElementStore.getState();
  const entries: Array<{
    id: string;
    before: number | undefined;
    expected: number;
  }> = [];
  const next = store.elements.map((element) => {
    const zIndex = plan.pluginZ.get(element.fullId);
    if (zIndex === undefined || zIndex === element.zIndex) return element;
    entries.push({
      id: element.fullId,
      before: element.zIndex,
      expected: zIndex,
    });
    return { ...element, zIndex };
  });
  if (entries.length === 0) return null;
  try {
    store.setElements(next);
  } catch (error) {
    try {
      usePluginDisplayElementStore
        .getState()
        .setElements([...store.elements], { skipSync: true });
    } catch {
      // 원래 오류 보존
    }
    throw error;
  }
  return {
    rollback: () => {
      const current = usePluginDisplayElementStore.getState();
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      let touched = false;
      const restored = current.elements.map((element) => {
        const entry = byId.get(element.fullId);
        if (!entry || element.zIndex !== entry.expected) return element;
        touched = true;
        return { ...element, zIndex: entry.before };
      });
      if (touched) current.setElements(restored);
    },
  };
};

export const commitStableLayerZOrder = async (options: {
  mode: string;
  targets: readonly StableLayerTarget[];
  action: ZOrderAction;
}): Promise<boolean> => {
  if (options.targets.length === 0) return false;
  const gestureId = crypto.randomUUID();
  const initialPlugins = usePluginDisplayElementStore.getState().elements;
  const initialPlan = resolvePlan(
    options.mode,
    options.targets,
    options.action,
    localDocument(),
    initialPlugins,
  );
  const initialPluginIds = [
    ...new Set(
      (options.targets.every(
        (target) =>
          target.type !== 'plugin' &&
          target.type !== 'key' &&
          (options.action === 'forward' || options.action === 'backward'),
      )
        ? []
        : initialPlugins.filter((element) =>
            isPluginVisibleInMode(element, options.mode),
          )
      ).map((element) => element.pluginId),
    ),
  ];
  let receipt: ElementIntentReceipt | null = null;
  let runnerStarted = false;
  try {
    if (initialPluginIds.length > 0) {
      beginMixedGestureTransaction(gestureId, initialPluginIds);
      initialPluginIds.forEach((pluginId) =>
        rotatePluginInstancesEditSession(pluginId, gestureId),
      );
    }
    const nativeIntents = new Map<
      NativeType,
      Map<string, Record<string, unknown>>
    >();
    initialPlan.nativeZ.forEach((value, id) => {
      const byId = nativeIntents.get(value.type) ?? new Map();
      byId.set(id, { zIndex: value.zIndex });
      nativeIntents.set(value.type, byId);
    });
    receipt = applyPropertyIntentsEagerly(nativeIntents);
    receipt = combineReceipts(receipt, applyPluginZEagerly(initialPlan));
    runnerStarted = true;
    const result = await runMixedGestureElementIntent({
      gestureId,
      initialPluginIds,
      pluginScope: (elements) =>
        options.targets.every(
          (target) =>
            target.type !== 'plugin' &&
            target.type !== 'key' &&
            (options.action === 'forward' || options.action === 'backward'),
        )
          ? []
          : elements
              .filter((element) => isPluginVisibleInMode(element, options.mode))
              .map((element) => element.pluginId),
      receipt,
      generate: ({ base, pluginProjection }) => {
        const plan = resolvePlan(
          options.mode,
          options.targets,
          options.action,
          (() => {
            assertCanonicalEditorDocument(base, 'layer z-order base');
            return base;
          })(),
          pluginProjection,
        );
        const op = opFromPlan(options.mode, plan);
        const desiredPluginProjection = desiredPlugins(pluginProjection, plan);
        return op
          ? { kind: 'ops', ops: [op], desiredPluginProjection }
          : { kind: 'patch', patch: null, desiredPluginProjection };
      },
      skipContext: 'layer z-order settlement',
      retryEditorOnly: false,
    });
    return result.committed;
  } catch (error) {
    if (!runnerStarted) receipt?.rollback();
    throw error;
  } finally {
    cancelUncommittedMixedGestureTransaction(gestureId);
  }
};
