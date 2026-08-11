import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import { resolveElementById } from '../model/elementIdMap';
import { persistPositionsWithFlag } from './persistState';

import type { NativeElementType } from '../model/elementIdMap';
import type { KeyPosition } from '@src/types/key/keys';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { StatItemPosition } from '@src/types/key/statItems';

// 비동기 완료 전용 mode-aware 쓰기.
//
// 파일 대화상자·편집기를 기다리는 사이 배열 재정렬이나 모드 전환이 일어나도
// id로 현재 (mode, index)를 다시 찾아 그 요소에만 적용한다. 계약(§8)상 검사는
// type 일치(per-type 조회)뿐이고, 조회 실패(삭제·미등록)는 쓰지 않는다.
//
// 게스처와 결합하지 않는다 - settleCommit은 무관한 활성 게스처를 정산해 버리고,
// gestureId 연결은 이 완료를 남의 히스토리 엔트리에 병합한다. 쓰기 자체는
// 기존 API 경로를 타므로 write barrier 등록은 그대로 유지된다

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

type ElementWriter = (
  mode: string,
  index: number,
  updater: ElementPatchUpdater,
) => boolean;

const writeKey: ElementWriter = (mode, index, updater) => {
  const state = useKeyStore.getState();
  const list = state.canonicalPositions[mode] ?? [];
  const current = list[index];
  if (!current) return false;
  const next = {
    ...state.canonicalPositions,
    [mode]: list.map((position, i) =>
      i === index ? mergePosition(position, updater) : position,
    ),
  };
  void persistPositionsWithFlag(
    next,
    state.setPositions,
    state.setLocalUpdateInProgress,
  );
  return true;
};

interface ItemStoreLike<T extends KeyPosition> {
  positions: Record<string, T[]>;
  setPositions: (positions: Record<string, T[]>) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

const writeItem =
  <T extends KeyPosition>(
    readStore: () => ItemStoreLike<T>,
    persist: (positions: Record<string, T[]>) => Promise<unknown>,
    label: string,
  ): ElementWriter =>
  (mode, index, updater) => {
    const state = readStore();
    const list = state.positions[mode] ?? [];
    const current = list[index];
    if (!current) return false;
    const next = {
      ...state.positions,
      [mode]: list.map((position, i) =>
        i === index ? mergePosition(position, updater) : position,
      ),
    };
    state.setLocalUpdateInProgress(true);
    state.setPositions(next);
    persist(next)
      .catch((error) => {
        console.error(`Failed to apply ${label} element patch`, error);
      })
      .finally(() => {
        state.setLocalUpdateInProgress(false);
      });
    return true;
  };

const writers: Record<NativeElementType, ElementWriter> = {
  key: writeKey,
  stat: writeItem<StatItemPosition>(
    () => useStatItemStore.getState(),
    (positions) => window.api.statItems.updatePositions(positions),
    'stat',
  ),
  graph: writeItem<GraphItemPosition>(
    () => useGraphItemStore.getState(),
    (positions) => window.api.graphItems.updatePositions(positions),
    'graph',
  ),
  knob: writeItem<KnobItemPosition>(
    () => useKnobItemStore.getState(),
    (positions) => window.api.knobItems.updatePositions(positions),
    'knob',
  ),
};

// 반환 false = 요소 없음(삭제·미등록). 호출부는 연결만 조용히 중단한다
export const applyElementPatchById = (
  type: NativeElementType,
  id: string,
  updater: ElementPatchUpdater,
): boolean => {
  if (!id) return false;
  const locator = resolveElementById(type, id);
  if (!locator) return false;
  return writers[type](locator.mode, locator.index, updater);
};
