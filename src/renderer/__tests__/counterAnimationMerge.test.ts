import { describe, expect, it } from 'vitest';
import { mergeChangedAnimationFields } from '@src/types/key/counterAnimation';

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
