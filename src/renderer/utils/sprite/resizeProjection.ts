import type { EditorBoundsV1 } from '@src/types/editor';
import type { SpriteTransform } from '@src/types/key/sprites';
import { SPRITE_CONSTRAINTS } from '@src/types/key/sprites';

import { clamp } from '@utils/core/clamp';

// 스프라이트 리사이즈 projection - resizeSprite op의 프론트 구현.
// 백엔드 적용기와 분기·연산 순서(나눗셈 1회, 값마다 곱셈 1회, clamp는
// max→min)를 비트 단위로 공유한다. eager 적용·낙관 target·conflict rebase가
// 전부 이 구현 하나를 소비한다

export interface SpriteResizeProjectable {
  dx: number;
  dy: number;
  width: number;
  height: number;
  idleTransform: SpriteTransform;
  poses: ReadonlyArray<{ transform: SpriteTransform }>;
}

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

// 자세 이동값(px)의 비례 스케일. 배율 1은 클램프 없는 완전 passthrough -
// 순수 이동이 검증상 유효한 값을 비트 단위로 보존한다
export const scaleSpriteResizeOffset = (
  value: number,
  ratio: number,
): number => {
  if (ratio === 1) return value;
  const { offset } = SPRITE_CONSTRAINTS;
  return clamp(value * ratio, offset.min, offset.max);
};

const scaleTransform = (
  transform: SpriteTransform,
  sx: number,
  sy: number,
): SpriteTransform => ({
  ...transform,
  x: scaleSpriteResizeOffset(transform.x, sx),
  y: scaleSpriteResizeOffset(transform.y, sy),
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
 * bounds 교체 + 이전 bounds 대비 배율로 이동값(px)을 스케일.
 * rotation·scale·pivot은 불변 - 정규화 좌표는 상자를 자동 추종한다.
 * bounds가 동일하면 원본을 그대로 반환한다 (noChange)
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
    idleTransform: scaleTransform(position.idleTransform, sx, sy),
    poses: position.poses.map((pose) => ({
      ...pose,
      transform: scaleTransform(pose.transform, sx, sy),
    })),
  };
};

/**
 * 리사이즈가 실제로 바꾸는 필드만 뽑은 patch. bounds와 그 배율로 스케일된
 * 이동값이 한 몸이라, eager 커밋과 편집 중 미리보기가 이 함수 하나를 공유해야
 * 놓는 순간 자세가 튀지 않는다.
 * position은 반드시 canonical - preview 합성분을 넣으면 이전 프레임의 배율
 * 위에 다시 배율이 얹혀 누적된다
 */
export const spriteResizePatch = (
  position: SpriteResizeProjectable,
  bounds: EditorBoundsV1,
): Pick<
  SpriteResizeProjectable,
  'dx' | 'dy' | 'width' | 'height' | 'idleTransform' | 'poses'
> => {
  const projected = projectSpriteResize(position, bounds);
  return {
    dx: projected.dx,
    dy: projected.dy,
    width: projected.width,
    height: projected.height,
    idleTransform: projected.idleTransform,
    poses: projected.poses,
  };
};
