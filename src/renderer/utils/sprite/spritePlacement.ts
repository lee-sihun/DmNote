import type {
  ReactiveSpritePosition,
  SpriteAnchor,
  SpriteImageMetrics,
  SpritePose,
  SpriteRect,
  SpriteTransform,
} from '@src/types/key/sprites';
import { SPRITE_CONSTRAINTS } from '@src/types/key/sprites';

import { toRenderableImageRef } from '@utils/core/imageSource';

import { clamp } from '@utils/core/clamp';
import {
  DEG_TO_RAD,
  SPRITE_ANCHOR_PRESETS,
  spritePivotPx,
} from './spriteGeometry';

// 이미지 배치 기하 - 메인·오버레이·고스트 렌더, 도달 범위, 기준점 이동 보정이 공유한다.
// 이미지 상자는 요소 상자 하나뿐이다. 기본 이미지는 상자를 그대로 채우고, 크기가 다른
// 자세 이미지는 같은 정규화 기준점을 P에 맞춘 뒤 기본 이미지의 픽셀 배율로 그린다.
// 원본 크기를 모르면 이미지를 상자에 그대로 끼운다 (폴백)

export interface SpriteNaturalSize {
  width: number;
  height: number;
}

/** 해석기가 고른 이미지 한 벌 - src와 원본 크기를 원자적으로 묶는다 */
export interface SpriteVisual {
  /** 저장된 참조 그대로 - 렌더가 resolveImageSource로 푼다 */
  src: string | null;
  /** 경로에 결합된 원본 크기. 없거나 stale이면 null이라 상자 폴백 */
  naturalSize: SpriteNaturalSize | null;
  /** 이미지를 소유한 자세, 기본 이미지면 null */
  sourcePoseId: string | null;
  /** 이미지 내부 기준점. 상태에서 null이면 기본 이미지 기준점을 물려받아 해석한 값 */
  pivot: SpriteAnchor;
}

/** 요소 로컬 px 배치 - rect 안의 pivot이 transform-origin */
export interface SpritePlacement {
  rect: SpriteRect;
  pivot: SpriteAnchor;
}

export type SpriteBoxSource = Pick<ReactiveSpritePosition, 'width' | 'height'>;

export type SpriteVisualSource = Pick<
  ReactiveSpritePosition,
  'baseImage' | 'referenceNaturalSize' | 'pivot'
>;

type SpriteReferenceSource = Pick<
  ReactiveSpritePosition,
  'baseImage' | 'referenceNaturalSize'
>;

export type SpritePlacementSource = SpriteBoxSource &
  SpriteVisualSource &
  Pick<ReactiveSpritePosition, 'pivot'>;

// 경로에 결합된 크기는 경로가 정확히 같을 때만 믿는다 - 플러그인이 경로만 바꾼
// stale 값이 렌더·창 크기·보정 계산을 한꺼번에 오염시키지 않게
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
  sprite: SpriteReferenceSource,
): SpriteNaturalSize | null => {
  const reference = sprite.referenceNaturalSize;
  if (!reference) return null;
  const base = toRenderableImageRef(sprite.baseImage);
  if (base !== null ? reference.source !== base : reference.source !== null) {
    return null;
  }
  return { width: reference.width, height: reference.height };
};

/** 기본 이미지의 visual */
export const spriteIdleVisual = (sprite: SpriteVisualSource): SpriteVisual => ({
  src: sprite.baseImage,
  naturalSize:
    toRenderableImageRef(sprite.baseImage) !== null
      ? spriteReferenceSize(sprite)
      : null,
  sourcePoseId: null,
  pivot: sprite.pivot,
});

/**
 * 자세의 visual - 렌더 가능한 override가 있으면 그 이미지·크기, 아니면 기본
 * 이미지 visual. 공백 override는 이미지 없음이라 base를 가리지 않는다
 */
