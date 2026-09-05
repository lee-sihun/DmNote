import type {
  CanonicalEditorDocumentV1,
  CanonicalGraphItemPosition,
  CanonicalKeyPosition,
  CanonicalKnobItemPosition,
  CanonicalStatItemPosition,
  EditorInsertFrozenElementsOpV1,
} from '@src/types/editor';
import type { KeySlot } from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { ElementIntentAbort } from '@src/renderer/editor/runtime/elementIntent';
import {
  applyZIndexToLayerOrder,
  buildLayerItemsForMode,
} from '@utils/layerGroupUtils';
import { stableStringify } from '@utils/core/stableStringify';

const orderPastedItemsByFrozenZ = <Item>(
  entries: ReadonlyArray<{ item: Item; zIndex: number | undefined }>,
): Item[] => {
  let carry = Number.POSITIVE_INFINITY;
  return entries
    .map(({ item, zIndex }, order) => {
      carry = zIndex ?? carry;
      return { item, order, z: carry };
    })
    .sort((a, b) => b.z - a.z || a.order - b.order)
    .map((entry) => entry.item);
};

interface FrozenPasteModelOptions {
  selectedKeyType: string;
  keysToAdd: Array<{ keyCode: KeySlot; position: CanonicalKeyPosition }>;
  statsToAdd: Array<{ position: CanonicalStatItemPosition }>;
  graphsToAdd: Array<{ position: CanonicalGraphItemPosition }>;
  knobsToAdd: Array<{ position: CanonicalKnobItemPosition }>;
  frozenPluginElements: PluginDisplayElementInternal[];
  pluginIdsToAdd: string[];
  frozenNewGroups: Array<{ id: string; name: string; collapsed: boolean }>;
  frozenInstanceCaps: Array<{
    definitionId: string;
    pluginId: string;
    maxInstances: number;
    pastedCount: number;
  }>;
  frozenAnchor: { elementId?: string; groupId?: string } | null;
}

