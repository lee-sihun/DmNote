import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import { stableStringify } from '@utils/core/stableStringify';

import { enqueueEditorCompatibilityOperation } from './editorCompatibilityQueue';
import { editorCoordinator } from './editorStateCoordinator';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';

import type { NativeElementType } from '../model/elementIdMap';

// 요소 의도 커밋 러너: eager 낙관 반영과 wire 생성·실패 복원의 소유권을
// 한 곳에 고정한다.
//
// 롤백 판별은 오류의 retryable 여부가 아니라 intent의 편입 단계다:
// - notGenerated(선행 pending drain 실패, start 실패, generator·검증 throw):
//   어떤 기존 복원 경로도 이 intent를 모른다 - receipt로 즉시 복원
// - generatedNull(대상 소실): 커밋·이벤트가 없어 eager가 잔존한다 - 복원
// - 편입 후: transient는 pendingLocal 재시도가, 영구 거절은
//   discardRejectedPending의 lastAck 전체 적용이 소유한다 - 복원 금지
//
// 한계(잔여 기록): legacy full-record writer가 eager 값을 사전 캡처해 두면
// 복원 후 재커밋으로 부활할 수 있다. 보증은 "즉시 로컬 복원"까지다

export interface ElementIntentReceipt {
  rollback: () => void;
}

// 생성 결과 3상태: patch = 커밋할 변경 / satisfied = 의도가 이미 canonical에
// 반영됨(다른 writer가 먼저 달성 - 롤백하면 lastAck와 반대로 발산) /
// targetLost = 대상 소실(커밋·이벤트가 없어 eager 잔존 - 복원)
export type ElementIntentGeneration =
  | { kind: 'patch'; patch: EditorPatchV1 }
  | { kind: 'satisfied' }
  | { kind: 'targetLost' };

export const intentPatch = (
  patch: EditorPatchV1 | null,
): ElementIntentGeneration =>
  patch === null ? { kind: 'targetLost' } : { kind: 'patch', patch };

export interface ElementIntentResult {
  committed: boolean;
  // satisfied = 커밋 없이 의도 달성 (호출자 성공 판정용)
  satisfied: boolean;
  document: EditorDocumentV1 | null;
}

// destructive 의도의 전체 중단 sentinel - generator 평가는 coordinator의
// inFlight 등록·낙관 적용 전이라 throw가 상태를 남기지 않고, mixed에서는
// transaction callback(plugin 커밋)까지 실행을 막는다. 러너가 잡아서
// receipt 복원 + skip 관측 후 정상 resolve한다
export class ElementIntentAbort extends Error {
  constructor(reason: string) {
    super(`element intent aborted: ${reason}`);
    this.name = 'ElementIntentAbort';
  }
}

export const isElementIntentAbort = (
  error: unknown,
): error is ElementIntentAbort =>
  error instanceof Error && error.name === 'ElementIntentAbort';