export const spritePoseVisual = (
  sprite: SpriteVisualSource,
  pose: Pick<
    SpritePose,
    'poseId' | 'imageOverride' | 'imageOverrideMetrics' | 'pivot'
  >,
): SpriteVisual => {
  const override = toRenderableImageRef(pose.imageOverride);
  if (override === null) {
    return {
      ...spriteIdleVisual(sprite),
      pivot: pose.pivot ?? sprite.pivot,
    };
  }
  return {
    src: override,
    naturalSize: boundNaturalSize(pose.imageOverrideMetrics, override),
    sourcePoseId: pose.poseId,
    pivot: pose.pivot ?? sprite.pivot,
  };
};

/** 요소 상자 - 이미지 상자와 같다 */
export const spriteBoxRect = (sprite: SpriteBoxSource): SpriteRect => ({
  x: 0,
  y: 0,
  width: sprite.width,
  height: sprite.height,
});

/**
 * 기준 이미지의 픽셀 배율 K = 상자 ÷ 기준 크기(축별). 기본 이미지는 이 배율로
 * 그리면 상자를 정확히 채운다. 기준 크기가 없으면 null
 */
export const spriteReferenceScale = (
  sprite: SpriteBoxSource & SpriteVisualSource,
): { x: number; y: number } | null => {
  const reference = spriteReferenceSize(sprite);
  if (!reference) return null;
  return {
    x: sprite.width / reference.width,
    y: sprite.height / reference.height,
  };
};

/** 상자 배치 - 이미지를 요소 상자에 그대로 (원본 크기를 모를 때의 폴백) */
export const boxSpritePlacement = (
  sprite: SpriteBoxSource & Pick<ReactiveSpritePosition, 'pivot'>,
  imagePivot: SpriteAnchor = sprite.pivot,
): SpritePlacement => {
  const axis = spritePivotPx(sprite);
  return {
    rect: {
      x: axis.x - imagePivot.x * sprite.width,
      y: axis.y - imagePivot.y * sprite.height,
      width: sprite.width,
      height: sprite.height,
    },
    pivot: imagePivot,
  };
};

/**
 * visual의 배치. 기준 배율과 원본 크기가 모두 있으면
 * W,H = natural × K, 좌상단 = P − pivot × (W,H). 하나라도 없으면 상자 배치로 폴백해
 * 로드 전·stale 데이터에서도 렌더와 창 크기가 흔들리지 않는다
 */
export const placeSpriteVisual = (
  sprite: SpritePlacementSource,
  visual: SpriteVisual,
): SpritePlacement => {
  const scale = spriteReferenceScale(sprite);
  if (!scale || !visual.naturalSize) {
    return boxSpritePlacement(sprite, visual.pivot);
  }
  const width = visual.naturalSize.width * scale.x;
  const height = visual.naturalSize.height * scale.y;
  const axis = spritePivotPx(sprite);
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

export const isSameSpritePlacement = (
  a: SpritePlacement,
  b: SpritePlacement,
): boolean =>
  a.rect.x === b.rect.x &&
  a.rect.y === b.rect.y &&
  a.rect.width === b.rect.width &&
  a.rect.height === b.rect.height &&
  a.pivot.x === b.pivot.x &&
  a.pivot.y === b.pivot.y;

export interface SpriteBounds {
  dx: number;
  dy: number;
  width: number;
  height: number;
}

/**
 * 기본 이미지를 새로 고를 때 요소 상자를 그 이미지 비율로 줄인다. 레이어 크기가 곧
 * 이미지 크기인 도구처럼 상자가 비트맵을 감싸야 여백이 생기지 않는다. 기준점 P는
 * 화면에서 제자리에 두어 자세들이 매달린 고정점이 움직이지 않는다
 */
export const fitSpriteBoundsToNaturalSize = (
  bounds: SpriteBounds,
  pivot: SpriteAnchor,
  natural: SpriteNaturalSize,
): SpriteBounds => {
  const scale = Math.min(
    bounds.width / natural.width,
    bounds.height / natural.height,
  );
  const width = natural.width * scale;
  const height = natural.height * scale;
  return {
    dx: bounds.dx + pivot.x * (bounds.width - width),
    dy: bounds.dy + pivot.y * (bounds.height - height),
    width,
    height,
  };
};

const tidy = (value: number): number => Math.round(value * 1e9) / 1e9 + 0;

interface SpriteAnchorChangeFrame {
  currentAxis: { x: number; y: number };
  nextAxis: { x: number; y: number };
  currentImagePivot: SpriteAnchor;
  nextImagePivot: SpriteAnchor;
  rect: { width: number; height: number };
  transform: SpriteTransform;
}

const compensateTransformForAnchorChange = ({
  currentAxis,
  nextAxis,
  currentImagePivot,
  nextImagePivot,
  rect,
  transform,
}: SpriteAnchorChangeFrame): SpriteTransform | null => {
  const dpx = (nextImagePivot.x - currentImagePivot.x) * rect.width;
  const dpy = (nextImagePivot.y - currentImagePivot.y) * rect.height;
  const rad = transform.rotation * DEG_TO_RAD;
  const cos = Math.cos(rad) * transform.scale;
  const sin = Math.sin(rad) * transform.scale;
  const x =
    transform.x + (currentAxis.x - nextAxis.x) + (dpx * cos - dpy * sin);
  const y =
    transform.y + (currentAxis.y - nextAxis.y) + (dpx * sin + dpy * cos);
  const { offset } = SPRITE_CONSTRAINTS;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < offset.min ||
    x > offset.max ||
    y < offset.min ||
    y > offset.max
  ) {
    return null;
  }
  return { ...transform, x: tidy(x), y: tidy(y) };
};

