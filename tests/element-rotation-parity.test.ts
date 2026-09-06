import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ELEMENT_ROTATION,
  ELEMENT_ROTATION_RANGE,
  elementRotationSchema,
} from '../src/types/key/rotation';
import { IMAGE_TRANSFORM_CONSTRAINTS } from '../src/types/key/imageLayer';
import { SPRITE_CONSTRAINTS } from '../src/types/key/sprites';
import { keyPositionSchema } from '../src/types/key/keys';

// Rust 테스트(src-tauri models)와 같은 fixture를 공유해 요소 회전 범위·기본값이
// 프론트 zod 경계와 백엔드 검증 상수에서 기계적으로 일치함을 고정한다
const FIXTURE_PATH = join(
  __dirname,
  'fixtures',
  'element-rotation-parity.json',
);

interface ElementRotationFixture {
  rotation: { min: number; max: number };
  default: number;
}

const fixture = (): ElementRotationFixture =>
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ElementRotationFixture;

describe('element rotation parity', () => {
  it('회전 범위와 기본값이 fixture와 일치한다', () => {
    const { rotation, default: fallback } = fixture();
    expect(ELEMENT_ROTATION_RANGE).toEqual(rotation);
    expect(DEFAULT_ELEMENT_ROTATION).toBe(fallback);
  });

  it('스프라이트 자세·키 이미지 레이어 회전도 같은 범위를 쓴다', () => {
    expect(SPRITE_CONSTRAINTS.rotation).toEqual(fixture().rotation);
    expect(IMAGE_TRANSFORM_CONSTRAINTS.rotation).toEqual(fixture().rotation);
  });

  it('zod 경계는 fixture 경계값을 포함하고 바깥·비유한을 거부한다', () => {
    const { min, max } = fixture().rotation;
    expect(elementRotationSchema.safeParse(min).success).toBe(true);
    expect(elementRotationSchema.safeParse(max).success).toBe(true);
    expect(elementRotationSchema.safeParse(min - 0.001).success).toBe(false);
    expect(elementRotationSchema.safeParse(max + 0.001).success).toBe(false);
    expect(elementRotationSchema.safeParse(Number.NaN).success).toBe(false);
    expect(elementRotationSchema.safeParse(Infinity).success).toBe(false);
    expect(elementRotationSchema.safeParse(null).success).toBe(false);
  });

  it('keyPosition은 rotation 생략을 기본값으로 채우고 명시 null은 거부한다', () => {
    const base = {
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      count: 0,
      noteColor: '#FFFFFF',
      noteOpacity: 90,
    };
    const parsed = keyPositionSchema.parse(base);
    expect(parsed.rotation).toBe(fixture().default);
    expect(
      keyPositionSchema.safeParse({ ...base, rotation: 45.5 }).success,
    ).toBe(true);
    expect(keyPositionSchema.safeParse({ ...base, rotation: null }).success).toBe(
      false,
    );
    expect(keyPositionSchema.safeParse({ ...base, rotation: 181 }).success).toBe(
      false,
    );
  });
});
