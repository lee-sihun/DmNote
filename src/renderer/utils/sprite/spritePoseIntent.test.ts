import { describe, expect, it } from 'vitest';

import type { SpritePose } from '@src/types/key/sprites';
import { rebaseSpritePoseIntent } from './spritePoseIntent';

const pose = (
  poseId: string,
  overrides: Partial<SpritePose> = {},
): SpritePose => ({
  poseId,
  name: null,
  triggers: [`key-${poseId}`],
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  pivot: null,
  imageOverride: null,
  imageOverrideMetrics: null,
  ...overrides,
});

describe('rebaseSpritePoseIntent', () => {
  it('대상 필드 변경만 최신 상태에 적용한다', () => {
    const base = [pose('a')];
    const intended = [pose('a', { pivot: { x: 0.2, y: 0.8 } })];
    const current = [
      pose('a', {
        transform: { x: 42, y: 7, rotation: 3, scale: 1.1 },
        imageOverride: 'latest.png',
      }),
    ];

    expect(rebaseSpritePoseIntent(base, intended, current)).toEqual([
      pose('a', {
        pivot: { x: 0.2, y: 0.8 },
        transform: { x: 42, y: 7, rotation: 3, scale: 1.1 },
        imageOverride: 'latest.png',
      }),
    ]);
  });

  it('미저장 초안의 여러 변경과 새 상태를 함께 보존한다', () => {
    const base = [pose('a')];
    const intended = [
      pose('a', {
        name: '상태 1',
        transform: { x: 18, y: -4, rotation: 0, scale: 1 },
      }),
      pose('b', { triggers: ['key-b'] }),
    ];
    const current = [pose('a', { imageOverride: 'latest.png' })];

    expect(rebaseSpritePoseIntent(base, intended, current)).toEqual([
      pose('a', {
        name: '상태 1',
        transform: { x: 18, y: -4, rotation: 0, scale: 1 },
        imageOverride: 'latest.png',
      }),
      pose('b', { triggers: ['key-b'] }),
    ]);
  });

  it('삭제 의도는 대상만 제거하고 동시에 추가된 상태는 유지한다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [pose('a')];
    const current = [pose('a'), pose('b'), pose('c')];

    expect(rebaseSpritePoseIntent(base, intended, current)).toEqual([
      pose('a'),
      pose('c'),
    ]);
  });

  it('먼저 착지한 로컬 추가에는 후속 초안 전체를 적용한다', () => {
    const base = [pose('a')];
    const intended = [
      pose('a'),
      pose('b', {
        triggers: ['key-b'],
        transform: { x: 12, y: 3, rotation: 0, scale: 1 },
      }),
    ];
    const current = [pose('a'), pose('b', { triggers: [] })];

    expect(rebaseSpritePoseIntent(base, intended, current)[1]).toEqual(
      pose('b', {
        triggers: ['key-b'],
        transform: { x: 12, y: 3, rotation: 0, scale: 1 },
      }),
    );
  });
});
