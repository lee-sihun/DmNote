import type {
  ReactiveSpritePosition,
  SpriteAnchor,
  SpriteImageMetrics,
  SpritePose,
  SpriteRect,
} from '@src/types/key/sprites';
import { DEFAULT_SPRITE_IMAGE_FIT } from '@src/types/key/sprites';

import { toRenderableImageRef } from '@utils/core/imageSource';

import { anchorPx } from './spriteGeometry';

// 이미지 배치 기하 - 메인·오버레이·고스트 렌더, 도달 범위, 손끝 솔버가 공유한다.
// box 모드는 모든 이미지를 imageRect에 그대로 두고, pivot 모드는 이미지마다 자기 축을
// 스프라이트 기준점 P에 맞춘 뒤 기준 이미지의 픽셀 배율로 크기를 정한다.
// 그래서 크기·비율이 다른 이미지로 바뀌어도 축은 제자리고 그림만 그 점을 중심으로 바뀐다

export interface SpriteNaturalSize {
  width: number;
  height: number;
}

/** 해석기가 고른 이미지 한 벌 - src·원본 크기·축을 원자적으로 묶는다 */
export interface SpriteVisual {
  /** 저장된 참조 그대로 - 렌더가 resolveImageSource로 푼다 */
  src: string | null;
  /** 경로에 결합된 원본 크기. 없거나 stale이면 null이라 box 배치로 폴백 */
  naturalSize: SpriteNaturalSize | null;
  /** 이 이미지의 축(이미지 정규화). 자세 축이 없으면 스프라이트 기준점 */
  pivot: SpriteAnchor;
  /** 이미지를 소유한 자세, 기본 이미지면 null */
  sourcePoseId: string | null;
}

/** 요소 로컬 px 배치 - rect 안의 pivot이 transform-origin */
export interface SpritePlacement {
  rect: SpriteRect;
  pivot: SpriteAnchor;
}

export type SpritePlacementSource = Pick<
  ReactiveSpritePosition,
  | 'baseImage'
  | 'imageRect'
  | 'pivot'
  | 'imageFit'
  | 'imagePlacement'
  | 'referenceNaturalSize'
>;

export type SpriteVisualSource = Pick<
  ReactiveSpritePosition,
  'baseImage' | 'pivot' | 'referenceNaturalSize'
>;

// 경로에 결합된 크기는 경로가 정확히 같을 때만 믿는다 - 플러그인이 경로만 바꾼
// stale 값이 렌더·창 크기·손끝 계산을 한꺼번에 오염시키지 않게
const boundNaturalSize = (
  metrics: SpriteImageMetrics | null | undefined,
  source: string | null,
): SpriteNaturalSize | null =>
  metrics && source !== null && metrics.source === source
    ? { width: metrics.width, height: metrics.height }
    : null;

/**
 * 픽셀 배율의 기준 크기. base가 있으면 base에 결합된 값이어야 하고, base가
 * 없으면 결합 없는(source null) 고정값이어야 한다. 어긋나면 stale로 보고 null
 */
export const spriteReferenceSize = (
  sprite: Pick<ReactiveSpritePosition, 'baseImage' | 'referenceNaturalSize'>,
): SpriteNaturalSize | null => {
  const reference = sprite.referenceNaturalSize;
  if (!reference) return null;
  const base = toRenderableImageRef(sprite.baseImage);
  if (base !== null ? reference.source !== base : reference.source !== null) {
    return null;
  }
  return { width: reference.width, height: reference.height };
};

/** 기본 이미지의 visual - 축은 스프라이트 기준점 */
export const spriteIdleVisual = (sprite: SpriteVisualSource): SpriteVisual => ({
  src: sprite.baseImage,
  naturalSize:
    toRenderableImageRef(sprite.baseImage) !== null
      ? spriteReferenceSize(sprite)
      : null,
  pivot: sprite.pivot,
  sourcePoseId: null,
});

