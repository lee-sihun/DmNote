import type { NoteDirection } from '@src/types/settings/noteSettings';

// 노트 트랙 지오메트리의 단일 정의 (계약 v2.4 §5, architecture §1·§5)
// 좌표계: 캔버스 DOM 좌표 (y 아래 양수)
// d = 진행 방향 벡터, p = 교차축 벡터 (p = (-d.y, d.x))
// origin O = 히트라인의 c=0 코너. +c(p 방향)가 트랙 rect 내부로 향하는 코너를 선택

export const DIRECTION_VECTORS: Record<
  NoteDirection,
  { d: { x: number; y: number }; p: { x: number; y: number } }
> = {
  up: { d: { x: 0, y: -1 }, p: { x: 1, y: 0 } },
  down: { d: { x: 0, y: 1 }, p: { x: -1, y: 0 } },
  left: { d: { x: -1, y: 0 }, p: { x: 0, y: -1 } },
  right: { d: { x: 1, y: 0 }, p: { x: 0, y: 1 } },
};

export const isVerticalDirection = (direction: NoteDirection): boolean =>
  direction === 'up' || direction === 'down';

// 유효 방향 = 키별 오버라이드 ?? 병합(전역+탭) 설정 (계약 §2 단일 해석 지점용)
export const resolveEffectiveDirection = (
  keyOverride: NoteDirection | undefined,
  merged: NoteDirection,
): NoteDirection => keyOverride ?? merged;

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TrackGeometryInput {
  keyX: number;
  keyY: number;
  keyWidth: number;
  keyHeight: number;
  direction: NoteDirection;
  trackHeight: number;
  // 미설정/무효 = 교차축 자동 (세로: 키 너비, 가로: 키 높이)
  noteWidth?: number;
  noteAlignment?: 'left' | 'center' | 'right';
  // 화면 절대 오프셋 (방향과 무관하게 회전하지 않음)
  noteOffsetX?: number;
  noteOffsetY?: number;
  // 흐름축 히트라인 좌표 (방향 그룹 공통 기준선). 미지정 = 키 자신의 변
  hitline?: number;
}

export interface TrackGeometry {
  direction: NoteDirection;
  // 셰이더 O: 히트라인의 c=0 코너
  origin: { x: number; y: number };
  crossStart: number;
  crossSize: number;
  hitline: number;
  rect: Rect;
}

// autoCorrection false일 때 트랙이 시작하는 키 자신의 변
export const keyEdgeHitline = (
  direction: NoteDirection,
  key: { keyX: number; keyY: number; keyWidth: number; keyHeight: number },
): number => {
  switch (direction) {
    case 'up':
      return key.keyY;
    case 'down':
      return key.keyY + key.keyHeight;
    case 'left':
      return key.keyX;
    case 'right':
      return key.keyX + key.keyWidth;
  }
};

// origin(c=0 코너) 기준 트랙 rect 복원 (crop bounds 등 origin만 아는 소비처용)
export const trackRectFromOrigin = (
  origin: { x: number; y: number },
  direction: NoteDirection,
  trackHeight: number,
  crossSize: number,
): Rect => {
  switch (direction) {
    case 'up':
      return {
        minX: origin.x,
        maxX: origin.x + crossSize,
        minY: origin.y - trackHeight,
        maxY: origin.y,
      };
    case 'down':
      return {
        minX: origin.x - crossSize,
        maxX: origin.x,
        minY: origin.y,
        maxY: origin.y + trackHeight,
      };
    case 'left':
      return {
        minX: origin.x - trackHeight,
        maxX: origin.x,
        minY: origin.y - crossSize,
        maxY: origin.y,
      };
    case 'right':
      return {
        minX: origin.x,
        maxX: origin.x + trackHeight,
        minY: origin.y,
        maxY: origin.y + crossSize,
      };
  }
};

export const computeTrackGeometry = (
  input: TrackGeometryInput,
): TrackGeometry => {
  const {
    keyX,
    keyY,
    keyWidth,
    keyHeight,
    direction,
    trackHeight,
    noteWidth,
    noteAlignment,
    noteOffsetX,
    noteOffsetY,
    hitline,
  } = input;
  const vertical = isVerticalDirection(direction);

  // 교차축 크기: 기존 'up' 검증 로직과 동일 (유한 숫자만, 최소 1)
  const crossBase = vertical ? keyWidth : keyHeight;
  const crossSize =
    typeof noteWidth === 'number' && Number.isFinite(noteWidth)
      ? Math.max(1, noteWidth)
      : crossBase;

  // 정렬: 세로는 X축(left/center/right), 가로는 Y축으로 회전 (left→위)
  const align = noteAlignment ?? 'center';
  const alignOffset =
    align === 'left'
      ? 0
      : align === 'right'
      ? crossBase - crossSize
      : (crossBase - crossSize) / 2;

  const offsetX = noteOffsetX ?? 0;
  const offsetY = noteOffsetY ?? 0;

  const crossStart = vertical
    ? keyX + alignOffset + offsetX
    : keyY + alignOffset + offsetY;
  const hit =
    (hitline ??
      keyEdgeHitline(direction, { keyX, keyY, keyWidth, keyHeight })) +
    (vertical ? offsetY : offsetX);

  // O 코너 표 (architecture §5): +c가 rect 내부로 향하는 코너
  let origin: { x: number; y: number };
  switch (direction) {
    case 'up':
      origin = { x: crossStart, y: hit };
      break;
    case 'down':
      origin = { x: crossStart + crossSize, y: hit };
      break;
    case 'left':
      origin = { x: hit, y: crossStart + crossSize };
      break;
    case 'right':
      origin = { x: hit, y: crossStart };
      break;
  }

  return {
    direction,
    origin,
    crossStart,
    crossSize,
    hitline: hit,
    rect: trackRectFromOrigin(origin, direction, trackHeight, crossSize),
  };
};
