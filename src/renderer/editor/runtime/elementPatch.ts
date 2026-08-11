import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import { resolveElementById } from '../model/elementIdMap';
import { enqueueEditorCompatibilityWrite } from './editorCompatibilityQueue';
import { editorCoordinator } from './editorStateCoordinator';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';

import type { NativeElementType } from '../model/elementIdMap';
import type { KeyPosition } from '@src/types/key/keys';

// 비동기 완료 전용 mode-aware 쓰기.
//
// 파일 대화상자·편집기를 기다리는 사이 배열 재정렬이나 모드 전환이 일어나도
// id로 요소를 다시 찾아 그 요소에만 적용한다. 계약(§8)상 검사는 type 일치
// (per-type 조회)뿐이고, 조회 실패(삭제·미등록)는 쓰지 않는다.
//
// 쓰기는 두 단계로 나뉜다. 클릭 시점에 Zustand에 즉시 반영해 이후의
// full-record 캡처가 이 값을 포함하게 하고, wire patch는 coordinator의
// 직렬 슬롯 안에서 최신 문서를 받아 다시 생성한다. 호출 시점에 캡처한
// 컬렉션 레코드를 그대로 보내면 대기 중 정산된 다른 커밋(게스처 경계
// 정산, 플러그인 격리 커밋)의 같은 컬렉션 값을 통째로 되돌린다.
//
// 게스처와 결합하지 않는다 - settleCommit은 무관한 활성 게스처를 정산해
// 버리고, gestureId 연결은 이 완료를 남의 히스토리 엔트리에 병합한다

// 동기·순수·멱등 계약: eager 반영과 wire 생성에서 요소마다 두 번 실행될 수
// 있고, 두 실행의 current가 다를 수 있다(대기 중 다른 커밋 정산). 외부
// 부작용이나 비멱등 연산을 넣지 말 것
export type ElementPatchUpdater = (
  current: Readonly<KeyPosition>,
) => Omit<Partial<KeyPosition>, 'id'>;

// updater가 어떤 patch를 만들거나 입력을 직접 변조해도 신원은 불변.
// updater 실행 전에 id를 캡처해야 직접 mutation까지 막힌다
const mergePosition = <T extends KeyPosition>(
  current: T,
  updater: ElementPatchUpdater,
): T => {
  const id = current.id;
  const patch = updater(current);
  return { ...current, ...patch, id };
};

// 배치 완료용 시작 시점 ID 집합 (피커 open 시 캡처, close까지 불변)
export interface ElementIdSelection {
  key?: readonly string[];
  stat?: readonly string[];
  graph?: readonly string[];
  knob?: readonly string[];
}

const NATIVE_ELEMENT_TYPES: readonly NativeElementType[] = [
  'key',
  'stat',
  'graph',
  'knob',
];

const selectedIdSet = (
  selection: ElementIdSelection,
  type: NativeElementType,
): ReadonlySet<string> | null => {
  const ids = selection[type];
  if (!ids || ids.length === 0) return null;
  const wanted = new Set<string>();
  for (const id of ids) {
    if (id) wanted.add(id);
  }
  return wanted.size > 0 ? wanted : null;
};

// 클릭 시점 즉시 반영. 신원 해석은 현재 스토어 기준 - 이후 재정렬·삭제는
// wire 생성 단계가 최신 문서에서 다시 해석한다
const eagerRecordFor = <T extends KeyPosition>(
  positions: Record<string, T[]>,
  wanted: ReadonlySet<string>,
  type: NativeElementType,
  updater: ElementPatchUpdater,
): Record<string, T[]> | null => {
  const targets = new Map<string, Set<number>>();
  for (const id of wanted) {
    const locator = resolveElementById(type, id);
    if (!locator) continue;
    const indices = targets.get(locator.mode) ?? new Set<number>();
    indices.add(locator.index);
    targets.set(locator.mode, indices);
  }
  if (targets.size === 0) return null;
  const next = { ...positions };
  for (const [mode, indices] of targets) {
    const list = next[mode];
    if (!list) continue;
    next[mode] = list.map((position, index) =>
      indices.has(index) ? mergePosition(position, updater) : position,
    );
  }
  return next;
};

