import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { reconcileSelectionAfterIndexedElementDeletion } from '@stores/grid/useGridSelectionStore';

import { resolveElementById } from '../model/elementIdMap';
import { cloneKeyPositionForDuplicate } from '../model/keys';
import { cloneSlot } from '@utils/keySlot';
import { normalizeLayerGroupsForMode } from '@utils/layerGroupUtils';
import {
  applyPropertyIntentsEagerly,
  intentPatch,
  runElementIntent,
  type ElementIntentGeneration,
  type ElementIntentReceipt,
  type PropertyIntents,
} from './elementIntent';
import { commitSemanticOps } from './editorSemanticOps';
import { editorCoordinator } from './editorStateCoordinator';

import type {
  EditorBoundsV1,
  EditorDocumentV1,
  EditorElementPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
  EditorNotePropertyPatchV1,
  EditorOpV1,
  EditorPatchV1,
} from '@src/types/editor';

import type { NativeElementType } from '../model/elementIdMap';
import type { KeyPosition, KeySlot } from '@src/types/key/keys';

// 메뉴·확인 모달처럼 대상 확정과 실행 사이가 긴 파괴적 액션의 semantic op.
// 대상은 {type, id}로 받고, eager 반영과 wire 생성 각각이 실행 시점의
// 문서에서 id를 다시 찾아 적용한다. 못 찾으면(삭제·모드 소실) 조용히
// 중단한다 - index를 들고 있다가 다른 요소를 지우는 창을 없애는 것이 목적

type LooseRecord = Record<
  string,
  Array<{ id?: string } & Record<string, unknown>>
>;

const findInRecord = (
  record: LooseRecord,
  id: string,
): { mode: string; index: number } | null => {
  for (const [mode, list] of Object.entries(record)) {
    const index = list.findIndex((position) => position.id === id);
    if (index >= 0) return { mode, index };
  }
  return null;
};

const removeAt = (
  record: LooseRecord,
  mode: string,
  index: number,
): LooseRecord => ({
  ...record,
  [mode]: (record[mode] ?? []).filter((_, i) => i !== index),
});

