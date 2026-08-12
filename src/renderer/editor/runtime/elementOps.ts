import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { reconcileSelectionAfterIndexedElementDeletion } from '@stores/grid/useGridSelectionStore';

import { resolveElementById } from '../model/elementIdMap';
import { cloneKeyPositionForDuplicate } from '../model/keys';
import { cloneSlot } from '@utils/keySlot';
import { enqueueEditorCompatibilityOperation } from './editorCompatibilityQueue';
import { editorCoordinator } from './editorStateCoordinator';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';

import type { NativeElementType } from '../model/elementIdMap';
import type { KeyPosition } from '@src/types/key/keys';

// 메뉴·확인 모달처럼 대상 확정과 실행 사이가 긴 파괴적 액션의 semantic op.
// 대상은 {type, id}로 받고, eager 반영과 wire 생성 각각이 실행 시점의
// 문서에서 id를 다시 찾아 적용한다. 못 찾으면(삭제·모드 소실) 조용히
// 중단한다 - index를 들고 있다가 다른 요소를 지우는 창을 없애는 것이 목적

type LooseRecord = Record<
  string,
  Array<{ id?: string } & Record<string, unknown>>
>;

const COLLECTION_FIELDS: Record<
  Exclude<NativeElementType, 'key'>,
  'statPositions' | 'graphPositions' | 'knobPositions'
> = {
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
};

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
// 컬렉션만. 반환 false = 실행 시점에 대상 없음(이미 삭제)
export const deleteElementById = (
  type: NativeElementType,
  id: string,
): Promise<boolean> => {
  if (!id) return Promise.resolve(false);
  const locator = resolveElementById(type, id);
  if (!locator) return Promise.resolve(false);

  // eager 반영 + 선택 재조정 - 이후의 캡처가 삭제를 포함해 자가 치유
  if (type === 'key') {
    const state = useKeyStore.getState();
    const mappings = state.keyMappings;
    const nextMappings = {
      ...mappings,
      [locator.mode]: (mappings[locator.mode] ?? []).filter(
        (_, i) => i !== locator.index,
      ),
    };
    const nextPositions = removeAt(
      state.canonicalPositions as unknown as LooseRecord,
      locator.mode,
      locator.index,
    );
    state.setKeyMappingsAndPositions(nextMappings, nextPositions as never);
  } else if (type === 'stat') {
    const state = useStatItemStore.getState();
    state.setPositions(
      removeAt(
        state.positions as unknown as LooseRecord,
        locator.mode,
        locator.index,
      ) as never,
    );
  } else if (type === 'graph') {
    const state = useGraphItemStore.getState();
    state.setPositions(
      removeAt(
        state.positions as unknown as LooseRecord,
        locator.mode,
        locator.index,
      ) as never,
    );
  } else {
    const state = useKnobItemStore.getState();
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

  return enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.commitGeneratedPatch((base) => {
      if (type === 'key') {
        const found = findInRecord(
          base.keyPositions as unknown as LooseRecord,
          id,
        );
        if (!found) return null;
        return {
          schemaVersion: 1,
          keys: {
            ...base.keys,
            [found.mode]: (base.keys[found.mode] ?? []).filter(
              (_, i) => i !== found.index,
            ),
          },
          keyPositions: removeAt(
            base.keyPositions as unknown as LooseRecord,
            found.mode,
            found.index,
          ) as never,
        };
      }
      const field = COLLECTION_FIELDS[type];
      const found = findInRecord(base[field] as unknown as LooseRecord, id);
      if (!found) return null;
      return {
        schemaVersion: 1,
        [field]: removeAt(
          base[field] as unknown as LooseRecord,
          found.mode,
          found.index,
        ),
      } as EditorPatchV1;
    }),
  ).then(
    () => true,
    (error) => {
      console.error('Failed to commit element deletion', error);
      return true;
    },
  );
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

  return enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.commitGeneratedPatch((base: EditorDocumentV1) => {
      // 이미 같은 id가 들어가 있으면(이중 실행) 재추가 금지
      if (findInRecord(base.keyPositions as unknown as LooseRecord, newId)) {
        return null;
      }
      return {
        schemaVersion: 1,
        keys: {
          ...base.keys,
          [mode]: [...(base.keys[mode] ?? []), frozenSlot as never],
        },
        keyPositions: {
          ...base.keyPositions,
          [mode]: [...(base.keyPositions[mode] ?? []), newPosition],
        } as never,
      };
    }),
  ).then(
    () => true,
    (error) => {
      console.error('Failed to commit key duplication', error);
      return true;
    },
  );
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

const applyZOrderEagerly = (patch: EditorPatchV1): void => {
  if (patch.keyPositions) {
    useKeyStore.getState().setPositions(patch.keyPositions as never);
  }
  if (patch.statPositions) {
    useStatItemStore.getState().setPositions(patch.statPositions as never);
  }
  if (patch.graphPositions) {
    useGraphItemStore.getState().setPositions(patch.graphPositions as never);
  }
  if (patch.knobPositions) {
    useKnobItemStore.getState().setPositions(patch.knobPositions as never);
  }
};

export const applyZOrderByIds = (
  targets: readonly ZOrderTarget[],
  direction: 'front' | 'back',
  externalZIndexes: readonly number[] = [],
): Promise<number> => {
  const eager = computeZOrderPatch(
    storeDocumentSnapshot(),
    targets,
    direction,
    externalZIndexes,
  );
  if (eager.patch) applyZOrderEagerly(eager.patch);

  let applied = 0;
  return enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.commitGeneratedPatch((base) => {
      const generated = computeZOrderPatch(
        base,
        targets,
        direction,
        externalZIndexes,
      );
      applied = generated.applied;
      return generated.patch;
    }),
  ).then(
    () => applied,
    (error) => {
      console.error('Failed to commit z-order change', error);
      return applied;
    },
  );
};

// 키 슬롯 재바인딩: keys만 바꾸되 대상은 paired 위치의 안정 id로 재결합한다.
// index 기반 keys 단독 커밋은 same-shape 재정렬과 겹치면 다른 위치 id와
// 잘못 결합된다
export const rebindKeySlotById = (
  positionId: string,
  newSlot: unknown,
): Promise<boolean> => {
  if (!positionId) return Promise.resolve(false);
  const locator = resolveElementById('key', positionId);
  if (!locator) return Promise.resolve(false);

  const state = useKeyStore.getState();
  state.setKeyMappings({
    ...state.keyMappings,
    [locator.mode]: (state.keyMappings[locator.mode] ?? []).map((slot, i) =>
      i === locator.index ? newSlot : slot,
    ),
  } as never);

  return enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.commitGeneratedPatch((base) => {
      const found = findInRecord(
        base.keyPositions as unknown as LooseRecord,
        positionId,
      );
      if (!found) return null;
      return {
        schemaVersion: 1,
        keys: {
          ...base.keys,
          [found.mode]: (base.keys[found.mode] ?? []).map((slot, i) =>
            i === found.index ? newSlot : slot,
          ),
        } as never,
      };
    }),
  ).then(
    () => true,
    (error) => {
      console.error('Failed to commit key slot rebinding', error);
      return true;
    },
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
  return enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.commitGeneratedPatch(
      (base) => {
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
        return touchedAny ? patch : null;
      },
      gestureId ? { gestureId } : undefined,
    ),
  ).then(
    () => applied,
    (error) => {
      console.error('Failed to commit selection geometry', error);
      return applied;
    },
  );
};