/**
 * 기본 기준점 변경 patch. 기본 이미지는 이동값을 보정해 제자리에 두고, 연결된 상태는
 * 이동값을 유지해 새 기본 축을 따라간다. 독립 기준점 상태만 화면 위치를 보존한다.
 * 캔버스 핸들과 패널 입력이 같은 patch를 쓰며 정확한 보정이 범위를 넘으면 거절한다
 */
export const spritePivotChangePatch = (
  sprite: SpritePlacementSource &
    Pick<ReactiveSpritePosition, 'idleTransform' | 'poses'>,
  nextPivot: SpriteAnchor,
): Pick<ReactiveSpritePosition, 'pivot' | 'idleTransform' | 'poses'> | null => {
  const currentAxis = spritePivotPx(sprite);
  const nextAxis = spritePivotPx({ ...sprite, pivot: nextPivot });
  const idlePlacement = placeSpriteVisual(sprite, spriteIdleVisual(sprite));
  const idleTransform = compensateTransformForAnchorChange({
    currentAxis,
    nextAxis,
    currentImagePivot: sprite.pivot,
    nextImagePivot: nextPivot,
    rect: idlePlacement.rect,
    transform: sprite.idleTransform,
  });
  if (!idleTransform) return null;
  const poses: SpritePose[] = [];
  for (const pose of sprite.poses) {
    if (pose.pivot == null) {
      poses.push(pose);
      continue;
    }
    const visual = spritePoseVisual(sprite, pose);
    const transform = compensateTransformForAnchorChange({
      currentAxis,
      nextAxis,
      currentImagePivot: pose.pivot,
      nextImagePivot: pose.pivot,
      rect: placeSpriteVisual(sprite, visual).rect,
      transform: pose.transform,
    });
    if (!transform) return null;
    poses.push({ ...pose, transform });
  }
  return { pivot: { x: nextPivot.x, y: nextPivot.y }, idleTransform, poses };
};

export const spritePosePivotChangePatch = (
  sprite: SpritePlacementSource,
  pose: SpritePose,
  nextPivot: SpriteAnchor | null,
): Pick<SpritePose, 'pivot' | 'transform'> | null => {
  const currentImagePivot = pose.pivot ?? sprite.pivot;
  const nextImagePivot = nextPivot ?? sprite.pivot;
  const axis = spritePivotPx(sprite);
  const transform = compensateTransformForAnchorChange({
    currentAxis: axis,
    nextAxis: axis,
    currentImagePivot,
    nextImagePivot,
    rect: placeSpriteVisual(sprite, spritePoseVisual(sprite, pose)).rect,
    transform: pose.transform,
  });
  return transform ? { pivot: nextPivot, transform } : null;
};

/**
 * 기준점 드래그 프레임 - 표식이 놓이는 자리를 정하는 값. box는 요소 상자, rect는 표시 중인
 * 이미지 rect(보정 수식의 (W,H)), pivot·transform은 드래그 시작 시점 값
 */