// 삭제: 키는 keys와 keyPositions의 인덱스 결합을 함께 제거, 아이템은 해당
// 컬렉션만. 반환 false = 실행 시점에 대상 없음(이미 삭제).
// 오류는 전파된다 - 편입 전 실패는 receipt가 로컬 삭제를 되돌린다.
// 선택 보정은 정책상 eager와 함께 즉시 수행하고 실패해도 복구하지 않는다
export const deleteElementById = (
  type: NativeElementType,
  id: string,
): Promise<boolean> => {
  if (!id) return Promise.resolve(false);

  const applyEager = (): ElementIntentReceipt | null => {
    const locator = resolveElementById(type, id);
    if (!locator) return null;
    const layerGroupsBefore = useLayerGroupStore.getState().layerGroups;
    let removedGroups: Array<{ id: string; name: string; index: number }> = [];

    let removedSlot: unknown;
    let removedPosition: Record<string, unknown> | undefined;
    if (type === 'key') {
      const state = useKeyStore.getState();
      removedSlot = state.keyMappings[locator.mode]?.[locator.index];
      removedPosition = (state.canonicalPositions as unknown as LooseRecord)[
        locator.mode
      ]?.[locator.index];
      const nextMappings = {
        ...state.keyMappings,
        [locator.mode]: (state.keyMappings[locator.mode] ?? []).filter(
          (_, i) => i !== locator.index,
        ),
      };
      const nextPositions = removeAt(
        state.canonicalPositions as unknown as LooseRecord,
        locator.mode,
        locator.index,
      );
      state.setKeyMappingsAndPositions(nextMappings, nextPositions as never);
    } else {
      const state =
        type === 'stat'
          ? useStatItemStore.getState()
          : type === 'graph'
          ? useGraphItemStore.getState()
          : useKnobItemStore.getState();
      removedPosition = (state.positions as unknown as LooseRecord)[
        locator.mode
      ]?.[locator.index];
      state.setPositions(
        removeAt(
          state.positions as unknown as LooseRecord,
          locator.mode,
          locator.index,
        ) as never,
      );
    }
    // 선택 보정은 현재 모드 배열 기준 - 다른 모드로 이동한 대상의 index로
    // 현재 모드의 무관한 선택을 지우면 안 된다
    if (locator.mode === useKeyStore.getState().selectedKeyType) {
      reconcileSelectionAfterIndexedElementDeletion(type, locator.index);
    }

    const keyState = useKeyStore.getState();
    const normalized = normalizeLayerGroupsForMode({
      mode: locator.mode,
      keyPositions: keyState.canonicalPositions,
      statPositions: useStatItemStore.getState().positions,
      graphPositions: useGraphItemStore.getState().positions,
      knobPositions: useKnobItemStore.getState().positions,
      layerGroups: useLayerGroupStore.getState().layerGroups,
    });
    if (normalized.positionsChanged) {
      keyState.setKeyMappingsAndPositions(
        keyState.keyMappings,
        normalized.keyPositions,
      );
      useStatItemStore.getState().setPositions(normalized.statPositions);
      useGraphItemStore.getState().setPositions(normalized.graphPositions);
      useKnobItemStore.getState().setPositions(normalized.knobPositions);
    }
    if (normalized.groupsChanged) {
      const remaining = new Set(
        (normalized.layerGroups[locator.mode] ?? []).map((group) => group.id),
      );
      removedGroups = (layerGroupsBefore[locator.mode] ?? [])
        .map((group, index) => ({ ...group, index }))
        .filter((group) => !remaining.has(group.id));
      useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
    }

    return {
      rollback: () => {
        const canonical = editorCoordinator.getState().lastAck;
        const canonicalRecord = canonical?.[
          type === 'key'
            ? 'keyPositions'
            : type === 'stat'
            ? 'statPositions'
            : type === 'graph'
            ? 'graphPositions'
            : 'knobPositions'
        ] as LooseRecord | undefined;
        if (canonicalRecord && !findInRecord(canonicalRecord, id)) return;
        const currentRecord =
          type === 'key'
            ? (useKeyStore.getState()
                .canonicalPositions as unknown as LooseRecord)
            : type === 'stat'
            ? (useStatItemStore.getState().positions as unknown as LooseRecord)
            : type === 'graph'
            ? (useGraphItemStore.getState().positions as unknown as LooseRecord)
            : (useKnobItemStore.getState().positions as unknown as LooseRecord);
        // 다른 경로가 같은 ID를 이미 복원·갱신했으면 그룹까지 그 경로 소유
        if (findInRecord(currentRecord, id)) return;
        if (removedGroups.length > 0) {
          const layerGroupState = useLayerGroupStore.getState();
          const currentMode = [
            ...(layerGroupState.layerGroups[locator.mode] ?? []),
          ];
          let restored = false;
          for (const group of removedGroups) {
            if (currentMode.some((candidate) => candidate.id === group.id))
              continue;
            currentMode.splice(Math.min(group.index, currentMode.length), 0, {
              id: group.id,
              name: group.name,
            });
            restored = true;
          }
          if (restored) {
            layerGroupState.setLayerGroups({
              ...layerGroupState.layerGroups,
              [locator.mode]: currentMode,
            });
          }
        }
        if (!removedPosition) return;
        // membership CAS: id가 이미 돌아와 있으면(다른 경로 복원) 중복 금지
        if (type === 'key') {
          const state = useKeyStore.getState();
          const record = state.canonicalPositions as unknown as LooseRecord;
          if (findInRecord(record, id)) return;
          const list = record[locator.mode] ?? [];
          const at = Math.min(locator.index, list.length);
          const mappings = state.keyMappings[locator.mode] ?? [];
          state.setKeyMappingsAndPositions(
            {
              ...state.keyMappings,
              [locator.mode]: [
                ...mappings.slice(0, at),
                removedSlot as never,
                ...mappings.slice(at),
              ],
            },
            {
              ...record,
              [locator.mode]: [
                ...list.slice(0, at),
                removedPosition,
                ...list.slice(at),
              ],
            } as never,
          );
          return;
        }
        const state =
          type === 'stat'
            ? useStatItemStore.getState()
            : type === 'graph'
            ? useGraphItemStore.getState()
            : useKnobItemStore.getState();
        const record = state.positions as unknown as LooseRecord;
        if (findInRecord(record, id)) return;
        const list = record[locator.mode] ?? [];
        const at = Math.min(locator.index, list.length);
        state.setPositions({
          ...record,
          [locator.mode]: [
            ...list.slice(0, at),
            removedPosition,
            ...list.slice(at),
          ],
        } as never);
      },
    };
  };

  const receipt = applyEager();
  let enrolled = false;
  return commitSemanticOps([{ kind: 'deleteElement', elementType: type, id }], {
    onEnrolled: () => {
      enrolled = true;
    },
  })
    .then(() => true)
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

// 복제 배치: 시작 시점에 동결한 payload(slot + position)를 현재 모드에 새
// 요소로 추가한다. sourceIndex 재조회 금지 - 고스트를 따라다니는 동안의
// 재정렬이 다른 키를 복제하게 만든다
export interface FrozenKeyDuplicate {
  slot: unknown;
  position: KeyPosition;
}

export const placeDuplicatedKey = (
  frozen: FrozenKeyDuplicate,
  mode: string,
  dx: number,
  dy: number,
): Promise<boolean> => {
  // 구 duplicateKey와 같은 정규화: 새 신원, 좌표 반올림, 참조 분리, 기본값 백필
  const newPosition = cloneKeyPositionForDuplicate(frozen.position, dx, dy);
  const newId = newPosition.id as string;
  const frozenSlot = cloneSlot(frozen.slot as never);

  const applyEager = (): ElementIntentReceipt => {
    const state = useKeyStore.getState();
    state.setKeyMappingsAndPositions(
      {
        ...state.keyMappings,
        [mode]: [...(state.keyMappings[mode] ?? []), frozenSlot as never],
      },
      {
        ...state.canonicalPositions,
        [mode]: [...(state.canonicalPositions[mode] ?? []), newPosition],
      } as never,
    );
    return {
      rollback: () => {
        // membership CAS: 우리가 넣은 newId가 아직 있으면 pair 제거
        const current = useKeyStore.getState();
        const record = current.canonicalPositions as unknown as LooseRecord;
        const located = findInRecord(record, newId);
        if (!located) return;
        current.setKeyMappingsAndPositions(
          {
            ...current.keyMappings,
            [located.mode]: (current.keyMappings[located.mode] ?? []).filter(
              (_, i) => i !== located.index,
            ),
          },
          removeAt(record, located.mode, located.index) as never,
        );
      },
    };
  };

  return runElementIntent({
    applyEager,
    generate: (base: EditorDocumentV1): ElementIntentGeneration => {
      // 이미 같은 id가 들어가 있으면(이중 실행·선반영) 재추가 금지 -
      // canonical 달성으로 보고 로컬 복제를 되돌리지 않는다
      if (findInRecord(base.keyPositions as unknown as LooseRecord, newId)) {
        return { kind: 'satisfied' };
      }
      return intentPatch({
        schemaVersion: 1,
        keys: {
          ...base.keys,
          [mode]: [...(base.keys[mode] ?? []), frozenSlot as never],
        },
        keyPositions: {
          ...base.keyPositions,
          [mode]: [...(base.keyPositions[mode] ?? []), newPosition],
        } as never,
      });
    },
  }).then((result) => result.committed || result.satisfied);
};

// z-order: 모드 전역(4 컬렉션 + 외부 플러그인 z) 기준으로 대상 id들에
// 새 zIndex를 선택 순서대로 할당하는 단일 트랜잭션. 루프-await로 요소마다
// 따로 커밋하면 렌더 클로저 base가 서로를 덮는다 (플러그인 없이 재현되는
// lost update). 플러그인 요소는 편집 문서 밖이라 이 op에 결합하지 않는다
export interface ZOrderTarget {
  type: NativeElementType;
  id: string;
}

const Z_ORDER_FIELDS = [
  'keyPositions',
  'statPositions',
  'graphPositions',
  'knobPositions',
] as const;

const zOrderRecords = (
  base: EditorDocumentV1,
): Record<(typeof Z_ORDER_FIELDS)[number], LooseRecord> => ({
  keyPositions: base.keyPositions as unknown as LooseRecord,
  statPositions: base.statPositions as unknown as LooseRecord,
  graphPositions: base.graphPositions as unknown as LooseRecord,
  knobPositions: base.knobPositions as unknown as LooseRecord,
});

const FIELD_BY_TYPE: Record<
  NativeElementType,
  (typeof Z_ORDER_FIELDS)[number]
> = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
};