/**
 * 자세의 visual - 렌더 가능한 override가 있으면 그 이미지·크기·축, 아니면 기본
 * 이미지 visual. 공백 override는 이미지 없음이라 base를 가리지 않는다
 */
export const spritePoseVisual = (
  sprite: SpriteVisualSource,
  pose: Pick<
    SpritePose,
    'poseId' | 'imageOverride' | 'imagePivot' | 'imageOverrideMetrics'
  >,
): SpriteVisual => {
  const override = toRenderableImageRef(pose.imageOverride);
  if (override === null) return spriteIdleVisual(sprite);
  return {
    src: override,
    naturalSize: boundNaturalSize(pose.imageOverrideMetrics, override),
    pivot: pose.imagePivot ?? sprite.pivot,
    sourcePoseId: pose.poseId,
  };
};

/**
 * 기준 이미지의 픽셀 배율 K. contain은 상자에 들어가는 균일 배율, cover는 상자를
 * 덮는 균일 배율, fill은 축별 배율. pivot 모드가 아니거나 기준 크기가 없으면 null
 */
export const spriteReferenceScale = (
  sprite: SpritePlacementSource,
): { x: number; y: number } | null => {
  if (sprite.imagePlacement !== 'pivot') return null;
  const reference = spriteReferenceSize(sprite);
  if (!reference) return null;
  const rx = sprite.imageRect.width / reference.width;
  const ry = sprite.imageRect.height / reference.height;
  const fit = sprite.imageFit ?? DEFAULT_SPRITE_IMAGE_FIT;
  if (fit === 'fill') return { x: rx, y: ry };
  const uniform = fit === 'cover' ? Math.max(rx, ry) : Math.min(rx, ry);
  return { x: uniform, y: uniform };
};

/** box 배치 - 저장된 참조를 그대로 돌려줘 identity 비교가 유지된다 */
export const boxSpritePlacement = (
  sprite: Pick<ReactiveSpritePosition, 'imageRect' | 'pivot'>,
): SpritePlacement => ({ rect: sprite.imageRect, pivot: sprite.pivot });

/**
 * visual의 배치. pivot 모드에서 기준 배율과 원본 크기가 모두 있으면
 * W,H = natural × K, 좌상단 = P − pivot × (W,H). 하나라도 없으면 box 배치로 폴백해
 * 로드 전·stale 데이터에서도 렌더와 창 크기가 흔들리지 않는다
 */
export const placeSpriteVisual = (
  sprite: SpritePlacementSource,
  visual: SpriteVisual,
): SpritePlacement => {
  const scale = spriteReferenceScale(sprite);
  if (!scale || !visual.naturalSize) return boxSpritePlacement(sprite);
  const width = visual.naturalSize.width * scale.x;
  const height = visual.naturalSize.height * scale.y;
  const axis = anchorPx(sprite.imageRect, sprite.pivot);
  return {
    rect: {
      x: axis.x - visual.pivot.x * width,
      y: axis.y - visual.pivot.y * height,
      width,
      height,
    },
    pivot: visual.pivot,
  };
};

/**
 * 기본 이미지를 새로 고를 때 상자를 그 이미지 비율로 줄인다. 레이어 크기가 곧 이미지
 * 크기인 도구처럼 상자가 비트맵을 감싸야 여백이 생기지 않는다. 기준점 P는 제자리에
 * 두어 자세들이 매달린 고정점이 움직이지 않고, 크기는 contain으로 그려지던 값 그대로라
 * 화면에서 바뀌는 것은 상자 윤곽뿐이다
 */
export const fitImageRectToNaturalSize = (
  rect: SpriteRect,
  pivot: SpriteAnchor,
  natural: SpriteNaturalSize,
): SpriteRect => {
  const scale = Math.min(
    rect.width / natural.width,
    rect.height / natural.height,
  );
  const width = natural.width * scale;
  const height = natural.height * scale;
  const axis = anchorPx(rect, pivot);
  return {
    x: axis.x - pivot.x * width,
    y: axis.y - pivot.y * height,
    width,
    height,
  };
};