export const runElementIntent = async (options: {
  applyEager: () => ElementIntentReceipt | null;
  generate: (base: EditorDocumentV1) => ElementIntentGeneration;
  gestureId?: string;
  // eager receipt를 실제로 되돌린 시점에만 불린다. editor 밖 authority 쓰기를
  // 같이 되돌려야 하는 호출부가 편입 전/후 정책을 러너와 일치시키는 용도
  onRolledBack?: () => void;
}): Promise<ElementIntentResult> => {
  const receipt = options.applyEager();
  let enrolled = false;
  let lastKind: ElementIntentGeneration['kind'] | null = null;
  const rollback = () => {
    receipt?.rollback();
    options.onRolledBack?.();
  };
  try {
    const document = await enqueueEditorCompatibilityOperation(() =>
      editorCoordinator.commitGeneratedPatch(
        (base) => {
          const generation = options.generate(base);
          lastKind = generation.kind;
          return generation.kind === 'patch' ? generation.patch : null;
        },
        {
          ...(options.gestureId ? { gestureId: options.gestureId } : {}),
          onEnrolled: () => {
            enrolled = true;
          },
        },
      ),
    );
    if (lastKind === 'targetLost') {
      rollback();
      return { committed: false, satisfied: false, document: null };
    }
    if (lastKind === 'satisfied') {
      return { committed: false, satisfied: true, document: null };
    }
    return { committed: true, satisfied: true, document };
  } catch (error) {
    if (!enrolled) rollback();
    if (isElementIntentAbort(error) && !enrolled) {
      // 전체 중단은 오류가 아니라 fail-closed 무커밋
      return { committed: false, satisfied: false, document: null };
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// 속성 의도 receipt: (type, id)별 필드 patch를 eager 적용하고, 필드 단위
// before/expected를 기록해 CAS 복원한다. 이후 다른 writer가 같은 필드를
// 다른 값으로 바꿨으면 그 필드는 소유권 밖이라 건드리지 않는다
// ---------------------------------------------------------------------------

type LooseRecord = Record<
  string,
  Array<{ id?: string } & Record<string, unknown>>
>;

export type PropertyIntents = ReadonlyMap<
  NativeElementType,
  ReadonlyMap<string, Record<string, unknown>>
>;

const readRecord = (type: NativeElementType): LooseRecord =>
  (type === 'key'
    ? useKeyStore.getState().canonicalPositions
    : type === 'stat'
    ? useStatItemStore.getState().positions
    : type === 'graph'
    ? useGraphItemStore.getState().positions
    : useKnobItemStore.getState().positions) as LooseRecord;

const writeRecord = (type: NativeElementType, next: LooseRecord): void => {
  if (type === 'key') {
    useKeyStore.getState().setPositions(next as never);
  } else if (type === 'stat') {
    useStatItemStore.getState().setPositions(next as never);
  } else if (type === 'graph') {
    useGraphItemStore.getState().setPositions(next as never);
  } else {
    useKnobItemStore.getState().setPositions(next as never);
  }
};

export interface PropertyReceiptEntry {
  type: NativeElementType;
  id: string;
  field: string;
  before: unknown;
  expected: unknown;
}

// id 키 필드 CAS receipt - eager 적용과 분리해 before를 외부 기준
// (coordinator lastAck 등)으로 구성하는 호출자도 재사용한다
export const createPropertyReceipt = (
  entries: PropertyReceiptEntry[],
): ElementIntentReceipt | null => {
  if (entries.length === 0) return null;
  return {
    rollback: () => {
      const byType = new Map<NativeElementType, PropertyReceiptEntry[]>();
      for (const entry of entries) {
        const group = byType.get(entry.type) ?? [];
        group.push(entry);
        byType.set(entry.type, group);
      }
      for (const [type, group] of byType) {
        const record = readRecord(type);
        let touched = false;
        const next: LooseRecord = {};
        for (const [mode, list] of Object.entries(record)) {
          next[mode] = list.map((position) => {
            const id = position.id;
            if (typeof id !== 'string') return position;
            const owned = group.filter((entry) => entry.id === id);
            if (owned.length === 0) return position;
            let restored = position;
            for (const entry of owned) {
              // CAS: 우리가 쓴 값 그대로일 때만 복원
              if (restored[entry.field] !== entry.expected) continue;
              touched = true;
              restored = { ...restored, [entry.field]: entry.before };
            }
            return restored;
          });
        }
        if (touched) writeRecord(type, next);
      }
    },
  };
};

// 여러 receipt를 역순 롤백 하나로 결합
export const combineReceipts = (
  ...receipts: Array<ElementIntentReceipt | null>
): ElementIntentReceipt | null => {
  const active = receipts.filter(
    (receipt): receipt is ElementIntentReceipt => receipt !== null,
  );
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  return {
    rollback: () => {
      for (const receipt of [...active].reverse()) receipt.rollback();
    },
  };
};

export const applyPropertyIntentsEagerly = (
  intents: PropertyIntents,
): ElementIntentReceipt | null => {
  const entries: PropertyReceiptEntry[] = [];

  for (const [type, byId] of intents) {
    const record = readRecord(type);
    let touched = false;
    const next: LooseRecord = {};
    for (const [mode, list] of Object.entries(record)) {
      next[mode] = list.map((position) => {
        const id = position.id;
        if (typeof id !== 'string') return position;
        const patch = byId.get(id);
        if (!patch) return position;
        touched = true;
        for (const [field, expected] of Object.entries(patch)) {
          entries.push({
            type,
            id,
            field,
            before: position[field],
            expected,
          });
        }
        return { ...position, ...patch, id };
      });
    }
    if (touched) writeRecord(type, next);
  }

  return createPropertyReceipt(entries);
};

// 최신 base에서 속성 의도를 재적용하는 표준 generator
export const generatePropertyIntentPatch = (
  base: EditorDocumentV1,
  intents: PropertyIntents,
): EditorPatchV1 | null => {
  const FIELD_BY_TYPE: Record<
    NativeElementType,
    'keyPositions' | 'statPositions' | 'graphPositions' | 'knobPositions'
  > = {
    key: 'keyPositions',
    stat: 'statPositions',
    graph: 'graphPositions',
    knob: 'knobPositions',
  };
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
        if (typeof id !== 'string') return position;
        const intentPatch = byId.get(id);
        if (!intentPatch) return position;
        touched += 1;
        return { ...position, ...intentPatch, id };
      });
    }
    if (touched > 0) {
      patch[field] = next as never;
      touchedAny = true;
    }
  }
  return touchedAny ? patch : null;
};