const computeZOrderPatch = (
  base: EditorDocumentV1,
  targets: readonly ZOrderTarget[],
  direction: 'front' | 'back',
  externalZIndexes: readonly number[],
): { patch: EditorPatchV1 | null; applied: number } => {
  const records = zOrderRecords(base);
  const located: Array<{
    field: (typeof Z_ORDER_FIELDS)[number];
    mode: string;
    index: number;
  }> = [];
  for (const target of targets) {
    if (!target.id) continue;
    const field = FIELD_BY_TYPE[target.type];
    const found = findInRecord(records[field], target.id);
    if (!found) continue;
    located.push({ field, ...found });
  }
  if (located.length === 0) return { patch: null, applied: 0 };

  // 대상 모드들의 전역 z 범위 (컬렉션 4개 + 외부)
  const modes = new Set(located.map((entry) => entry.mode));
  const zValues: number[] = [...externalZIndexes];
  for (const field of Z_ORDER_FIELDS) {
    for (const mode of modes) {
      (records[field][mode] ?? []).forEach((position, i) => {
        zValues.push(typeof position.zIndex === 'number' ? position.zIndex : i);
      });
    }
  }
  const maxZ = Math.max(0, ...zValues);
  const minZ = Math.min(0, ...zValues);

  const next: Partial<Record<(typeof Z_ORDER_FIELDS)[number], LooseRecord>> =
    {};
  located.forEach((entry, order) => {
    const zIndex = direction === 'front' ? maxZ + 1 + order : minZ - 1 - order;
    const record = next[entry.field] ?? {
      ...records[entry.field],
    };
    record[entry.mode] = (record[entry.mode] ?? []).map((position, i) =>
      i === entry.index ? { ...position, zIndex } : position,
    );
    next[entry.field] = record;
  });

  const patch: EditorPatchV1 = { schemaVersion: 1 };
  for (const field of Z_ORDER_FIELDS) {
    if (next[field]) patch[field] = next[field] as never;
  }
  return { patch, applied: located.length };
};