export const createFrozenPasteModel = ({
  selectedKeyType,
  keysToAdd,
  statsToAdd,
  graphsToAdd,
  knobsToAdd,
  frozenPluginElements,
  pluginIdsToAdd,
  frozenNewGroups,
  frozenInstanceCaps,
  frozenAnchor,
}: FrozenPasteModelOptions) => {
  // z 재부여는 mode 내 모든 plugin에 닿는다 - scope는 신규 ∪ mode 전체
  const pluginScope = (
    elements: readonly PluginDisplayElementInternal[],
  ): string[] => [
    ...new Set([
      ...pluginIdsToAdd,
      ...elements
        .filter((element) => element.tabId === selectedKeyType)
        .map((element) => element.pluginId)
        .filter((pluginId): pluginId is string => Boolean(pluginId)),
    ]),
  ];

  interface PasteDocView {
    keys: Record<string, KeySlot[]>;
    keyPositions: CanonicalEditorDocumentV1['keyPositions'];
    statPositions: CanonicalEditorDocumentV1['statPositions'];
    graphPositions: CanonicalEditorDocumentV1['graphPositions'];
    knobPositions: CanonicalEditorDocumentV1['knobPositions'];
    layerGroups: Record<string, Array<{ id: string; name: string }>>;
  }

  const payloadFingerprint = (value: unknown): string =>
    stableStringify({
      ...(value as Record<string, unknown>),
      zIndex: undefined,
    });

  // 문서 뷰(base 또는 스토어)에서 동결 계획을 재적용해 결과를 산출.
  // 충돌(같은 id에 다른 payload)은 전체 중단, 동일 payload는 skip(멱등)
  const computePaste = (
    view: PasteDocView,
    projection: readonly PluginDisplayElementInternal[],
  ): {
    appended: boolean;
    keys: Record<string, KeySlot[]>;
    zPatch: ReturnType<typeof applyZIndexToLayerOrder>;
    layerGroups: Record<string, Array<{ id: string; name: string }>>;
    groupsChanged: boolean;
    desiredProjection: PluginDisplayElementInternal[];
    nativeBatchState: 'fresh' | 'realized' | 'partial';
    frozenGroupConflict: boolean;
  } => {
    const mode = selectedKeyType;
    let appended = false;

    const findNativeById = (
      id: string,
    ): { field: keyof PasteDocView; mode: string; index: number } | null => {
      const fields = [
        'keyPositions',
        'statPositions',
        'graphPositions',
        'knobPositions',
      ] as const;
      for (const field of fields) {
        for (const [ownMode, list] of Object.entries(view[field])) {
          const index = (list as Array<{ id: string }>).findIndex(
            (position) => position.id === id,
          );
          if (index !== -1) return { field, mode: ownMode, index };
        }
      }
      return null;
    };

    const nextKeys = { ...view.keys };
    const nextKeyPositions = { ...view.keyPositions };
    const nextStatPositions = { ...view.statPositions };
    const nextGraphPositions = { ...view.graphPositions };
    const nextKnobPositions = { ...view.knobPositions };

    const appendedNativeIds = new Set<string>();
    let realizedFrozenNativeParts = 0;
    let missingFrozenNativeParts = 0;
    let frozenGroupConflict = false;
    for (const entry of keysToAdd) {
      const existing = findNativeById(entry.position.id);
      if (existing) {
        const position = (
          view[existing.field][existing.mode] as Array<Record<string, unknown>>
        )[existing.index];
        const pairedSlot = view.keys[existing.mode]?.[existing.index];
        if (
          existing.field !== 'keyPositions' ||
          payloadFingerprint(position) !== payloadFingerprint(entry.position) ||
          stableStringify(pairedSlot) !== stableStringify(entry.keyCode)
        ) {
          throw new ElementIntentAbort('paste id collision');
        }
        realizedFrozenNativeParts += 1;
        continue;
      }
      nextKeys[mode] = [...(nextKeys[mode] ?? []), entry.keyCode];
      nextKeyPositions[mode] = [
        ...(nextKeyPositions[mode] ?? []),
        entry.position,
      ];
      appendedNativeIds.add(entry.position.id);
      missingFrozenNativeParts += 1;
      appended = true;
    }
    const appendSimple = <T extends { id: string }>(
      record: Record<string, T[]>,
      entries: Array<{ position: T }>,
      field: keyof PasteDocView,
    ): Record<string, T[]> => {
      let next = record;
      for (const entry of entries) {
        const existing = findNativeById(entry.position.id);
        if (existing) {
          const position = (
            view[existing.field][existing.mode] as Array<
              Record<string, unknown>
            >
          )[existing.index];
          if (
            existing.field !== field ||
            payloadFingerprint(position) !== payloadFingerprint(entry.position)
          ) {
            throw new ElementIntentAbort('paste id collision');
          }
          realizedFrozenNativeParts += 1;
          continue;
        }
        next = { ...next, [mode]: [...(next[mode] ?? []), entry.position] };
        appendedNativeIds.add(entry.position.id);
        missingFrozenNativeParts += 1;
        appended = true;
      }
      return next;
    };
    const statNext = appendSimple(
      nextStatPositions,
      statsToAdd,
      'statPositions',
    );
    const graphNext = appendSimple(
      nextGraphPositions,
      graphsToAdd,
      'graphPositions',
    );
    const knobNext = appendSimple(
      nextKnobPositions,
      knobsToAdd,
      'knobPositions',
    );

    // 신규 그룹 append (id 기준 멱등)
    let layerGroups = view.layerGroups;
    let groupsChanged = false;
    if (frozenNewGroups.length > 0) {
      const modeGroups = [...(layerGroups[mode] ?? [])];
      for (const group of frozenNewGroups) {
        const existing = modeGroups.find(
          (candidate) => candidate.id === group.id,
        );
        if (existing) {
          if (existing.name !== group.name) {
            frozenGroupConflict = true;
          }
          realizedFrozenNativeParts += 1;
          continue;
        }
        modeGroups.push({ id: group.id, name: group.name });
        missingFrozenNativeParts += 1;
        groupsChanged = true;
      }
      if (groupsChanged) {
        layerGroups = { ...layerGroups, [mode]: modeGroups };
      }
    }

    // plugin append (fullId 멱등·충돌 검사)
    const appendedPlugins: PluginDisplayElementInternal[] = [];
    for (const element of frozenPluginElements) {
      const existing = projection.find(
        (candidate) => candidate.fullId === element.fullId,
      );
      if (existing) {
        if (payloadFingerprint(existing) !== payloadFingerprint(element)) {
          throw new ElementIntentAbort('paste plugin fullId collision');
        }
        continue;
      }
      appendedPlugins.push(element);
      appended = true;
    }
    const combinedProjection = [...projection, ...appendedPlugins];

    // 상한 재검증 - 동결과 정산 사이 추가된 인스턴스와의 TOCTOU 차단.
    // 초과는 부분 성공 대신 전체 중단 (사전 검증과 동일한 fail-closed)
    for (const cap of frozenInstanceCaps) {
      const count = combinedProjection.filter(
        (element) =>
          element.definitionId === cap.definitionId && element.tabId === mode,
      ).length;
      if (count > cap.maxInstances) {
        throw new ElementIntentAbort('paste max instances exceeded');
      }
    }

    // 결합 순서 재구성 + 동결 앵커 재해석 (소실 시 최상단 fallback)
    const allItems = buildLayerItemsForMode(
      mode,
      nextKeyPositions as never,
      statNext as never,
      graphNext as never,
      knobNext as never,
      combinedProjection,
    );
    const newIdSet = new Set<string>([
      ...appendedNativeIds,
      ...appendedPlugins.map((element) => element.fullId),
    ]);
    const existingItems = allItems.filter((item) => !newIdSet.has(item.id));
    const pastedById = new Map(
      allItems
        .filter((item) => newIdSet.has(item.id))
        .map((item) => [item.id, item]),
    );
    // 블록 내부는 원본의 상대 스택을 따른다 - payload는 타입별로 묶인
    // 순서라 그대로 쓰면 복사본의 위아래가 뒤집힌다. 정렬 키는 동결
    // payload의 zIndex 원본값 (append 후 대체값이 아니라)
    const pastedOrdered = orderPastedItemsByFrozenZ([
      ...keysToAdd.map((entry) => ({
        item: entry.position.id,
        zIndex: entry.position.zIndex,
      })),
      ...statsToAdd.map((entry) => ({
        item: entry.position.id,
        zIndex: entry.position.zIndex,
      })),
      ...graphsToAdd.map((entry) => ({
        item: entry.position.id,
        zIndex: entry.position.zIndex,
      })),
      ...knobsToAdd.map((entry) => ({
        item: entry.position.id,
        zIndex: entry.position.zIndex,
      })),
      ...frozenPluginElements.map((element) => ({
        item: element.fullId,
        zIndex: element.zIndex,
      })),
    ])
      .map((id) => pastedById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    let anchorIndex = 0;
    if (frozenAnchor?.groupId) {
      const index = existingItems.findIndex(
        (item) => item.groupId === frozenAnchor.groupId,
      );
      anchorIndex = index !== -1 ? index : 0;
    } else if (frozenAnchor?.elementId) {
      const index = existingItems.findIndex(
        (item) => item.id === frozenAnchor.elementId,
      );
      anchorIndex = index !== -1 ? index : 0;
    }
    const reordered = [
      ...existingItems.slice(0, anchorIndex),
      ...pastedOrdered,
      ...existingItems.slice(anchorIndex),
    ];
    const zPatch = applyZIndexToLayerOrder(
      reordered,
      mode,
      nextKeyPositions as never,
      statNext as never,
      graphNext as never,
      knobNext as never,
    );
    const zByFullId = new Map(
      zPatch.pluginUpdates.map((update) => [update.fullId, update.zIndex]),
    );
    const desiredProjection = combinedProjection.map((element) => {
      const zIndex = zByFullId.get(element.fullId);
      return zIndex === undefined ? element : { ...element, zIndex };
    });

    return {
      appended,
      keys: nextKeys,
      zPatch,
      layerGroups,
      groupsChanged,
      desiredProjection,
      nativeBatchState:
        realizedFrozenNativeParts > 0 && missingFrozenNativeParts > 0
          ? 'partial'
          : realizedFrozenNativeParts > 0
          ? 'realized'
          : 'fresh',
      frozenGroupConflict,
    };
  };

  const buildFrozenInsertOp = (
    view: PasteDocView,
    plan: ReturnType<typeof computePaste>,
  ): { kind: 'ops'; op: EditorInsertFrozenElementsOpV1 | null } => {
    const mode = selectedKeyType;
    const frozenNativeIds = new Set([
      ...keysToAdd.map((entry) => entry.position.id),
      ...statsToAdd.map((entry) => entry.position.id),
      ...graphsToAdd.map((entry) => entry.position.id),
      ...knobsToAdd.map((entry) => entry.position.id),
    ]);
    const finalById = <T extends { id: string }>(record: Record<string, T[]>) =>
      new Map((record[mode] ?? []).map((position) => [position.id, position]));
    const finalKeys = finalById(plan.zPatch.keyPositions);
    const finalStats = finalById(plan.zPatch.statPositions);
    const finalGraphs = finalById(plan.zPatch.graphPositions);
    const finalKnobs = finalById(plan.zPatch.knobPositions);
    const elements: EditorInsertFrozenElementsOpV1['elements'] = [
      ...keysToAdd.map((entry) => ({
        elementType: 'key' as const,
        slot: entry.keyCode,
        position: finalKeys.get(entry.position.id) ?? entry.position,
      })),
      ...statsToAdd.map((entry) => ({
        elementType: 'stat' as const,
        position: finalStats.get(entry.position.id) ?? entry.position,
      })),
      ...graphsToAdd.map((entry) => ({
        elementType: 'graph' as const,
        position: finalGraphs.get(entry.position.id) ?? entry.position,
      })),
      ...knobsToAdd.map((entry) => ({
        elementType: 'knob' as const,
        position: finalKnobs.get(entry.position.id) ?? entry.position,
      })),
    ];
    const zUpdates: EditorInsertFrozenElementsOpV1['zUpdates'] = [];
    const collectZUpdates = (
      elementType: 'key' | 'stat' | 'graph' | 'knob',
      current: Array<{ id: string }>,
      final: Map<string, { id: string; zIndex?: number }>,
    ) => {
      for (const position of current) {
        const id = position.id;
        if (!id || !isNativeElementId(id)) return false;
        if (frozenNativeIds.has(id)) continue;
        const zIndex = final.get(id)?.zIndex;
        if (!Number.isSafeInteger(zIndex)) return false;
        zUpdates.push({ elementType, id, zIndex: zIndex! });
      }
      return true;
    };
    const stable =
      collectZUpdates('key', view.keyPositions[mode] ?? [], finalKeys) &&
      collectZUpdates('stat', view.statPositions[mode] ?? [], finalStats) &&
      collectZUpdates('graph', view.graphPositions[mode] ?? [], finalGraphs) &&
      collectZUpdates('knob', view.knobPositions[mode] ?? [], finalKnobs);
    if (!stable) {
      throw new ElementIntentAbort('paste source document is not canonical');
    }
    if (plan.frozenGroupConflict) {
      throw new ElementIntentAbort('paste group id collision');
    }
    if (plan.nativeBatchState === 'partial') {
      throw new ElementIntentAbort('paste partial state collision');
    }
    if (elements.length === 0 && zUpdates.length === 0) {
      return { kind: 'ops', op: null };
    }
    return {
      kind: 'ops',
      op: {
        kind: 'insertFrozenElements',
        mode,
        elements,
        groups: frozenNewGroups.map(({ id, name }) => ({ id, name })),
        zUpdates,
      },
    };
  };

  return { pluginScope, computePaste, buildFrozenInsertOp };
};