// UI fire-and-forget 경계용: 상태 정합은 receipt·pending 경로가 소유하므로
// 호출부는 기록만 한다. 오류를 성공으로 둔갑시키던 내부 삼킴과 달리
// 프로그램적 호출자는 원 promise로 실패를 받을 수 있다
export const reportElementOpError = (error: unknown): void => {
  console.error('Element operation failed', error);
};

// fail-closed 무커밋은 오류가 아니라 정상 resolve - 별도 관측 경로
export const reportElementOpSkipped = (context: string): void => {
  console.warn('Element operation skipped (fail-closed)', context);
};

// ---------------------------------------------------------------------------
// 합성 index 의도: 안정 id가 없는 요소는 게스처 시작 시점의 컬렉션 구조
// fingerprint와 index를 함께 동결하고, 이후 모든 적용(eager·wire 생성)을
// "구조가 시작과 정확히 같다"는 증명 아래에서만 수행한다. 완료 시점 캡처는
// 시작과 완료 사이에 정산된 외부 재정렬을 통과시키므로 금지
// ---------------------------------------------------------------------------

export type IndexBaselineField =
  | 'keys'
  | 'keyPositions'
  | 'statPositions'
  | 'graphPositions'
  | 'knobPositions'
  | 'layerGroups';

export interface IndexIntentBaseline {
  mode: string;
  fields: readonly IndexBaselineField[];
  // 시작 시점 mode 한정 스냅샷 - fingerprint 비교와 receipt before 값의 원천
  slices: Partial<Record<IndexBaselineField, unknown>>;
  fingerprint: string;
}

const POSITION_FIELD_BY_TYPE: Record<
  NativeElementType,
  Extract<
    IndexBaselineField,
    'keyPositions' | 'statPositions' | 'graphPositions' | 'knobPositions'
  >
> = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
};

const sliceOf = (
  document: Record<string, unknown>,
  field: IndexBaselineField,
  mode: string,
): unknown => (document[field] as Record<string, unknown> | undefined)?.[mode];

const fingerprintOf = (
  slices: Partial<Record<IndexBaselineField, unknown>>,
  fields: readonly IndexBaselineField[],
): string =>
  stableStringify(fields.map((field) => [field, slices[field] ?? null]));