const storeDocumentSnapshot = (): EditorDocumentV1 =>
  ({
    schemaVersion: 1,
    keys: useKeyStore.getState().keyMappings,
    keyPositions: useKeyStore.getState().canonicalPositions,
    statPositions: useStatItemStore.getState().positions,
    graphPositions: useGraphItemStore.getState().positions,
    knobPositions: useKnobItemStore.getState().positions,
    layerGroups: {},
  } as unknown as EditorDocumentV1);

export const applyZOrderByIds = (
  targets: readonly ZOrderTarget[],
  direction: 'front' | 'back',
  externalZIndexes: readonly number[] = [],
): Promise<number> => {
  let applied = 0;
  return runElementIntent({
    applyEager: () => {
      // eager z를 id별 속성 의도로 변환해 receipt CAS 복원을 얻는다
      const eager = computeZOrderPatch(
        storeDocumentSnapshot(),
        targets,
        direction,
        externalZIndexes,
      );
      if (!eager.patch) return null;
      const intents = new Map<
        NativeElementType,
        Map<string, Record<string, unknown>>
      >();
      for (const target of targets) {
        if (!target.id) continue;
        const field = FIELD_BY_TYPE[target.type];
        const record = eager.patch[field] as unknown as LooseRecord | undefined;
        if (!record) continue;
        const located = findInRecord(record, target.id);
        if (!located) continue;
        const zIndex = record[located.mode][located.index].zIndex;
        const byId = intents.get(target.type) ?? new Map();
        byId.set(target.id, { zIndex });
        intents.set(target.type, byId);
      }
      return applyPropertyIntentsEagerly(intents);
    },
    generate: (base) => {
      const generated = computeZOrderPatch(
        base,
        targets,
        direction,
        externalZIndexes,
      );
      applied = generated.applied;
      return intentPatch(generated.patch);
    },
  }).then((result) => (result.committed ? applied : 0));
};

