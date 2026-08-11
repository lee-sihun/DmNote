import { beforeEach, describe, expect, it } from 'vitest';

import { resolveElementById, resolveElementByIdAcross } from './elementIdMap';
import { createDefaultKeyPosition } from './keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';

const keyAt = (): KeyPosition => createDefaultKeyPosition();
const statAt = (): StatItemPosition => ({
  ...createDefaultKeyPosition(),
  statType: 'kps',
});

describe('elementIdMap', () => {
  beforeEach(() => {
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [] },
    } as never);
    useStatItemStore.setState({ positions: { '4key': [] } } as never);
  });

  it('id로 현재 (mode, index)를 찾는다', () => {
    const a = keyAt();
    const b = keyAt();
    useKeyStore.setState({
      canonicalPositions: { '4key': [a, b] },
    } as never);

    expect(resolveElementById('key', b.id!)).toEqual({
      type: 'key',
      mode: '4key',
      index: 1,
    });
  });

  it('재정렬 후에도 같은 요소를 찾는다 (live 참조 기준 - 캐시 무효화)', () => {
    const a = keyAt();
    const b = keyAt();
    useKeyStore.setState({
      canonicalPositions: { '4key': [a, b] },
    } as never);
    expect(resolveElementById('key', a.id!)?.index).toBe(0);

    // 낙관 변경으로 배열이 즉시 뒤집혀도 다음 조회가 새 위치를 본다
    useKeyStore.setState({
      canonicalPositions: { '4key': [b, a] },
    } as never);
    expect(resolveElementById('key', a.id!)?.index).toBe(1);
  });

  it('삭제된 id는 null을 돌린다', () => {
    const a = keyAt();
    useKeyStore.setState({ canonicalPositions: { '4key': [a] } } as never);
    expect(resolveElementById('key', a.id!)).not.toBeNull();

    useKeyStore.setState({ canonicalPositions: { '4key': [] } } as never);
    expect(resolveElementById('key', a.id!)).toBeNull();
  });

  it('타입을 넘나들며 조회한다 (id 전역 유일)', () => {
    const s = statAt();
    useStatItemStore.setState({ positions: { '4key': [s] } } as never);

    expect(resolveElementByIdAcross(['key', 'stat'], s.id!)).toEqual({
      type: 'stat',
      mode: '4key',
      index: 0,
    });
  });
});
