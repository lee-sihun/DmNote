import { describe, expect, it } from 'vitest';
import { createCounterAnimationPresetIntent } from '@src/types/key/counterAnimation';

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

describe('createCounterAnimationPresetIntent', () => {
  it('single preset intent는 required presetId와 정확히 바뀐 numeric leaf만 가진다', () => {
    const start = animation();
    const next = animation({
      presetId: 'preset-b',
      bezier: [0.2505, 0.1, 0.25, 1],
    });

    expect(createCounterAnimationPresetIntent(start, next, 'single')).toEqual({
      presetId: 'preset-b',
      applyPresetId: true,
      bezier: [0.2505, 0.1, 0.25, 1],
    });
  });

  it('batch preset intent는 enabled를 제외한 preset numeric 3종을 항상 가진다', () => {
    const current = animation({ enabled: false, presetId: 'preset-mixed' });
    const next = animation();

    expect(createCounterAnimationPresetIntent(current, next, 'batch')).toEqual({
      presetId: 'preset-a',
      applyPresetId: true,
      bezier: next.bezier,
      scale: next.scale,
      durationMs: next.durationMs,
    });
  });

  it('single edit same preset은 presetId를 assignment하지 않는다', () => {
    const start = animation({ presetId: 'preset-a', scale: 1.1 });
    const next = animation({ presetId: 'preset-a', scale: 1.4 });

    expect(createCounterAnimationPresetIntent(start, next, 'single')).toEqual({
      presetId: 'preset-a',
      scale: 1.4,
    });
  });
});
