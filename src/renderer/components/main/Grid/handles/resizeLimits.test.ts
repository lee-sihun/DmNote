import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
import {
  isBoundsTransitionWithinEditorLimits,
  isBoundsWithinEditorLimits,
} from './resizeLimits';

describe('resizeLimits', () => {
  it('상한 상수는 Rust editor.rs와 같다', () => {
    const rustSource = readFileSync(
      resolve(process.cwd(), 'src-tauri/src/state/editor.rs'),
      'utf8',
    );
    const read = (name: string) => {
      const match = rustSource.match(
        new RegExp(`const ${name}: f64 = ([0-9_]+)\\.0;`),
      );
      expect(match, `Rust ${name}`).not.toBeNull();
      return Number(match![1].replace(/_/g, ''));
    };
    expect(read('MAX_DIMENSION')).toBe(EDITOR_BOUNDS_LIMITS.maxDimension);
    expect(read('MAX_ABS_COORDINATE')).toBe(
      EDITOR_BOUNDS_LIMITS.maxAbsCoordinate,
    );
  });

  it('저장 좌표 절댓값과 치수만 보고 오른쪽·아래 가장자리는 보지 않는다', () => {
    expect(
      isBoundsWithinEditorLimits({
        x: 32768,
        y: -32768,
        width: 32768,
        height: 0.1,
      }),
    ).toBe(true);
    // 오른쪽 가장자리 65536은 백엔드가 검사하지 않는다
    expect(
      isBoundsWithinEditorLimits({ x: 32768, y: 0, width: 32768, height: 10 }),
    ).toBe(true);
    expect(
      isBoundsWithinEditorLimits({ x: 32769, y: 0, width: 10, height: 10 }),
    ).toBe(false);
    expect(
      isBoundsWithinEditorLimits({ x: 0, y: 0, width: 32769, height: 10 }),
    ).toBe(false);
    expect(
      isBoundsWithinEditorLimits({ x: 0, y: 0, width: 0, height: 10 }),
    ).toBe(false);
    expect(
      isBoundsWithinEditorLimits({ x: 0, y: NaN, width: 10, height: 10 }),
    ).toBe(false);
  });

  it('전이 판정은 범위 밖 legacy 항목을 그대로 두거나 줄이는 후보만 받는다', () => {
    const legacy = { x: 40000, y: 0, width: 40000, height: 100 };
    // 폭·x는 그대로, 높이만 바꿈 → 백엔드 non-increasing 규칙으로 통과
    expect(
      isBoundsTransitionWithinEditorLimits(legacy, { ...legacy, height: 150 }),
    ).toBe(true);
    // 범위 밖 폭을 더 키우면 거부
    expect(
      isBoundsTransitionWithinEditorLimits(legacy, { ...legacy, width: 40001 }),
    ).toBe(false);
    // 범위 밖 폭·좌표를 줄이면 통과 (절댓값 기준)
    expect(
      isBoundsTransitionWithinEditorLimits(legacy, {
        ...legacy,
        x: -39000,
        width: 39000,
      }),
    ).toBe(true);
    // 정상 시작에서 범위 밖으로 나가면 거부
    expect(
      isBoundsTransitionWithinEditorLimits(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 0, y: 0, width: 32769, height: 100 },
      ),
    ).toBe(false);
    // 비유한값은 비트 동일일 때만
    expect(
      isBoundsTransitionWithinEditorLimits(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: NaN, y: 0, width: 100, height: 100 },
      ),
    ).toBe(false);
  });
});
