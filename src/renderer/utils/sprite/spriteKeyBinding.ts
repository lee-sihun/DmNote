import type { KeySlot } from '@src/types/key/keys';

import { slotCanonical } from '@utils/keySlot';

// 스프라이트 트리거는 키 요소 id(레인 결합), 눌림 시그널은 canonical 키 문자열.
// keys[i]와 keyPositions[i]는 인덱스 결합이라 같은 i끼리 짝을 만든다
export const buildSpriteKeyCanonicalMap = (
  keys: readonly KeySlot[],
  keyPositions: readonly { id?: string | null }[],
): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  const length = Math.min(keys.length, keyPositions.length);
  for (let i = 0; i < length; i++) {
    const id = keyPositions[i]?.id;
    if (!id) continue;
    const canonical = slotCanonical(keys[i]);
    if (canonical === '') continue;
    map.set(id, canonical);
  }
  return map;
};
