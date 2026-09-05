import { describe, expect, it } from 'vitest';

import type { SpritePose } from '@src/types/key/sprites';
import {
  rebaseSpritePoseIntent,
  resolveSpritePoseCommit,
} from './spritePoseIntent';

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

describe('resolveSpritePoseCommit', () => {
  const scaled = (poseId: string): SpritePose =>
    pose(poseId, {
      transform: { x: 0, y: 0, rotation: 0, scale: 0.5 },
    });

  it.each([
    { label: '빈 담당 키', triggers: [] },
    { label: '중복 담당 키', triggers: ['key-a'] },
  ])('$label 새 형제가 있어도 기존 대상의 배율을 저장한다', ({ triggers }) => {
    const base = [pose('a')];
    const intended = [scaled('a'), pose('draft', { triggers })];
    const current = [pose('a', { imageOverride: 'latest.png' }), pose('c')];

    expect(resolveSpritePoseCommit(base, intended, current, 'a')).toEqual({
      partial: true,
      poses: [{ ...scaled('a'), imageOverride: 'latest.png' }, current[1]],
    });
  });

  it('기존 형제가 초안에서 무효가 돼도 최신 저장값을 보존한다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [
      scaled('a'),
      pose('b', {
        name: '미저장 이름',
        triggers: [],
        imageOverride: 'draft.png',
      }),
    ];
    const current = [
      pose('a'),
      pose('b', {
        name: '현재 이름',
        transform: { x: 12, y: 6, rotation: 20, scale: 2 },
        imageOverride: 'current.png',
      }),
    ];

    expect(resolveSpritePoseCommit(base, intended, current, 'a')).toEqual({
      partial: true,
      poses: [scaled('a'), current[1]],
    });
  });

  it('편집 대상 자체의 담당 키가 비었으면 저장하지 않는다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [{ ...scaled('a'), triggers: [] }, pose('b')];

    expect(resolveSpritePoseCommit(base, intended, base, 'a')).toBeNull();
  });

  it('대상 트리거가 최신 canonical 형제와 충돌하면 저장하지 않는다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [
      { ...scaled('a'), triggers: ['key-b'] },
      pose('b', { triggers: [] }),
    ];

    expect(resolveSpritePoseCommit(base, intended, base, 'a')).toBeNull();
  });

  it('큐 대기 중 생긴 트리거 충돌도 최신 문서에서 차단한다', () => {
    const base = [pose('a')];
    const intended = [{ ...scaled('a'), triggers: ['key-c'] }];
    const current = [pose('a'), pose('c')];

    expect(resolveSpritePoseCommit(base, intended, current, 'a')).toBeNull();
  });

  it('무효 형제와 함께 대기하던 편집 대상이 삭제되면 되살리지 않는다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [scaled('a'), pose('b'), pose('draft', { triggers: [] })];
    const current = [pose('b')];

    expect(resolveSpritePoseCommit(base, intended, current, 'a')).toBeNull();
  });

  it('전체 초안이 유효해도 큐 대기 중 삭제된 대상은 복원하지 않는다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [scaled('a'), pose('b')];
    const current = [pose('b')];

    expect(resolveSpritePoseCommit(base, intended, current, 'a')).toBeNull();
  });

  it('미완성 구조 변경은 명시한 편집 대상 없이 일부만 저장하지 않는다', () => {
    const base = [pose('a')];
    const intended = [
      pose('a', { name: '상태 1' }),
      pose('draft', { name: '상태 2', triggers: [] }),
    ];

    expect(resolveSpritePoseCommit(base, intended, base)).toBeNull();
  });

  it('부분 저장에 다른 상태의 이름 고정이나 삭제 의도를 섞지 않는다', () => {
    const base = [pose('a'), pose('b'), pose('c')];
    const intended = [
      scaled('a'),
      pose('b', { name: '상태 2' }),
      pose('draft', { triggers: [] }),
    ];

    expect(resolveSpritePoseCommit(base, intended, base, 'a')).toEqual({
      partial: true,
      poses: [scaled('a'), base[1], base[2]],
    });
  });

  it('유효한 전체 초안의 트리거 교환은 한 번에 저장한다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [
      pose('a', { triggers: ['key-b'] }),
      pose('b', { triggers: ['key-a'] }),
    ];

    expect(resolveSpritePoseCommit(base, intended, base, 'a')).toEqual({
      partial: false,
      poses: intended,
    });
  });

  it('부분 저장 후 나머지 초안이 완성되면 앞선 편집과 함께 저장한다', () => {
    const base = [pose('a')];
    const draft = [scaled('a'), pose('b', { triggers: [] })];
    const partial = resolveSpritePoseCommit(base, draft, base, 'a');
    expect(partial?.partial).toBe(true);
    const completed = [scaled('a'), pose('b')];

    expect(
      resolveSpritePoseCommit(base, completed, partial!.poses, 'b'),
    ).toEqual({ partial: false, poses: completed });
  });

  it('새 상태를 부분 저장할 때 초안의 기존 상태 사이 삽입 위치를 유지한다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [
      pose('a'),
      pose('copy'),
      pose('b'),
      pose('draft', { triggers: [] }),
    ];

    expect(resolveSpritePoseCommit(base, intended, base, 'copy')).toEqual({
      partial: true,
      poses: [base[0], pose('copy'), base[1]],
    });
  });

  it('미완성 형제가 있어도 명시한 정상 상태 삭제는 저장한다', () => {
    const base = [pose('a'), pose('b')];
    const intended = [pose('b'), pose('draft', { triggers: [] })];

    expect(resolveSpritePoseCommit(base, intended, base, 'a')).toEqual({
      partial: true,
      poses: [base[1]],
    });
  });

  it.each([
    { label: '유효 초안', otherDraft: [] },
    {
      label: '미완성 형제',
      otherDraft: [pose('draft', { triggers: [] })],
    },
  ])(
    '앞선 추가가 늦게 착지해도 뒤따른 명시적 삭제는 새 상태를 되살리지 않는다: $label',
    ({ otherDraft }) => {
      const base = [pose('a')];
      const intended = [pose('a'), ...otherDraft];
      const current = [pose('a'), pose('recent')];

      const result = resolveSpritePoseCommit(base, intended, current, 'recent');
      expect(result?.poses).toEqual([current[0]]);
    },
  );
});