// 게스처 시작 시점에 coordinator lastAck 문서로 호출한다.
// document가 없으면(start 전) baseline 없음 - 합성 경로는 무커밋 fail-closed
export const captureIndexIntentBaseline = (
  document: unknown,
  mode: string,
  fields: readonly IndexBaselineField[],
): IndexIntentBaseline | null => {
  if (!document || typeof document !== 'object') return null;
  const slices: Partial<Record<IndexBaselineField, unknown>> = {};
  for (const field of fields) {
    slices[field] = structuredClone(
      sliceOf(document as Record<string, unknown>, field, mode),
    );
  }
  return {
    mode,
    fields,
    slices,
    fingerprint: fingerprintOf(slices, fields),
  };
};

export type IndexIntents = ReadonlyMap<
  NativeElementType,
  ReadonlyMap<number, Record<string, unknown>>
>;

export const indexBaselineMatches = (
  baseline: IndexIntentBaseline,
  document: Record<string, unknown>,
): boolean => {
  const slices: Partial<Record<IndexBaselineField, unknown>> = {};
  for (const field of baseline.fields) {
    slices[field] = sliceOf(document, field, baseline.mode);
  }
  return fingerprintOf(slices, baseline.fields) === baseline.fingerprint;
};

// 스토어 측 문서 뷰 - baseline의 모든 필드(keys·layerGroups 포함)를
// 표현해야 한다. 일부만 비교하면 key pair·그룹 구조 변경이 eager를 통과한다
const storeDocumentView = (): Record<string, unknown> => ({
  keys: useKeyStore.getState().keyMappings,
  keyPositions: useKeyStore.getState().canonicalPositions,
  statPositions: useStatItemStore.getState().positions,
  graphPositions: useGraphItemStore.getState().positions,
  knobPositions: useKnobItemStore.getState().positions,
  layerGroups: useLayerGroupStore.getState().layerGroups,
});

const storeFingerprintOf = (baseline: IndexIntentBaseline): string => {
  const document = storeDocumentView();
  const slices: Partial<Record<IndexBaselineField, unknown>> = {};
  for (const field of baseline.fields) {
    slices[field] = sliceOf(document, field, baseline.mode);
  }
  return fingerprintOf(slices, baseline.fields);
};

export interface IndexEagerResult {
  // false = 시작 구조와 스토어 불일치 또는 baseline 부재 - 호출자는 이
  // intent 전체(eager·wire)를 fail-closed 무커밋해야 한다
  matched: boolean;
  receipt: ElementIntentReceipt | null;
}

interface IndexEagerEntry {
  type: NativeElementType;
  index: number;
  field: string;
  before: unknown;
}

// index 쓰기만 수행 - fingerprint 봉인은 호출자가 모든 eager를 마친 뒤 한다
const applyIndexWrites = (
  baseline: IndexIntentBaseline,
  intents: IndexIntents,
): IndexEagerEntry[] => {
  const entries: IndexEagerEntry[] = [];
  for (const [type, byIndex] of intents) {
    const record = readRecord(type);
    const list = record[baseline.mode];
    if (!list) continue;
    let touched = false;
    const nextList = list.map((position, index) => {
      const patch = byIndex.get(index);
      if (!patch) return position;
      touched = true;
      const baselineList = baseline.slices[POSITION_FIELD_BY_TYPE[type]] as
        | Array<Record<string, unknown>>
        | undefined;
      for (const field of Object.keys(patch)) {
        entries.push({
          type,
          index,
          field,
          before: baselineList?.[index]?.[field],
        });
      }
      return { ...position, ...patch, id: position.id };
    });
    if (touched) {
      writeRecord(type, { ...record, [baseline.mode]: nextList });
    }
  }
  return entries;
};

