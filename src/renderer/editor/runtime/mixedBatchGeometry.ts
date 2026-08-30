// 혼합(native+plugin) 배치 기하 진입점: 정렬·분배·간격 결과를 native는
// setBounds op, 플러그인은 같은 gestureId의 position pluginChanges로
// 단일 커밋에 실린다 - history compound 병합으로 undo가 원자 복원된다

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import { isPluginVisibleInMode } from '@utils/layerGroupUtils';
import { resolveResizablePluginElementSize } from '@utils/plugin/pluginElementMeasurement';
import { isNativeElementId } from '../model/elementId';
import {
  computeBatchGeometryPlan,
  type BatchGeometryLayoutElement,
} from './batchGeometryPlan';
import {
  ElementIntentAbort,
  applyPropertyIntentsEagerly,
  combineReceipts,
  type ElementIntentReceipt,
} from './elementIntent';
import {
  commitBatchGeometryByIds,
  type BatchGeometryDescriptor,
} from './elementOps';
import { runMixedGestureElementIntent } from './mixedElementIntent';

import type { CanonicalEditorDocumentV1, EditorOpV1 } from '@src/types/editor';
import type { NativeElementType } from '../model/elementIdMap';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const MAX_BATCH_GEOMETRY_TARGETS = 4096;
const PLUGIN_KEY_PREFIX = 'plugin:';

const validStructuralText = (value: string, maxBytes: number): boolean =>
  value.length > 0 && new TextEncoder().encode(value).length <= maxBytes;

const nativeLayoutKey = (type: NativeElementType, id: string): string =>
  `${type}:${id}`;

const pluginLayoutKey = (fullId: string): string =>
  `${PLUGIN_KEY_PREFIX}${fullId}`;

// native 대상은 0개도 허용 (plugin 단독 배치) - 최소 개수는 진입점이
// native+plugin 합산으로 판정한다
const validNativeGeometryTargets = (
  descriptor: BatchGeometryDescriptor,
): boolean =>
  descriptor.targets.length <= MAX_BATCH_GEOMETRY_TARGETS &&
  descriptor.targets.every(
    ({ type, id }) =>
      ['key', 'stat', 'graph', 'knob', 'sprite'].includes(type) &&
      isNativeElementId(id),
  ) &&
  new Set(descriptor.targets.map(({ id }) => id)).size ===
    descriptor.targets.length;

type PositionSlice = Record<
  string,
  ReadonlyArray<Record<string, unknown>> | undefined
>;

const readStorePositions = (type: NativeElementType): PositionSlice =>
  (type === 'key'
    ? useKeyStore.getState().canonicalPositions
    : type === 'stat'
    ? useStatItemStore.getState().positions
    : type === 'graph'
    ? useGraphItemStore.getState().positions
    : type === 'knob'
    ? useKnobItemStore.getState().positions
    : useSpriteStore.getState().positions) as unknown as PositionSlice;

const readDocumentPositions =
  (base: CanonicalEditorDocumentV1) =>
  (type: NativeElementType): PositionSlice =>
    (type === 'key'
      ? base.keyPositions
      : type === 'stat'
      ? base.statPositions
      : type === 'graph'
      ? base.graphPositions
      : type === 'knob'
      ? base.knobPositions
      : base.spritePositions) as unknown as PositionSlice;

// native 대상 bounds 수집 - 지정 모드에서의 소실·비유한 값은 전체 거절
const readNativeLayoutElements = (
  read: (type: NativeElementType) => PositionSlice,
  descriptor: BatchGeometryDescriptor,
): BatchGeometryLayoutElement[] | null => {
  const elements: BatchGeometryLayoutElement[] = [];
  for (const target of descriptor.targets) {
    const position = (read(target.type)[descriptor.mode] ?? []).find(
      (candidate) => candidate.id === target.id,
    );
    if (
      !position ||
      typeof position.dx !== 'number' ||
      typeof position.dy !== 'number' ||
      typeof position.width !== 'number' ||
      typeof position.height !== 'number'
    ) {
      return null;
    }
    elements.push({
      key: nativeLayoutKey(target.type, target.id),
      x: position.dx,
      y: position.dy,
      width: position.width,
      height: position.height,
    });
  }
  return elements;
};

// 플러그인 대상 bounds 수집 - 크기는 measuredSize ?? estimatedSize ?? 기본값
// 폴백(캔버스 렌더 크기와 동일). 대상 소실·모드 이탈은 전체 거절 (fail-closed)
const readPluginLayoutElements = (
  projection: readonly PluginDisplayElementInternal[],
  mode: string,
  fullIds: readonly string[],
): BatchGeometryLayoutElement[] | null => {
  const byFullId = new Map(
    projection.map((element) => [element.fullId, element]),
  );
  const elements: BatchGeometryLayoutElement[] = [];
  for (const fullId of fullIds) {
    const element = byFullId.get(fullId);
    if (
      !element ||
      !isPluginVisibleInMode(element, mode) ||
      !Number.isFinite(element.position.x) ||
      !Number.isFinite(element.position.y)
    ) {
      return null;
    }
    const size = resolveResizablePluginElementSize(element);
    elements.push({
      key: pluginLayoutKey(fullId),
      x: element.position.x,
      y: element.position.y,
      width: size.width,
      height: size.height,
    });
  }
  return elements;
};

