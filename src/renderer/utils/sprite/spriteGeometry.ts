import { SPRITE_CONSTRAINTS } from '@src/types/key/sprites';
import type { SpriteAnchor, SpriteRect } from '@src/types/key/sprites';

import { clamp } from '@utils/core/clamp';

// 스프라이트 좌표 변환 프리미티브. 도달 범위·핀 역산·기즈모·패널이 공유한다

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/** 이미지 정규화 앵커를 요소 로컬 px로 */
export const anchorPx = (
  rect: SpriteRect,
  anchor: SpriteAnchor,
): { x: number; y: number } => ({
  x: rect.x + anchor.x * rect.width,
  y: rect.y + anchor.y * rect.height,
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
