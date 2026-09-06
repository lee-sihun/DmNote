import type { NativeElementType } from '../../model/elementIdMap';

export type LooseRecord = Record<
  string,
  Array<{ id: string } & Record<string, unknown>>
>;

export const findInRecord = (
  record: LooseRecord,
  id: string,
): { mode: string; index: number } | null => {
  for (const [mode, list] of Object.entries(record)) {
    const index = list.findIndex((position) => position.id === id);
    if (index >= 0) return { mode, index };
  }
  return null;
};

export const removeAt = (
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

export const FIELD_BY_TYPE: Record<
  NativeElementType,
  | 'keyPositions'
  | 'statPositions'
  | 'graphPositions'
  | 'knobPositions'
  | 'spritePositions'
> = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
  sprite: 'spritePositions',
};