// 봉인 시점의 스토어 상태와 정확히 같을 때만 복원 - 값 CAS는 재정렬 후
// 우연히 같은 값을 가진 다른 요소를 오염시킬 수 있어 신원 증명이 못 된다
const sealIndexReceipt = (
  baseline: IndexIntentBaseline,
  entries: IndexEagerEntry[],
): ElementIntentReceipt => {
  const sealedFingerprint = storeFingerprintOf(baseline);
  return {
    rollback: () => {
      if (storeFingerprintOf(baseline) !== sealedFingerprint) return;
      const byType = new Map<NativeElementType, IndexEagerEntry[]>();
      for (const entry of entries) {
        const group = byType.get(entry.type) ?? [];
        group.push(entry);
        byType.set(entry.type, group);
      }
      for (const [type, group] of byType) {
        const record = readRecord(type);
        const list = record[baseline.mode];
        if (!list) continue;
        const nextList = list.map((position, index) => {
          const owned = group.filter((entry) => entry.index === index);
          if (owned.length === 0) return position;
          let restored = position;
          for (const entry of owned) {
            restored = { ...restored, [entry.field]: entry.before };
          }
          return restored;
        });
        writeRecord(type, { ...record, [baseline.mode]: nextList });
      }
    },
  };
};

// 게스처 eager 단일 소유: preflight 게이트 → stable id eager → 합성 index
// eager → 최종 상태에서 fingerprint 한 번 봉인 → 결합 receipt.
// 봉인을 중간에 하면 뒤따르는 stable eager가 같은 슬라이스를 바꿔 합성
// receipt의 신원 검사가 자기 자신을 외부 개입으로 오판한다.
// rollback은 index(봉인 상태 증명 필요)가 먼저, stable CAS가 나중
export const applyGestureIntentsEagerly = (options: {
  baseline: IndexIntentBaseline | null;
  indexIntents: IndexIntents;
  propertyIntents?: PropertyIntents;
}): IndexEagerResult => {
  const hasIndex = options.indexIntents.size > 0;
  if (hasIndex) {
    const baseline = options.baseline;
    if (!baseline || storeFingerprintOf(baseline) !== baseline.fingerprint) {
      return { matched: false, receipt: null };
    }
  }
  const propertyReceipt =
    options.propertyIntents && options.propertyIntents.size > 0
      ? applyPropertyIntentsEagerly(options.propertyIntents)
      : null;
  let indexReceipt: ElementIntentReceipt | null = null;
  if (hasIndex && options.baseline) {
    const entries = applyIndexWrites(options.baseline, options.indexIntents);
    if (entries.length > 0) {
      indexReceipt = sealIndexReceipt(options.baseline, entries);
    }
  }
  return {
    matched: true,
    // 역순 롤백: index 먼저(봉인 상태 그대로일 때), stable CAS 나중
    receipt: combineReceipts(propertyReceipt, indexReceipt),
  };
};

// 순수 합성 경로용 - 결합 applier의 property 없는 특수형
export const applyIndexIntentsEagerly = (
  baseline: IndexIntentBaseline | null,
  intents: IndexIntents,
): IndexEagerResult =>
  applyGestureIntentsEagerly({ baseline, indexIntents: intents });

// 슬롯 base가 시작 baseline과 정확히 일치할 때만 index 적용 patch를 생성.
// 불일치·baseline 부재는 null - 호출자는 targetLost(무커밋)로 다룬다
export const generateIndexIntentPatch = (
  base: EditorDocumentV1,
  baseline: IndexIntentBaseline | null,
  intents: IndexIntents,
  // 결합 generator가 base에서 fingerprint를 이미 검증하고 자기 의도를
  // 먼저 적용한 문서를 넘길 때만 true - 단독 사용 금지
  options?: { skipFingerprint?: boolean },
): EditorPatchV1 | null => {
  if (!baseline) return null;
  if (
    !options?.skipFingerprint &&
    !indexBaselineMatches(baseline, base as unknown as Record<string, unknown>)
  ) {
    return null;
  }
  const patch: EditorPatchV1 = { schemaVersion: 1 };
  let touchedAny = false;
  for (const [type, byIndex] of intents) {
    const field = POSITION_FIELD_BY_TYPE[type];
    const record = base[field] as unknown as LooseRecord;
    const list = record[baseline.mode];
    if (!list) continue;
    let touched = false;
    const nextList = list.map((position, index) => {
      const intentPatchFields = byIndex.get(index);
      if (!intentPatchFields) return position;
      touched = true;
      return { ...position, ...intentPatchFields, id: position.id };
    });
    if (touched) {
      patch[field] = { ...record, [baseline.mode]: nextList } as never;
      touchedAny = true;
    }
  }
  return touchedAny ? patch : null;
};

