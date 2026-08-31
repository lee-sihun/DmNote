import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SPRITE_CONSTRAINTS } from '../src/types/key/sprites';
import {
  scaleSpriteResizeValue,
  spriteResizeRatio,
  type SpriteResizeValueField,
} from '../src/renderer/utils/sprite/resizeProjection';

// Rust 적용기와 같은 fixture를 공유해 resizeSprite 스케일 수학의 f64 결과를
// 비트 단위로 고정한다. 비교는 expectedHex(IEEE754 big-endian)로만 한다 -
// decimal expected는 사람 읽기용이고, -0·subnormal은 decimal 비교가 놓친다
const FIXTURE_PATH = join(
  __dirname,
  'fixtures',
  'sprite-resize-scale-parity.json',
);

interface ResizeScaleCase {
  name: string;
  field: SpriteResizeValueField | 'ratio';
  prev: number;
  next: number;
  value?: number;
  expected: number;
  expectedHex: string;
}

interface ResizeScaleFixture {
  version: number;
  ranges: Record<SpriteResizeValueField, [number, number]>;
  cases: ResizeScaleCase[];
}

const fixture = JSON.parse(
  readFileSync(FIXTURE_PATH, 'utf8'),
) as ResizeScaleFixture;

const bitsHex = (value: number): string => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return (
    '0x' +
    [...new Uint8Array(buffer)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  );
};

describe('sprite resize scale parity (fixture)', () => {
  it('fixture 범위는 SPRITE_CONSTRAINTS와 일치한다', () => {
    expect(fixture.ranges.offset).toEqual([
      SPRITE_CONSTRAINTS.offset.min,
      SPRITE_CONSTRAINTS.offset.max,
    ]);
    expect(fixture.ranges.coord).toEqual([
      SPRITE_CONSTRAINTS.imageRect.coordMin,
      SPRITE_CONSTRAINTS.imageRect.coordMax,
    ]);
    expect(fixture.ranges.dimension).toEqual([
      SPRITE_CONSTRAINTS.resizeMinDimension,
      SPRITE_CONSTRAINTS.imageRect.dimensionMax,
    ]);
  });

  it('케이스는 비어 있지 않고 필드 종류를 전수 커버한다', () => {
    const fields = new Set(fixture.cases.map((entry) => entry.field));
    expect([...fields].sort()).toEqual(
      ['coord', 'dimension', 'offset', 'ratio'].sort(),
    );
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))(
    '%s',
    (_name, entry) => {
      const ratio = spriteResizeRatio(entry.prev, entry.next);
      const actual =
        entry.field === 'ratio'
          ? ratio
          : scaleSpriteResizeValue(entry.value ?? 0, ratio, entry.field);
      expect(bitsHex(actual)).toBe(entry.expectedHex);
    },
  );
});
