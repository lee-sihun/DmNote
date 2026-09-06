/**
 * 실입력 DOWN edge 채널
 * - 이벤트 이력 기준 상승 전이에만 발화하고, 구독자 하나가 던져도 팬아웃이 이어진다
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyEventKeyState,
  resetAllKeySignals,
  setKeyActive,
  subscribeKeyPressEdge,
} from './keySignals';

describe('subscribeKeyPressEdge', () => {
  afterEach(() => {
    resetAllKeySignals();
    vi.restoreAllMocks();
  });

  it('실입력 상승 전이에만 발화하고 리싱크 세팅은 무시한다', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeKeyPressEdge('KeyA', listener);

    setKeyActive('KeyA', true);
    expect(listener).not.toHaveBeenCalled();

    applyEventKeyState('KeyA', true);
    applyEventKeyState('KeyA', true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    applyEventKeyState('KeyA', false);
    applyEventKeyState('KeyA', true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // 오버레이는 이 호출 직후에 노트 이펙트를 처리한다 - 예외가 새어 나가면
  // 잎 하나 때문에 그 키의 노트가 통째로 사라진다
  it('구독자 예외가 나머지 구독자와 호출자를 끊지 않는다', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const later = vi.fn();
    // resetAllKeySignals는 구독을 걷지 않는다 - 던지는 구독자를 남기면 다음 테스트가 오염된다
    const unsubscribes = [
      subscribeKeyPressEdge('KeyA', () => {
        throw new TypeError('easing');
      }),
      subscribeKeyPressEdge('KeyA', later),
    ];

    expect(() => applyEventKeyState('KeyA', true)).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });
});