// 키 슬롯 재바인딩: keys만 바꾸되 대상은 paired 위치의 안정 id로 재결합한다.
// index 기반 keys 단독 커밋은 same-shape 재정렬과 겹치면 다른 위치 id와
// 잘못 결합된다
export const rebindKeySlotById = (
  positionId: string,
  newSlot: KeySlot,
): Promise<boolean> => {
  if (!positionId) return Promise.resolve(false);

  const applyEager = (): ElementIntentReceipt | null => {
    const locator = resolveElementById('key', positionId);
    if (!locator) return null;
    const state = useKeyStore.getState();
    const beforeSlot = state.keyMappings[locator.mode]?.[locator.index];
    state.setKeyMappings({
      ...state.keyMappings,
      [locator.mode]: (state.keyMappings[locator.mode] ?? []).map((slot, i) =>
        i === locator.index ? newSlot : slot,
      ),
    } as never);
    return {
      rollback: () => {
        // paired CAS: 위치 id의 현재 자리 슬롯이 우리가 쓴 값일 때만 복원
        const current = useKeyStore.getState();
        const located = findInRecord(
          current.canonicalPositions as unknown as LooseRecord,
          positionId,
        );
        if (!located) return;
        if (current.keyMappings[located.mode]?.[located.index] !== newSlot) {
          return;
        }
        current.setKeyMappings({
          ...current.keyMappings,
          [located.mode]: (current.keyMappings[located.mode] ?? []).map(
            (slot, i) => (i === located.index ? beforeSlot : slot),
          ),
        } as never);
      },
    };
  };

  const receipt = applyEager();
  let enrolled = false;
  return commitSemanticOps(
    [{ kind: 'setKeySlot', id: positionId, slot: newSlot }],
    {
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => outcome.opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchElementPropertyById = (
  type: NativeElementType,
  id: string,
  patch: EditorElementPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (!id) return Promise.resolve(false);
  const eagerPatch =
    'layerName' in patch
      ? { layerName: patch.layerName ?? undefined }
      : 'graphType' in patch
      ? { graphType: patch.graphType }
      : 'graphColor' in patch
      ? { graphColor: patch.graphColor }
      : { ...patch };
  const intents: PropertyIntents = new Map([
    [type, new Map([[id, eagerPatch]])],
  ]);
  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;
  return commitSemanticOps(
    [{ kind: 'patchElement', elementType: type, id, patch }],
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => outcome.opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

interface ElementPropertyPatchTarget {
  type: NativeElementType;
  id: string;
  patch: EditorElementPropertyPatchV1;
}

const patchElementPropertiesByIds = (
  targets: readonly ElementPropertyPatchTarget[],
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (targets.length === 0 || targets.some((target) => !target.id)) {
    return Promise.resolve(false);
  }
  const mutableIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const target of targets) {
    const eagerPatch =
      'layerName' in target.patch
        ? { layerName: target.patch.layerName ?? undefined }
        : 'graphType' in target.patch
        ? { graphType: target.patch.graphType }
        : 'graphColor' in target.patch
        ? { graphColor: target.patch.graphColor }
        : { ...target.patch };
    const byId = mutableIntents.get(target.type) ?? new Map();
    byId.set(target.id, eagerPatch);
    mutableIntents.set(target.type, byId);
  }
  const receipt = applyPropertyIntentsEagerly(mutableIntents);
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ type, id, patch }) => ({
      kind: 'patchElement' as const,
      elementType: type,
      id,
      patch,
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchElementHiddenById = (
  type: NativeElementType,
  id: string,
  hidden: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> => patchElementPropertyById(type, id, { hidden }, options);

export const patchElementLayerNameById = (
  type: NativeElementType,
  id: string,
  layerName: string | null,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById(type, id, { layerName }, options);
};

export const patchGraphTypeById = (
  id: string,
  graphType: 'line' | 'bar',
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById('graph', id, { graphType }, options);
};

export const patchGraphTypesByIds = (
  ids: readonly string[],
  graphType: 'line' | 'bar',
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    ids.length === 0 ||
    ids.some((id) => id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    return Promise.resolve(false);
  }
  return patchElementPropertiesByIds(
    ids.map((id) => ({ type: 'graph', id, patch: { graphType } })),
    options,
  );
};

export const patchGraphColorById = (
  id: string,
  graphColor: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById('graph', id, { graphColor }, options);
};

export const patchGraphColorsByIds = (
  ids: readonly string[],
  graphColor: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    ids.length === 0 ||
    ids.some((id) => id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    return Promise.resolve(false);
  }
  return patchElementPropertiesByIds(
    ids.map((id) => ({ type: 'graph', id, patch: { graphColor } })),
    options,
  );
};

export const patchGraphPropertyById = (
  id: string,
  patch: EditorGraphRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById('graph', id, patch, options);
};

export const patchGraphPropertiesByIds = (
  ids: readonly string[],
  patch: EditorGraphRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    ids.length === 0 ||
    ids.some((id) => id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    return Promise.resolve(false);
  }
  return patchElementPropertiesByIds(
    ids.map((id) => ({ type: 'graph', id, patch })),
    options,
  );
};

export const patchKnobPropertyById = (
  id: string,
  patch: EditorKnobRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById('knob', id, patch, options);
};

export const patchKnobPropertiesByIds = (
  ids: readonly string[],
  patch: EditorKnobRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    ids.length === 0 ||
    ids.some((id) => id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    return Promise.resolve(false);
  }
  return patchElementPropertiesByIds(
    ids.map((id) => ({ type: 'knob', id, patch })),
    options,
  );
};

export const patchUseInlineStylesById = (
  type: NativeElementType,
  id: string,
  useInlineStyles: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById(type, id, { useInlineStyles }, options);
};

export const patchUseInlineStylesByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  useInlineStyles: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some((target) => target.id.length === 0) ||
    new Set(targets.map((target) => target.id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  return patchElementPropertiesByIds(
    targets.map(({ elementType, id }) => ({
      type: elementType,
      id,
      patch: { useInlineStyles },
    })),
    options,
  );
};

export const patchFontStyleById = (
  type: NativeElementType,
  id: string,
  patch: EditorFontStylePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById(type, id, patch, options);
};

export const patchFontStyleByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorFontStylePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some((target) => target.id.length === 0) ||
    new Set(targets.map((target) => target.id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  return patchElementPropertiesByIds(
    targets.map(({ elementType, id }) => ({
      type: elementType,
      id,
      patch,
    })),
    options,
  );
};

export const patchNotePropertyById = (
  id: string,
  patch: EditorNotePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  return patchElementPropertyById('key', id, patch, options);
};

export const patchNotePropertiesByIds = (
  ids: readonly string[],
  patch: EditorNotePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    ids.length === 0 ||
    ids.some((id) => id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    return Promise.resolve(false);
  }
  return patchElementPropertiesByIds(
    ids.map((id) => ({ type: 'key', id, patch })),
    options,
  );
};

// 다중 선택 정산: 대상 id들의 현재 canonical 기하(dx·dy)를 의도로 캡처해
// 슬롯 안에서 id 재해석으로 적용한다. 4컬렉션 full-record 캡처는 배타
// mutation(카운터 프리셋 삭제 등)의 IPC 창과 겹치면 직렬화 때문에 그 직후에
// 확정적으로 착지해 무관 필드 재작성을 되돌린다 - 기하만 실어 그 결합을 끊는다
export type GeometryField = 'dx' | 'dy' | 'width' | 'height';

export const commitSelectedGeometryByIds = (
  targets: readonly ZOrderTarget[],
  gestureId?: string,
  // 이동 경로는 dx·dy만 - 크기까지 항상 실으면 병행 크기 변경을 되돌린다.
  // 리사이즈 종료만 width·height를 명시적으로 포함한다
  fields: readonly GeometryField[] = ['dx', 'dy'],
): Promise<number> => {
  const intents = new Map<
    NativeElementType,
    Map<string, Partial<Record<GeometryField, number>>>
  >();
  for (const target of targets) {
    if (!target.id) continue;
    const locator = resolveElementById(target.type, target.id);
    if (!locator) continue;
    const record =
      target.type === 'key'
        ? (useKeyStore.getState().canonicalPositions as unknown as LooseRecord)
        : target.type === 'stat'
        ? (useStatItemStore.getState().positions as unknown as LooseRecord)
        : target.type === 'graph'
        ? (useGraphItemStore.getState().positions as unknown as LooseRecord)
        : (useKnobItemStore.getState().positions as unknown as LooseRecord);
    const position = record[locator.mode]?.[locator.index];
    if (!position) continue;
    const byId = intents.get(target.type) ?? new Map();
    const intent: Partial<Record<GeometryField, number>> = {};
    for (const field of fields) {
      const value = position[field];
      if (typeof value === 'number') intent[field] = value;
    }
    byId.set(target.id, intent);
    intents.set(target.type, byId);
  }
  if (intents.size === 0) return Promise.resolve(0);

  let applied = 0;
  return runElementIntent({
    // 드래그가 이미 스토어에 최종값을 반영했으므로 eager 없음 - 실패 시
    // 남는 값은 드래그 산출물이며 수용된 낙관 의미론(V-5)을 따른다
    applyEager: () => null,
    generate: (base) => {
      const patch: EditorPatchV1 = { schemaVersion: 1 };
      let touchedAny = false;
      for (const [type, byId] of intents) {
        const field = FIELD_BY_TYPE[type];
        const record = base[field] as unknown as LooseRecord;
        let touched = 0;
        const next: LooseRecord = {};
        for (const [mode, list] of Object.entries(record)) {
          next[mode] = list.map((position) => {
            const id = position.id;
            if (typeof id !== 'string' || !byId.has(id)) return position;
            touched += 1;
            return { ...position, ...byId.get(id) };
          });
        }
        if (touched > 0) {
          patch[field] = next as never;
          applied += touched;
          touchedAny = true;
        }
      }
      return intentPatch(touchedAny ? patch : null);
    },
    ...(gestureId ? { gestureId } : {}),
  }).then((result) => (result.committed ? applied : 0));
};

// 리사이즈 완료 전용: 시작 시 동결한 대상 id들에 최종 bounds를 하나의
// intent로 - eager와 wire, receipt를 같은 의도가 소유한다. 대상 소실은
// targetLost로 eager 복원, 오류는 전파
export const commitElementBoundsById = (
  intents: PropertyIntents,
  gestureId?: string,
): Promise<boolean> => {
  const ops: EditorOpV1[] = [];
  const boundsKeys = new Set(['dx', 'dy', 'width', 'height']);
  for (const [elementType, byId] of intents) {
    for (const [id, patch] of byId) {
      if (
        Object.keys(patch).some((key) => !boundsKeys.has(key)) ||
        typeof patch.dx !== 'number' ||
        typeof patch.dy !== 'number' ||
        typeof patch.width !== 'number' ||
        typeof patch.height !== 'number'
      ) {
        return Promise.reject(
          new TypeError('bounds intent must contain four numeric fields'),
        );
      }
      ops.push({
        kind: 'setBounds',
        elementType,
        id,
        bounds: {
          dx: patch.dx,
          dy: patch.dy,
          width: patch.width,
          height: patch.height,
        },
      });
    }
  }
  if (ops.length === 0) return Promise.resolve(false);

  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;
  return commitSemanticOps(ops, {
    ...(gestureId ? { gestureId } : {}),
    onEnrolled: () => {
      enrolled = true;
    },
  })
    .then(({ opResults }) =>
      opResults.some(({ status }) => status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const commitSingleElementBoundsById = (
  type: NativeElementType,
  id: string,
  bounds: EditorBoundsV1,
  gestureId?: string,
): Promise<boolean> => {
  const intents: PropertyIntents = new Map([
    [type, new Map([[id, { ...bounds }]])],
  ]);
  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;

  return commitSemanticOps(
    [{ kind: 'setBounds', elementType: type, id, bounds }],
    {
      ...(gestureId ? { gestureId } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then(({ opResults }) => opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};