// ---------------------------------------------------------------------------
// 봉인 구조 변경 receipt: 삭제·paste처럼 배열 구조 자체가 바뀌는 eager는
// 필드 CAS로 복원할 수 없다. 변경 전 mode 슬라이스를 통째로 캡처하고,
// 적용 직후 상태를 봉인해 "우리 이후 아무도 개입하지 않았다"가 증명될 때만
// 캡처본을 통복원한다. 외부 개입 시 복원 포기(보수적 소유권)
// ---------------------------------------------------------------------------

export const readFieldRecord = (
  field: IndexBaselineField,
): Record<string, unknown> =>
  (field === 'keys'
    ? useKeyStore.getState().keyMappings
    : field === 'keyPositions'
    ? useKeyStore.getState().canonicalPositions
    : field === 'statPositions'
    ? useStatItemStore.getState().positions
    : field === 'graphPositions'
    ? useGraphItemStore.getState().positions
    : field === 'knobPositions'
    ? useKnobItemStore.getState().positions
    : useLayerGroupStore.getState().layerGroups) as Record<string, unknown>;

export const writeFieldModeSlices = (
  field: IndexBaselineField,
  slices: ReadonlyMap<string, unknown>,
): void => {
  const merged = { ...readFieldRecord(field) };
  for (const [mode, slice] of slices) {
    if (slice === undefined) {
      delete merged[mode];
    } else {
      merged[mode] = slice;
    }
  }
  if (field === 'keys') {
    useKeyStore.getState().setKeyMappings(merged as never);
  } else if (field === 'keyPositions') {
    useKeyStore.getState().setPositions(merged as never);
  } else if (field === 'statPositions') {
    useStatItemStore.getState().setPositions(merged as never);
  } else if (field === 'graphPositions') {
    useGraphItemStore.getState().setPositions(merged as never);
  } else if (field === 'knobPositions') {
    useKnobItemStore.getState().setPositions(merged as never);
  } else {
    useLayerGroupStore.getState().setLayerGroups(merged as never);
  }
};

export const editorSliceFingerprint = (
  modes: readonly string[],
  fields: readonly IndexBaselineField[],
): string =>
  stableStringify(
    fields.map((field) => {
      const record = readFieldRecord(field);
      return [field, modes.map((mode) => [mode, record[mode] ?? null])];
    }),
  );

// mutate(스토어 eager 적용)를 감싸 before 캡처와 봉인을 한 소유 단위로 묶는다
export const applySealedSliceMutation = (options: {
  modes: readonly string[];
  fields: readonly IndexBaselineField[];
  mutate: () => void;
}): ElementIntentReceipt => {
  const before = new Map<IndexBaselineField, Map<string, unknown>>();
  for (const field of options.fields) {
    const record = readFieldRecord(field);
    const byMode = new Map<string, unknown>();
    for (const mode of options.modes) {
      byMode.set(mode, structuredClone(record[mode]));
    }
    before.set(field, byMode);
  }
  try {
    options.mutate();
  } catch (error) {
    // 부분 적용 잔존 방지 - 캡처본으로 즉시 복원 후 원 오류 전파
    for (const [field, byMode] of before) {
      writeFieldModeSlices(field, byMode);
    }
    throw error;
  }
  const sealedFingerprint = editorSliceFingerprint(
    options.modes,
    options.fields,
  );
  return {
    rollback: () => {
      if (
        editorSliceFingerprint(options.modes, options.fields) !==
        sealedFingerprint
      ) {
        return;
      }
      // keys와 keyPositions는 index 결합 - 함께 복원되도록 필드 순회가
      // 두 필드를 모두 포함해야 한다 (호출자가 fields에 pair를 넣는다)
      for (const [field, byMode] of before) {
        writeFieldModeSlices(field, byMode);
      }
    },
  };
};