const applyEagerly = (
  selection: ElementIdSelection,
  updater: ElementPatchUpdater,
): void => {
  for (const type of NATIVE_ELEMENT_TYPES) {
    const wanted = selectedIdSet(selection, type);
    if (!wanted) continue;
    if (type === 'key') {
      const state = useKeyStore.getState();
      const next = eagerRecordFor(
        state.canonicalPositions,
        wanted,
        'key',
        updater,
      );
      if (next) state.setPositions(next);
    } else if (type === 'stat') {
      const state = useStatItemStore.getState();
      const next = eagerRecordFor(state.positions, wanted, 'stat', updater);
      if (next) state.setPositions(next);
    } else if (type === 'graph') {
      const state = useGraphItemStore.getState();
      const next = eagerRecordFor(state.positions, wanted, 'graph', updater);
      if (next) state.setPositions(next);
    } else {
      const state = useKnobItemStore.getState();
      const next = eagerRecordFor(state.positions, wanted, 'knob', updater);
      if (next) state.setPositions(next);
    }
  }
};

// 최신 base 문서에서 id를 다시 찾아 적용한다. 스토어 조회(resolveElementById)
// 금지 - 슬롯 진입 전 상태라 대기 중 정산된 재정렬·삭제를 놓친다
const generatedRecordFor = <T extends KeyPosition>(
  positions: Record<string, T[]>,
  wanted: ReadonlySet<string>,
  updater: ElementPatchUpdater,
): { next: Record<string, T[]>; touched: number } => {
  let touched = 0;
  const next: Record<string, T[]> = {};
  for (const [mode, list] of Object.entries(positions)) {
    next[mode] = list.map((position) => {
      if (!position.id || !wanted.has(position.id)) return position;
      touched += 1;
      return mergePosition(position, updater);
    });
  }
  return { next, touched };
};

const generatePatchFrom = (
  base: EditorDocumentV1,
  selection: ElementIdSelection,
  updater: ElementPatchUpdater,
): { patch: EditorPatchV1 | null; applied: number } => {
  const patch: EditorPatchV1 = { schemaVersion: 1 };
  let applied = 0;

  for (const type of NATIVE_ELEMENT_TYPES) {
    const wanted = selectedIdSet(selection, type);
    if (!wanted) continue;
    if (type === 'key') {
      const result = generatedRecordFor(base.keyPositions, wanted, updater);
      if (result.touched > 0) {
        patch.keyPositions = result.next;
        applied += result.touched;
      }
    } else if (type === 'stat') {
      const result = generatedRecordFor(base.statPositions, wanted, updater);
      if (result.touched > 0) {
        patch.statPositions = result.next;
        applied += result.touched;
      }
    } else if (type === 'graph') {
      const result = generatedRecordFor(base.graphPositions, wanted, updater);
      if (result.touched > 0) {
        patch.graphPositions = result.next;
        applied += result.touched;
      }
    } else {
      const result = generatedRecordFor(base.knobPositions, wanted, updater);
      if (result.touched > 0) {
        patch.knobPositions = result.next;
        applied += result.touched;
      }
    }
  }

  return applied === 0 ? { patch: null, applied: 0 } : { patch, applied };
};

// 시작 시점 ID 집합 전체에 한 트랜잭션으로 적용한다. 못 찾는 id(삭제)는
// 건너뛰고, 터치된 컬렉션들을 단일 커밋으로 저장해 결합 원자성(한 커밋 =
// 한 undo 엔트리)을 유지한다. 전원 미발견이면 커밋하지 않는다.
//
// wire 커밋은 다른 first-party writer와 같은 compatibility 큐에 등록한다.
// 큐는 commitPatch 호출 자체를 지연시키므로, 여기서 큐를 건너뛰면 먼저
// 캡처하고 대기 중이던 writer가 나중에 실행되어 이 값을 되돌린다.
//
// 반환 promise는 reject하지 않는다. 값은 wire patch 생성 시점의 대상 수이고
// 저장 성공 보장이 아니다 - 커밋 실패는 write barrier에서 관측된다
export const applyElementPatchesById = (
  selection: ElementIdSelection,
  updater: ElementPatchUpdater,
): Promise<number> => {
  applyEagerly(selection, updater);
  let generated = 0;
  return enqueueEditorCompatibilityWrite(
    () =>
      editorCoordinator.commitGeneratedPatch((base) => {
        const result = generatePatchFrom(base, selection, updater);
        generated = result.applied;
        return result.patch;
      }),
    () => generated,
  ).catch((error) => {
    console.error('Failed to commit element patches', error);
    return generated;
  });
};

// 단일 완료는 배치의 1-ID 호출. false = wire에 실리지 않음(요소 없음 또는
// 생성 전 커밋 경로 실패), 호출부는 연결만 조용히 중단한다
export const applyElementPatchById = (
  type: NativeElementType,
  id: string,
  updater: ElementPatchUpdater,
): Promise<boolean> => {
  if (!id) return Promise.resolve(false);
  return applyElementPatchesById({ [type]: [id] }, updater).then(
    (applied) => applied > 0,
  );
};
