import { describe, expect, it } from 'vitest';
import {
  applyAnimationIntentMask,
  mergeChangedAnimationFields,
} from '@src/types/key/counterAnimation';

import type { KeyCounterAnimationSettings } from '@src/types/key/keys';

const animation = (
  overrides: Partial<KeyCounterAnimationSettings> = {},
): KeyCounterAnimationSettings => ({
  enabled: true,
  presetId: 'preset-a',
  bezier: [0.25, 0.1, 0.25, 1],
  scale: 1.1,
  durationMs: 300,
  ...overrides,
});

// 비동기 완료가 시작 스냅샷을 통째로 되돌리지 않는지 고정.
// 대기 중 다른 writer가 바꾼 필드는 fresh 값이 살아남아야 한다
describe('mergeChangedAnimationFields', () => {
  it('피커가 바꾼 필드만 fresh 위에 적용한다', () => {
    const start = animation();
    // 대기 중 다른 writer가 enabled를 끔
    const fresh = animation({ enabled: false });
    // 피커는 preset 필드만 변경
    const next = animation({
      presetId: 'preset-b',
      bezier: [0.4, 0, 0.2, 1],
      scale: 1.3,
      durationMs: 500,
    });

    const merged = mergeChangedAnimationFields(fresh, start, next);

    expect(merged.enabled).toBe(false);
    expect(merged.presetId).toBe('preset-b');
    expect(merged.bezier).toEqual([0.4, 0, 0.2, 1]);
    expect(merged.scale).toBe(1.3);
    expect(merged.durationMs).toBe(500);
  });

  it('피커가 바꾼 필드는 동시 변경보다 우선한다', () => {
    const start = animation({ durationMs: 300 });
    const fresh = animation({ durationMs: 400 });
    const next = animation({ durationMs: 500 });

    const merged = mergeChangedAnimationFields(fresh, start, next);

    expect(merged.durationMs).toBe(500);
  });

  it('아무것도 안 바뀌면 fresh를 그대로 돌려준다', () => {
    const start = animation();
    const fresh = animation({ enabled: false, scale: 2 });

    const merged = mergeChangedAnimationFields(fresh, start, animation());

    expect(merged).toEqual(fresh);
  });

  // 배치는 첫 요소 기준값이라 델타가 아니라 intent mask를 쓴다.
  // 혼합 상태(요소마다 preset·duration이 다름)에서 같은 preset을 재선택해
  // 통일하는 동작이 무변경으로 오판되면 안 된다
  describe('applyAnimationIntentMask', () => {
    it('preset 필드는 전부 쓰고 각 요소의 enabled만 보존한다', () => {
      const current = animation({
        enabled: false,
        presetId: 'preset-c',
        durationMs: 500,
      });
      const next = animation({ presetId: 'preset-b', durationMs: 300 });

      const masked = applyAnimationIntentMask(current, next);

      expect(masked.enabled).toBe(false);
      expect(masked.presetId).toBe('preset-b');
      expect(masked.durationMs).toBe(300);
      expect(masked.bezier).toEqual(next.bezier);
      expect(masked.scale).toBe(next.scale);
    });

    it('기준값과 같은 preset을 재선택해도 혼합 요소가 통일된다', () => {
      // 기준(첫 요소)은 이미 preset-a인데 둘째 요소는 preset-c인 혼합 상태
      const mixedSecond = animation({ presetId: 'preset-c', durationMs: 500 });
      const reselected = animation();

      const masked = applyAnimationIntentMask(mixedSecond, reselected);

      expect(masked.presetId).toBe('preset-a');
      expect(masked.durationMs).toBe(300);
    });
  });

  // preset 매칭용 epsilon(0.001)을 변경 감지에 재사용하면 이런 미세 드래그가
  // 무변경으로 오판된다 - 정확 비교를 고정
  it('epsilon보다 작은 bezier 변경도 적용한다', () => {
    const start = animation({ bezier: [0.25, 0.1, 0.25, 1] });
    const fresh = animation({ bezier: [0.25, 0.1, 0.25, 1] });
    const next = animation({ bezier: [0.2505, 0.1, 0.25, 1] });

    const merged = mergeChangedAnimationFields(fresh, start, next);

    expect(merged.bezier).toEqual([0.2505, 0.1, 0.25, 1]);
  });
});