export interface SpritePivotHandleFrame {
  box: SpriteBoxSource;
  rect: { width: number; height: number };
  pivot: SpriteAnchor;
  transform: SpriteTransform;
}

export interface SpritePosePivotHandleFrame {
  axis: { x: number; y: number };
  rect: { width: number; height: number };
  pivot: SpriteAnchor;
  transform: SpriteTransform;
}

/**
 * 기준점을 옮겨도 그림이 움직이지 않게 이동값을 보정한다.
 * 이미지의 한 점 u는 t + P + sR(u − p·(W,H))에 놓이므로, p→p'에서 같은 자리를
 * 유지하려면 t' = t + (P − P') + sR((p' − p)·(W,H)). 기본 이미지는 (W,H)가 상자라
 * t' = t + (I − sR)(P − P')가 된다. 결과가 이동값 범위를 넘으면 null
 */
export const compensateTransformForPivotDelta = (
  frame: SpritePivotHandleFrame,
  nextPivot: SpriteAnchor,
): SpriteTransform | null => {
  const current = spritePivotPx({ ...frame.box, pivot: frame.pivot });
  const next = spritePivotPx({ ...frame.box, pivot: nextPivot });
  return compensateTransformForAnchorChange({
    currentAxis: current,
    nextAxis: next,
    currentImagePivot: frame.pivot,
    nextImagePivot: nextPivot,
    rect: frame.rect,
    transform: frame.transform,
  });
};

export const compensateTransformForPivotChange = (
  sprite: SpritePlacementSource,
  visual: SpriteVisual,
  transform: SpriteTransform,
  nextPivot: SpriteAnchor,
): SpriteTransform | null =>
  compensateTransformForPivotDelta(
    {
      box: sprite,
      rect: placeSpriteVisual(sprite, visual).rect,
      pivot: sprite.pivot,
      transform,
    },
    nextPivot,
  );

export const compensateTransformForPosePivotDelta = (
  frame: SpritePosePivotHandleFrame,
  nextPivot: SpriteAnchor,
): SpriteTransform | null =>
  compensateTransformForAnchorChange({
    currentAxis: frame.axis,
    nextAxis: frame.axis,
    currentImagePivot: frame.pivot,
    nextImagePivot: nextPivot,
    rect: frame.rect,
    transform: frame.transform,
  });

/**
 * 기준점이 nextPivot일 때 표식(화면에서 실제로 회전이 일어나는 점)의 로컬 px.
 * 보정 transform으로 그린 P' + t'와 같은 자리 = P + t + sR((p' − p)·(W,H))
 */
export const pivotHandleLocalPoint = (
  frame: SpritePivotHandleFrame,
  nextPivot: SpriteAnchor,
): { x: number; y: number } => {
  const current = spritePivotPx({ ...frame.box, pivot: frame.pivot });
  const dpx = (nextPivot.x - frame.pivot.x) * frame.rect.width;
  const dpy = (nextPivot.y - frame.pivot.y) * frame.rect.height;
  const rad = frame.transform.rotation * DEG_TO_RAD;
  const cos = Math.cos(rad) * frame.transform.scale;
  const sin = Math.sin(rad) * frame.transform.scale;
  return {
    x: current.x + frame.transform.x + (dpx * cos - dpy * sin),
    y: current.y + frame.transform.y + (dpx * sin + dpy * cos),
  };
};

/**
 * 표식을 로컬 target에 놓는 기준점 - 위 식의 역변환. 포인터 이동량에 회전·배율의
 * 역행렬을 걸어 이미지 rect로 나눈다. 배율이 작으면 상자 안에서 표식이 닿을 수 있는
 * 범위도 그만큼 좁아지고, 그 밖은 0..1로 잘린다
 */