interface MixedGeometryPlanned {
  updates: Array<{ key: string; patch: Record<string, unknown> }>;
  nativeOps: EditorOpV1[];
  pluginPositions: Map<string, { x: number; y: number }>;
}

// 혼합 입력 위에서 순수 plan을 계산해 native op와 plugin 목표 위치로 분해
const planMixedBatchGeometry = (
  nativeElements: readonly BatchGeometryLayoutElement[],
  pluginElements: readonly BatchGeometryLayoutElement[],
  descriptor: BatchGeometryDescriptor,
): MixedGeometryPlanned | null => {
  const plan = computeBatchGeometryPlan(
    [...nativeElements, ...pluginElements],
    descriptor.operation,
  );
  if (!plan) return null;
  const targetByKey = new Map(
    descriptor.targets.map(
      (target) => [nativeLayoutKey(target.type, target.id), target] as const,
    ),
  );
  const nativeOps: EditorOpV1[] = [];
  const pluginPositions = new Map<string, { x: number; y: number }>();
  for (const { key, bounds } of plan.bounds) {
    const native = targetByKey.get(key);
    if (native) {
      nativeOps.push({
        kind: 'setBounds',
        elementType: native.type,
        id: native.id,
        bounds,
      });
      continue;
    }
    if (key.startsWith(PLUGIN_KEY_PREFIX)) {
      pluginPositions.set(key.slice(PLUGIN_KEY_PREFIX.length), {
        x: bounds.dx,
        y: bounds.dy,
      });
    }
  }
  return {
    updates: plan.updates.map(({ key, patch }) => ({
      key,
      patch: patch as Record<string, unknown>,
    })),
    nativeOps,
    pluginPositions,
  };
};

// 플러그인 position eager 반영 - CAS receipt (groupId eager 패턴과 동일)
const applyPluginPositionsEagerly = (
  targets: ReadonlyMap<string, { x: number; y: number }>,
): ElementIntentReceipt | null => {
  const store = usePluginDisplayElementStore.getState();
  const entries: Array<{
    fullId: string;
    before: { x: number; y: number };
    expected: { x: number; y: number };
  }> = [];
  const next = store.elements.map((element) => {
    const expected = targets.get(element.fullId);
    if (
      !expected ||
      (element.position.x === expected.x && element.position.y === expected.y)
    ) {
      return element;
    }
    entries.push({
      fullId: element.fullId,
      before: element.position,
      expected,
    });
    return {
      ...element,
      position: { ...element.position, x: expected.x, y: expected.y },
    };
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
      const currentStore = usePluginDisplayElementStore.getState();
      const byId = new Map(entries.map((entry) => [entry.fullId, entry]));
      let touched = false;
      const restored = currentStore.elements.map((element) => {
        const entry = byId.get(element.fullId);
        // CAS: 우리가 쓴 값 그대로일 때만 복원
        if (
          !entry ||
          element.position.x !== entry.expected.x ||
          element.position.y !== entry.expected.y
        ) {
          return element;
        }
        touched = true;
        return { ...element, position: entry.before };
      });
      if (touched) currentStore.setElements(restored);
    },
  };
};

/**
 * 선택된 native+plugin 요소의 배치 기하 조작 (main 창 전용)
 * plugin 대상이 없으면 기존 native 전용 경로에 위임.
 * resize는 native 전용 - 플러그인 크기는 content-driven이라 fail-closed 거절
 */
