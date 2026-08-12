import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import type { KeyPosition } from '@src/types/key/keys';

export type NativeElementType = 'key' | 'stat' | 'graph' | 'knob';

// 무ID 구형 요소의 합성 신원(`${type}-${index}`). 안정 ID처럼 다루면
// 조회가 항상 실패해 legacy 폴백까지 막힌다
export const isSyntheticElementId = (id: string): boolean =>
  /^(key|stat|graph|knob)-\d+$/.test(id);

export interface ElementLocator {
  type: NativeElementType;
  mode: string;
  index: number;
}

type PositionsRecord = Record<string, readonly KeyPosition[]> | undefined;

// 권위 컬렉션만 읽는다. 키의 렌더 positions는 canonical + 프리뷰 합성이라
// 조회 기준으로 쓰면 프리뷰 재합성 타이밍에 따라 결과가 흔들린다
const authorityRecords = (): Record<NativeElementType, PositionsRecord> => ({
  key: useKeyStore.getState().canonicalPositions,
  stat: useStatItemStore.getState().positions,
  graph: useGraphItemStore.getState().positions,
  knob: useKnobItemStore.getState().positions,
});

interface CacheEntry {
  source: PositionsRecord;
  byId: Map<string, ElementLocator>;
}

// live 참조 기준 lazy cache. canonical 이벤트에서만 재구축하면 낙관 변경 직후
// stale해진다 - 배열 record 참조가 바뀌었을 때만 그 타입을 다시 인덱싱한다
const cache = new Map<NativeElementType, CacheEntry>();

const indexRecord = (
  type: NativeElementType,
  source: PositionsRecord,
): Map<string, ElementLocator> => {
  const byId = new Map<string, ElementLocator>();
  if (!source) return byId;
  for (const [mode, positions] of Object.entries(source)) {
    positions.forEach((position, index) => {
      const id = position?.id;
      if (typeof id === 'string' && id.length > 0) {
        byId.set(id, { type, mode, index });
      }
    });
  }
  return byId;
};

const lookupIn = (
  type: NativeElementType,
  source: PositionsRecord,
  id: string,
): ElementLocator | null => {
  const cached = cache.get(type);
  if (!cached || cached.source !== source) {
    cache.set(type, { source, byId: indexRecord(type, source) });
  }
  return cache.get(type)!.byId.get(id) ?? null;
};

// id로 요소의 현재 위치를 찾는다. 없으면 null - 요소가 삭제된 것이므로
// 비동기 완료는 연결만 조용히 중단한다
export const resolveElementById = (
  type: NativeElementType,
  id: string,
): ElementLocator | null => {
  if (!id) return null;
  return lookupIn(type, authorityRecords()[type], id);
};

// 여러 타입에 걸쳐 조회. id는 전역 유일이라 최대 한 곳에서만 발견된다
export const resolveElementByIdAcross = (
  types: readonly NativeElementType[],
  id: string,
): ElementLocator | null => {
  for (const type of types) {
    const hit = resolveElementById(type, id);
    if (hit) return hit;
  }
  return null;
};
