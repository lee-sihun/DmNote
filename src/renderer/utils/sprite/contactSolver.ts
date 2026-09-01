import type {
  SpriteAnchor,
  SpriteRect,
  SpriteTransform,
} from '@src/types/key/sprites';
import { SPRITE_CONSTRAINTS } from '@src/types/key/sprites';

import { clamp } from '@utils/core/clamp';
import { DEG_TO_RAD, RAD_TO_DEG, anchorPx } from './spriteGeometry';

// 핀(손끝) 기반 자세 역산 - 에디터 전용 순수 기하.
// 좌표계는 요소 로컬 px. transform은 translate → rotate → scale 순서이고
// pivot(transform-origin)이 회전·배율의 축이므로
// 손끝 월드 = t + A + R(θ)·s·(C − A)  (A=축 px, C=핀 px)

export interface ContactGeometry {
  imageRect: SpriteRect;
  /** 이미지 정규화 [0,1] - 회전·배율 축 */
  pivot: SpriteAnchor;
  /** 이미지 정규화 [0,1] - 키에 닿는 지점 */
  contactPoint: SpriteAnchor;
}

export type ContactSolveResult =
  | { status: 'ok'; transform: SpriteTransform }
  // 핀과 축이 같은 지점 - 방향·길이가 정의되지 않아 조작 불가
  | { status: 'degenerate' };

// 핀·축 거리, 목표 벡터가 이보다 짧으면 방향이 정의되지 않은 것으로 본다
const CONTACT_EPSILON = 1e-6;

// atan2 차(-360~360도)를 최단 호 표현(-180~180]으로 접는다
const wrapDegrees = (deg: number): number => {
  const wrapped = ((deg + 540) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
};

/** 현재 transform이 적용된 핀의 요소 로컬 위치 */
export const contactWorldPosition = (
  geometry: ContactGeometry,
  transform: SpriteTransform,
): { x: number; y: number } => {
  const axis = anchorPx(geometry.imageRect, geometry.pivot);
  const contact = anchorPx(geometry.imageRect, geometry.contactPoint);
  const rad = transform.rotation * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (contact.x - axis.x) * transform.scale;
  const dy = (contact.y - axis.y) * transform.scale;
  return {
    x: transform.x + axis.x + dx * cos - dy * sin,
    y: transform.y + axis.y + dx * sin + dy * cos,
  };
};

/**
 * 축 고정 역산 - x·y를 유지한 채 핀이 목표를 향하도록 rotation을,
 * stretch면 scale까지 계산한다. 몸에 붙은 팔을 키에 뻗는 조작
 */
export const solveTransformTowardTarget = (
  geometry: ContactGeometry,
  current: SpriteTransform,
  target: { x: number; y: number },
  stretch: boolean,
): ContactSolveResult => {
  const axis = anchorPx(geometry.imageRect, geometry.pivot);
  const contact = anchorPx(geometry.imageRect, geometry.contactPoint);
  const vx = contact.x - axis.x;
  const vy = contact.y - axis.y;
  const baseLength = Math.hypot(vx, vy);
  if (baseLength <= CONTACT_EPSILON) return { status: 'degenerate' };

  // 축의 월드 위치(x·y 유지)에서 목표까지의 벡터
  const gx = target.x - (current.x + axis.x);
  const gy = target.y - (current.y + axis.y);
  const targetLength = Math.hypot(gx, gy);
  if (targetLength <= CONTACT_EPSILON) return { status: 'degenerate' };

  const rotation = wrapDegrees(
    (Math.atan2(gy, gx) - Math.atan2(vy, vx)) * RAD_TO_DEG,
  );
  const { scale, rotation: rotationRange } = SPRITE_CONSTRAINTS;
  return {
    status: 'ok',
    transform: {
      ...current,
      rotation: clamp(rotation, rotationRange.min, rotationRange.max),
      scale: stretch
        ? clamp(targetLength / baseLength, scale.min, scale.max)
        : current.scale,
    },
  };
};

/**
 * 핀 고정 역산 - rotation·scale이 바뀌어도 핀 월드 위치가 고정점에 남도록
 * x·y를 계산한다. 이미 키에 올린 손의 각도만 다듬는 조작.
 * clamp에 걸리면 닿는 데까지만 간다
 */
export const solveTranslationKeepingContact = (
  geometry: ContactGeometry,
  next: Pick<SpriteTransform, 'rotation' | 'scale'>,
  contactWorld: { x: number; y: number },
): ContactSolveResult => {
  const axis = anchorPx(geometry.imageRect, geometry.pivot);
  const contact = anchorPx(geometry.imageRect, geometry.contactPoint);
  const vx = contact.x - axis.x;
  const vy = contact.y - axis.y;
  if (Math.hypot(vx, vy) <= CONTACT_EPSILON) return { status: 'degenerate' };

  const rad = next.rotation * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = vx * next.scale;
  const dy = vy * next.scale;
  const { offset } = SPRITE_CONSTRAINTS;
  return {
    status: 'ok',
    transform: {
      rotation: next.rotation,
      scale: next.scale,
      x: clamp(
        contactWorld.x - axis.x - (dx * cos - dy * sin),
        offset.min,
        offset.max,
      ),
      y: clamp(
        contactWorld.y - axis.y - (dx * sin + dy * cos),
        offset.min,
        offset.max,
      ),
    },
  };
};