export const commitMixedBatchGeometry = (
  descriptor: BatchGeometryDescriptor,
  pluginFullIds: readonly string[],
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  if (pluginFullIds.length === 0) {
    return commitBatchGeometryByIds(descriptor, options);
  }
  if (
    descriptor.operation.kind === 'resize' ||
    !validStructuralText(descriptor.mode, 128) ||
    !validNativeGeometryTargets(descriptor) ||
    // 최소 개수는 native+plugin 합산 - plugin 단독도 2개 이상이면 성립
    descriptor.targets.length + pluginFullIds.length < 2 ||
    pluginFullIds.length > MAX_BATCH_GEOMETRY_TARGETS ||
    pluginFullIds.some((fullId) => fullId.trim().length === 0) ||
    new Set(pluginFullIds).size !== pluginFullIds.length
  ) {
    return Promise.resolve(false);
  }
  const frozenDescriptor = structuredClone(descriptor);
  const fullIds = [...pluginFullIds];

  const pluginElements = usePluginDisplayElementStore.getState().elements;
  const targetedPlugins = fullIds.flatMap((fullId) => {
    const element = pluginElements.find(
      (candidate) => candidate.fullId === fullId,
    );
    return element ? [element] : [];
  });
  // 대상 소실·모드 이탈은 부분 적용 대신 전체 거절 (fail-closed)
  if (
    targetedPlugins.length !== fullIds.length ||
    targetedPlugins.some(
      (element) => !isPluginVisibleInMode(element, frozenDescriptor.mode),
    )
  ) {
    return Promise.resolve(false);
  }
  const pluginIds = [
    ...new Set(targetedPlugins.map((element) => element.pluginId)),
  ];

  // 현재 스토어 기준 초기 계획 - eager 반영과 no-op 게이트에 사용
  const initialNative = readNativeLayoutElements(
    readStorePositions,
    frozenDescriptor,
  );
  const initialPlugins = readPluginLayoutElements(
    pluginElements,
    frozenDescriptor.mode,
    fullIds,
  );
  const initialPlanned =
    initialNative && initialPlugins
      ? planMixedBatchGeometry(initialNative, initialPlugins, frozenDescriptor)
      : null;
  if (!initialPlanned || initialPlanned.updates.length === 0) {
    return Promise.resolve(false);
  }

  const targetByKey = new Map(
    frozenDescriptor.targets.map(
      (target) => [nativeLayoutKey(target.type, target.id), target] as const,
    ),
  );

  const projectDesiredPlugins = (
    projection: readonly PluginDisplayElementInternal[],
    positions: ReadonlyMap<string, { x: number; y: number }>,
  ): PluginDisplayElementInternal[] =>
    projection.map((element) => {
      const next = positions.get(element.fullId);
      return next &&
        (element.position.x !== next.x || element.position.y !== next.y)
        ? {
            ...element,
            position: { ...element.position, x: next.x, y: next.y },
          }
        : element;
    });

  const run = async (): Promise<boolean> => {
    const gestureId = options.gestureId ?? crypto.randomUUID();
    let receipt: ElementIntentReceipt | null = null;
    let runnerStarted = false;
    try {
      beginMixedGestureTransaction(gestureId, pluginIds);
      pluginIds.forEach((pluginId) =>
        rotatePluginInstancesEditSession(pluginId, gestureId),
      );

      // eager: native 기하 필드 CAS + 플러그인 position CAS
      const nativeIntents = new Map<
        NativeElementType,
        Map<string, Record<string, unknown>>
      >();
      for (const { key, patch } of initialPlanned.updates) {
        const target = targetByKey.get(key);
        if (!target) continue;
        const byId = nativeIntents.get(target.type) ?? new Map();
        byId.set(target.id, patch);
        nativeIntents.set(target.type, byId);
      }
      const nativeReceipt =
        nativeIntents.size > 0
          ? applyPropertyIntentsEagerly(nativeIntents)
          : null;
      let pluginReceipt: ElementIntentReceipt | null = null;
      try {
        pluginReceipt = applyPluginPositionsEagerly(
          initialPlanned.pluginPositions,
        );
      } catch (error) {
        nativeReceipt?.rollback();
        throw error;
      }
      receipt = combineReceipts(nativeReceipt, pluginReceipt);

      runnerStarted = true;
      const result = await runMixedGestureElementIntent({
        gestureId,
        initialPluginIds: pluginIds,
        pluginScope: () => pluginIds,
        receipt,
        generate: ({ base, pluginProjection }) => {
          options.preflight?.();
          // 슬롯 재계획: native는 base, plugin은 projection에서 bounds를
          // 읽어 같은 plan에 합쳐 넣는다 - 대상 소실·모드 이탈은 부분 커밋
          // 대신 전체 중단 (fail-closed)
          const nativeElements = readNativeLayoutElements(
            readDocumentPositions(base),
            frozenDescriptor,
          );
          const pluginLayout = readPluginLayoutElements(
            pluginProjection,
            frozenDescriptor.mode,
            fullIds,
          );
          const planned =
            nativeElements && pluginLayout
              ? planMixedBatchGeometry(
                  nativeElements,
                  pluginLayout,
                  frozenDescriptor,
                )
              : null;
          if (!planned) {
            throw new ElementIntentAbort('mixed batch geometry settlement');
          }
          // 계약: scope 전체 projection 반환 - 부분 반환은 scope 요소의
          // 무음 삭제로 해석된다
          const desiredPluginProjection = projectDesiredPlugins(
            pluginProjection,
            planned.pluginPositions,
          );
          // plugin 단독은 editor 변경 없음 - 빈 ops 배열을 실으면
          // editorOps: []가 전송되어 백엔드 EMPTY_EDITOR_OPS 거절이 난다.
          // patch:null 경로는 editorChanges 없이 transaction callback만 실행
          if (planned.nativeOps.length === 0) {
            return { kind: 'patch', patch: null, desiredPluginProjection };
          }
          return {
            kind: 'ops',
            ops: planned.nativeOps,
            desiredPluginProjection,
          };
        },
        skipContext: 'mixed batch geometry settlement',
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

  return run();
};
