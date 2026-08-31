import { describe, expect, it } from 'vitest';

import type { SpritePose } from '@src/types/key/sprites';

import {
  copyPoseName,
  materializePoseNames,
  resolvePoseNames,
  stripCopySuffix,
} from './spritePoseNames';

const LABEL = '상태';
const SUFFIX = '복제';

const pose = (poseId: string, name: string | null = null): SpritePose => ({
  poseId,
  name,
  triggers: [],
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  imageOverride: null,
  contactPoint: { x: 0.5, y: 1 },
});

describe('resolvePoseNames', () => {
  it('무명 자세에 1부터 번호를 매긴다', () => {
    expect(resolvePoseNames([pose('a'), pose('b')], LABEL)).toEqual([
      '상태 1',
      '상태 2',
    ]);
  });

  it('저장된 번호가 점유한 자리는 건너뛴다', () => {
    expect(
      resolvePoseNames([pose('a'), pose('b', '상태 1'), pose('c')], LABEL),
    ).toEqual(['상태 2', '상태 1', '상태 3']);
  });

  it('사용자 작명은 그대로 둔다', () => {
    expect(resolvePoseNames([pose('a', '왼손'), pose('b')], LABEL)).toEqual([
      '왼손',
      '상태 1',
    ]);
  });

  it('앞자리 0이 붙은 이름은 생성 번호로 보지 않는다', () => {
    expect(resolvePoseNames([pose('a', '상태 01'), pose('b')], LABEL)).toEqual([
      '상태 01',
      '상태 1',
    ]);
  });
});

describe('materializePoseNames', () => {
  it('무명만 표시값으로 고정하고 나머지 참조는 보존한다', () => {
    const named = pose('b', '왼손');
    const result = materializePoseNames([pose('a'), named], LABEL);
    expect(result[0].name).toBe('상태 1');
    expect(result[1]).toBe(named);
  });
});

describe('stripCopySuffix', () => {
  it('생성된 복제 접미사만 벗긴다', () => {
    expect(stripCopySuffix('왼손 복제', SUFFIX)).toBe('왼손');
    expect(stripCopySuffix('왼손 복제 3', SUFFIX)).toBe('왼손');
  });

  it('사용자가 지은 복제 0·복제 01은 이름의 일부로 본다', () => {
    expect(stripCopySuffix('왼손 복제 0', SUFFIX)).toBe('왼손 복제 0');
    expect(stripCopySuffix('왼손 복제 01', SUFFIX)).toBe('왼손 복제 01');
  });

  it('이름 전체가 접미사면 벗기지 않는다', () => {
    expect(stripCopySuffix('복제', SUFFIX)).toBe('복제');
  });
});

describe('copyPoseName', () => {
  it('겹치면 2부터 숫자를 올린다', () => {
    const poses = [pose('a', '왼손'), pose('b', '왼손 복제')];
    expect(copyPoseName(poses, 0, LABEL, SUFFIX)).toBe('왼손 복제 2');
  });

  it('사본을 다시 복제해도 루트를 유지한다', () => {
    const poses = [pose('a', '왼손 복제 3')];
    expect(copyPoseName(poses, 0, LABEL, SUFFIX)).toBe('왼손 복제');
  });

  it('무명 자세는 표시 번호를 루트로 쓴다', () => {
    expect(copyPoseName([pose('a')], 0, LABEL, SUFFIX)).toBe('상태 1 복제');
  });
});
