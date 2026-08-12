import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

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

export const runElementIntent = async (options: {
  applyEager: () => ElementIntentReceipt | null;
  generate: (base: EditorDocumentV1) => ElementIntentGeneration;
  gestureId?: string;
}): Promise<ElementIntentResult> => {
  const receipt = options.applyEager();
  let enrolled = false;
  let lastKind: ElementIntentGeneration['kind'] | null = null;
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
      receipt?.rollback();
      return { committed: false, satisfied: false, document: null };
    }
    if (lastKind === 'satisfied') {
      return { committed: false, satisfied: true, document: null };
    }
    return { committed: true, satisfied: true, document };
  } catch (error) {
    if (!enrolled) receipt?.rollback();
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

interface PropertyReceiptEntry {
  type: NativeElementType;
  id: string;
  field: string;
  before: unknown;
  expected: unknown;
}

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
