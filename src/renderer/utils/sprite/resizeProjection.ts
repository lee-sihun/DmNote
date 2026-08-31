import type { SpriteRect, SpriteTransform } from '@src/types/key/sprites';
import { SPRITE_CONSTRAINTS } from '@src/types/key/sprites';
import type { EditorBoundsV1 } from '@src/types/editor';

// 스프라이트 리사이즈 projection - resizeSprite op의 프론트 구현.
// 백엔드 적용기와 분기·연산 순서(나눗셈 1회, 값마다 곱셈 1회, clamp는
// max→min)를 비트 단위로 공유한다. eager 적용·낙관 target·conflict rebase가
// 전부 이 구현 하나를 소비한다

export interface SpriteResizeProjectable {
  dx: number;
  dy: number;
  width: number;
  height: number;
  imageRect: SpriteRect;
  idleTransform: SpriteTransform;
  poses: ReadonlyArray<{ transform: SpriteTransform }>;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// 유한 비음수 배율. 무효 prev/next와 subnormal 나눗셈 오버플로는 1(무배율)로,
// 극단 축소의 언더플로 0은 축소 의도 보존을 위해 그대로 허용한다
export const spriteResizeRatio = (prev: number, next: number): number => {
  if (
    !(prev > 0) ||
    !Number.isFinite(prev) ||
    !(next > 0) ||
    !Number.isFinite(next)
  ) {
    return 1;
  }
  const ratio = next / prev;
  return Number.isFinite(ratio) ? ratio : 1;
};

// 필드 종류별 클램프 범위 - transform offset, imageRect 좌표, imageRect 치수
export type SpriteResizeValueField = 'offset' | 'coord' | 'dimension';

export const scaleSpriteResizeValue = (
  value: number,
  ratio: number,
  field: SpriteResizeValueField,
): number => {
  // 배율 1은 클램프 없는 완전 passthrough - 순수 이동이 검증상 유효한
  // 극소 치수(하한 미만)까지 비트 단위로 보존한다
  if (ratio === 1) return value;
  const { imageRect, offset, resizeMinDimension } = SPRITE_CONSTRAINTS;
  const min =
    field === 'offset'
      ? offset.min
      : field === 'coord'
      ? imageRect.coordMin
      : resizeMinDimension;
  const max =
    field === 'offset'
      ? offset.max
      : field === 'coord'
      ? imageRect.coordMax
      : imageRect.dimensionMax;
  return clamp(value * ratio, min, max);
};

const scaleOffset = (value: number, ratio: number): number =>
  scaleSpriteResizeValue(value, ratio, 'offset');

const scaleTransform = (
  transform: SpriteTransform,
  sx: number,
  sy: number,
): SpriteTransform => ({
  ...transform,
  x: scaleOffset(transform.x, sx),
  y: scaleOffset(transform.y, sy),
});

export const isSameSpriteBounds = (
  position: Pick<SpriteResizeProjectable, 'dx' | 'dy' | 'width' | 'height'>,
  bounds: EditorBoundsV1,
): boolean =>
  position.dx === bounds.dx &&
  position.dy === bounds.dy &&
  position.width === bounds.width &&
  position.height === bounds.height;

/**
 * bounds 교체 + 이전 bounds 대비 배율로 콘텐츠(px 좌표) 스케일.
 * rotation·scale·pivot·contactPoint는 불변 - 정규화 좌표는 imageRect를
 * 자동 추종한다. bounds가 동일하면 원본을 그대로 반환한다 (noChange)
 */
export const projectSpriteResize = <T extends SpriteResizeProjectable>(
  position: T,
  bounds: EditorBoundsV1,
): T => {
  if (isSameSpriteBounds(position, bounds)) return position;
  const sx = spriteResizeRatio(position.width, bounds.width);
  const sy = spriteResizeRatio(position.height, bounds.height);
  return {
    ...position,
    dx: bounds.dx,
    dy: bounds.dy,
    width: bounds.width,
    height: bounds.height,
    imageRect: {
      x: scaleSpriteResizeValue(position.imageRect.x, sx, 'coord'),
      y: scaleSpriteResizeValue(position.imageRect.y, sy, 'coord'),
      width: scaleSpriteResizeValue(position.imageRect.width, sx, 'dimension'),
      height: scaleSpriteResizeValue(
        position.imageRect.height,
        sy,
        'dimension',
      ),
    },
    idleTransform: scaleTransform(position.idleTransform, sx, sy),
    poses: position.poses.map((pose) => ({
      ...pose,
      transform: scaleTransform(pose.transform, sx, sy),
    })),
  };
};