export const pivotForHandleTarget = (
  frame: SpritePivotHandleFrame,
  target: { x: number; y: number },
): SpriteAnchor => {
  const current = spritePivotPx({ ...frame.box, pivot: frame.pivot });
  const dx = target.x - current.x - frame.transform.x;
  const dy = target.y - current.y - frame.transform.y;
  const rad = frame.transform.rotation * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const scale = Math.max(frame.transform.scale, SPRITE_CONSTRAINTS.scale.min);
  const ux = (dx * cos + dy * sin) / scale;
  const uy = (-dx * sin + dy * cos) / scale;
  const { anchor } = SPRITE_CONSTRAINTS;
  return {
    x:
      frame.rect.width > 0
        ? clamp(frame.pivot.x + ux / frame.rect.width, anchor.min, anchor.max)
        : frame.pivot.x,
    y:
      frame.rect.height > 0
        ? clamp(frame.pivot.y + uy / frame.rect.height, anchor.min, anchor.max)
        : frame.pivot.y,
  };
};

export const posePivotHandleLocalPoint = (
  frame: SpritePosePivotHandleFrame,
  nextPivot: SpriteAnchor,
): { x: number; y: number } => {
  const dpx = (nextPivot.x - frame.pivot.x) * frame.rect.width;
  const dpy = (nextPivot.y - frame.pivot.y) * frame.rect.height;
  const rad = frame.transform.rotation * DEG_TO_RAD;
  const cos = Math.cos(rad) * frame.transform.scale;
  const sin = Math.sin(rad) * frame.transform.scale;
  return {
    x: frame.axis.x + frame.transform.x + (dpx * cos - dpy * sin),
    y: frame.axis.y + frame.transform.y + (dpx * sin + dpy * cos),
  };
};

export const posePivotForHandleTarget = (
  frame: SpritePosePivotHandleFrame,
  target: { x: number; y: number },
): SpriteAnchor => {
  const dx = target.x - frame.axis.x - frame.transform.x;
  const dy = target.y - frame.axis.y - frame.transform.y;
  const rad = frame.transform.rotation * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const scale = Math.max(frame.transform.scale, SPRITE_CONSTRAINTS.scale.min);
  const ux = (dx * cos + dy * sin) / scale;
  const uy = (-dx * sin + dy * cos) / scale;
  const { anchor } = SPRITE_CONSTRAINTS;
  return {
    x:
      frame.rect.width > 0
        ? clamp(frame.pivot.x + ux / frame.rect.width, anchor.min, anchor.max)
        : frame.pivot.x,
    y:
      frame.rect.height > 0
        ? clamp(frame.pivot.y + uy / frame.rect.height, anchor.min, anchor.max)
        : frame.pivot.y,
  };
};

/**
 * 표식 target에 가장 가까운 9점 프리셋 - 반경 안이면 그 프리셋, 아니면 null.
 * 배율이 작으면 프리셋 자리들이 몰리므로 반경을 이웃 간격의 절반 아래로 눌러
 * 한 자리가 두 프리셋에 동시에 걸리지 않게 한다 (첫 move에서 옆 프리셋으로 튀는 것 방지)
 */
export const snapPivotToPreset = (
  frame: SpritePivotHandleFrame,
  target: { x: number; y: number },
  radius: number,
): SpriteAnchor | null => {
  const spacing =
    (frame.transform.scale * Math.min(frame.rect.width, frame.rect.height)) / 2;
  const limit = Math.min(radius, spacing / 2 - 0.5);
  if (!(limit > 0)) return null;
  let best: SpriteAnchor | null = null;
  let bestDistance = Infinity;
  for (const preset of SPRITE_ANCHOR_PRESETS) {
    const at = pivotHandleLocalPoint(frame, preset);
    const distance = Math.hypot(at.x - target.x, at.y - target.y);
    if (distance <= limit && distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
};

export const snapPosePivotToPreset = (
  frame: SpritePosePivotHandleFrame,
  target: { x: number; y: number },
  radius: number,
): SpriteAnchor | null => {
  const spacing =
    (frame.transform.scale * Math.min(frame.rect.width, frame.rect.height)) / 2;
  const limit = Math.min(radius, spacing / 2 - 0.5);
  if (!(limit > 0)) return null;
  let best: SpriteAnchor | null = null;
  let bestDistance = Infinity;
  for (const preset of SPRITE_ANCHOR_PRESETS) {
    const at = posePivotHandleLocalPoint(frame, preset);
    const distance = Math.hypot(at.x - target.x, at.y - target.y);
    if (distance <= limit && distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
};
