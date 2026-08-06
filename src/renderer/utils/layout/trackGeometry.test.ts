import { describe, expect, it } from 'vitest';
import {
  computeTrackGeometry,
  keyEdgeHitline,
  resolveEffectiveDirection,
  trackRectFromOrigin,
  type TrackGeometryInput,
} from './trackGeometry';

// 키 rect: (100, 200) 크기 60×40
const KEY = { keyX: 100, keyY: 200, keyWidth: 60, keyHeight: 40 };
const BASE: TrackGeometryInput = {
  ...KEY,
  direction: 'up',
  trackHeight: 300,
};

describe('resolveEffectiveDirection', () => {
  it('키별 오버라이드가 우선하고 미설정은 상속한다', () => {
    expect(resolveEffectiveDirection('down', 'left')).toBe('down');
    expect(resolveEffectiveDirection(undefined, 'left')).toBe('left');
  });
});

describe('keyEdgeHitline', () => {
  it('방향별 키 자신의 변을 반환한다', () => {
    expect(keyEdgeHitline('up', KEY)).toBe(200);
    expect(keyEdgeHitline('down', KEY)).toBe(240);
    expect(keyEdgeHitline('left', KEY)).toBe(100);
    expect(keyEdgeHitline('right', KEY)).toBe(160);
  });
});

describe('computeTrackGeometry - 세로 (up/down)', () => {
  it('up + center 정렬은 기존 수식과 일치한다 (파리티)', () => {
    const g = computeTrackGeometry({ ...BASE, noteWidth: 20 });
    // 기존: dx + (keyWidth - noteWidth)/2 = 100 + 20 = 120, dy = keyY = 200
    expect(g.crossStart).toBe(120);
    expect(g.crossSize).toBe(20);
    expect(g.origin).toEqual({ x: 120, y: 200 });
    expect(g.rect).toEqual({ minX: 120, maxX: 140, minY: -100, maxY: 200 });
  });

  it('up 정렬 3종의 crossStart', () => {
    const left = computeTrackGeometry({
      ...BASE,
      noteWidth: 20,
      noteAlignment: 'left',
    });
    const right = computeTrackGeometry({
      ...BASE,
      noteWidth: 20,
      noteAlignment: 'right',
    });
    expect(left.crossStart).toBe(100);
    expect(right.crossStart).toBe(140);
  });

  it('noteWidth 미설정·무효는 키 너비로 폴백하고 최소 1을 보장한다', () => {
    expect(computeTrackGeometry(BASE).crossSize).toBe(60);
    expect(
      computeTrackGeometry({ ...BASE, noteWidth: Number.NaN }).crossSize,
    ).toBe(60);
    expect(computeTrackGeometry({ ...BASE, noteWidth: 0.5 }).crossSize).toBe(1);
  });

  it('오프셋은 화면 절대: 세로에서 X는 교차축, Y는 히트라인', () => {
    const g = computeTrackGeometry({
      ...BASE,
      noteWidth: 20,
      noteOffsetX: 7,
      noteOffsetY: -3,
    });
    expect(g.crossStart).toBe(127);
    expect(g.hitline).toBe(197);
  });

  it('down은 O가 오른쪽 코너이고 rect가 키 아래로 확장된다', () => {
    const g = computeTrackGeometry({
      ...BASE,
      direction: 'down',
      noteWidth: 20,
    });
    expect(g.hitline).toBe(240);
    expect(g.origin).toEqual({ x: 140, y: 240 });
    expect(g.rect).toEqual({ minX: 120, maxX: 140, minY: 240, maxY: 540 });
  });

  it('hitline 지정(자동 보정 기준선)이 키 변을 대체한다', () => {
    const g = computeTrackGeometry({ ...BASE, hitline: 330, noteOffsetY: 5 });
    expect(g.hitline).toBe(335);
    expect(g.origin.y).toBe(335);
  });
});

describe('computeTrackGeometry - 가로 (left/right)', () => {
  it('left는 교차축이 Y로 회전하고 left 정렬이 위쪽이다', () => {
    const g = computeTrackGeometry({
      ...BASE,
      direction: 'left',
      noteWidth: 10,
      noteAlignment: 'left',
    });
    // 교차축 기준 = 키 높이 40, left → keyY
    expect(g.crossStart).toBe(200);
    expect(g.crossSize).toBe(10);
    expect(g.hitline).toBe(100);
    // O = (hit, crossStart + crossSize) - +c(위쪽)가 rect 내부
    expect(g.origin).toEqual({ x: 100, y: 210 });
    expect(g.rect).toEqual({ minX: -200, maxX: 100, minY: 200, maxY: 210 });
  });

  it('right는 O가 위 코너이고 rect가 키 오른쪽으로 확장된다', () => {
    const g = computeTrackGeometry({
      ...BASE,
      direction: 'right',
      noteWidth: 10,
      noteAlignment: 'right',
    });
    // right 정렬 → 아래쪽: crossStart = keyY + (40 - 10) = 230
    expect(g.crossStart).toBe(230);
    expect(g.hitline).toBe(160);
    expect(g.origin).toEqual({ x: 160, y: 230 });
    expect(g.rect).toEqual({ minX: 160, maxX: 460, minY: 230, maxY: 240 });
  });

  it('가로에서 noteWidth 미설정은 키 높이로 폴백한다', () => {
    const g = computeTrackGeometry({ ...BASE, direction: 'right' });
    expect(g.crossSize).toBe(40);
  });

  it('가로 오프셋: X는 히트라인, Y는 교차축', () => {
    const g = computeTrackGeometry({
      ...BASE,
      direction: 'left',
      noteWidth: 10,
      noteOffsetX: -4,
      noteOffsetY: 6,
    });
    expect(g.hitline).toBe(96);
    expect(g.crossStart).toBe(221);
  });
});

describe('trackRectFromOrigin', () => {
  it('4방향 모두 computeTrackGeometry의 rect와 일치한다', () => {
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      const g = computeTrackGeometry({
        ...BASE,
        direction,
        noteWidth: 24,
        noteAlignment: 'left',
        noteOffsetX: 3,
        noteOffsetY: -2,
      });
      expect(
        trackRectFromOrigin(g.origin, direction, BASE.trackHeight, g.crossSize),
      ).toEqual(g.rect);
    }
  });
});
