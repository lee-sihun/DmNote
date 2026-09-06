import { SPRITE_CONSTRAINTS } from '@src/types/key/sprites';
import type {
  SpriteAnchor,
  SpriteRect,
  SpriteTransform,
} from '@src/types/key/sprites';

import { clamp } from '@utils/core/clamp';

// 스프라이트 좌표 변환 프리미티브. 도달 범위·배치·핸들·패널이 공유한다

export { DEG_TO_RAD, RAD_TO_DEG } from '@utils/core/rotation';

/** 정규화 앵커를 rect 안의 요소 로컬 px로 */
export const anchorPx = (
  rect: SpriteRect,
  anchor: SpriteAnchor,
): { x: number; y: number } => ({
  x: rect.x + anchor.x * rect.width,
  y: rect.y + anchor.y * rect.height,
});

/** 기준점 P - 요소 상자 기준 로컬 px. 회전·배율 축이자 자세 이미지의 고정점 */
export const spritePivotPx = (sprite: {
  width: number;
  height: number;
  pivot: SpriteAnchor;
}): { x: number; y: number } => ({
  x: sprite.pivot.x * sprite.width,
  y: sprite.pivot.y * sprite.height,
});

// 정규화 앵커 [0, 1]과 UI 백분율의 왕복. 표시는 소수 첫째 자리까지
export const anchorToPercent = (value: number): number =>
  Math.round(value * 1000) / 10;

export const percentToAnchor = (percent: number): number =>
  clamp(
    percent,
    SPRITE_CONSTRAINTS.anchor.min * 100,
    SPRITE_CONSTRAINTS.anchor.max * 100,
  ) / 100;

// 기준점 프리셋 9점 - 모서리·변 중앙·중심. 패널 위젯과 캔버스 스냅이 같은 표를 쓴다
export const SPRITE_ANCHOR_PRESETS: readonly SpriteAnchor[] = Object.freeze(
  [0, 0.5, 1].flatMap((y) =>
    [0, 0.5, 1].map((x) => Object.freeze({ x, y }) as SpriteAnchor),
  ),
);

export const isSameSpriteAnchor = (a: SpriteAnchor, b: SpriteAnchor): boolean =>
  a.x === b.x && a.y === b.y;

export const isSameSpriteTransform = (
  a: SpriteTransform,
  b: SpriteTransform,
): boolean =>
  a.x === b.x &&
  a.y === b.y &&
  a.rotation === b.rotation &&
  a.scale === b.scale;

/** 프리셋 중 하나와 정확히 같으면 그 프리셋, 아니면 null */
export const matchSpriteAnchorPreset = (
  anchor: SpriteAnchor,
): SpriteAnchor | null =>
  SPRITE_ANCHOR_PRESETS.find((preset) => isSameSpriteAnchor(preset, anchor)) ??
  null;
