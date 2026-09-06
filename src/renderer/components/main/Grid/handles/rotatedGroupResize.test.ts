import { describe, expect, it } from 'vitest';
import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
import { rotatePointAround } from '@utils/element/rotation';
import type { GroupResizeHandle } from './groupResizePlan';
import type { Bounds, ElementBounds } from './groupResizeUtils';
import {
  calculateRotatedGroupResizePlan,
  type GroupRotationFrame,
} from './rotatedGroupResize';
import { isBoundsTransitionWithinEditorLimits } from './resizeLimits';

const handles: GroupResizeHandle[] = [
  ['nw', -1, -1],
  ['n', 0, -1],
  ['ne', 1, -1],
  ['w', -1, 0],
  ['e', 1, 0],
  ['sw', -1, 1],
  ['s', 0, 1],
  ['se', 1, 1],
].map(([id, x, y]) => {
  const dx = x as -1 | 0 | 1;
  const dy = y as -1 | 0 | 1;
  return {
    id: id as string,
    cursor: 'nwse-resize',
    dx,
    dy,
    x: (dx + 1) / 2,
    y: (dy + 1) / 2,
    type: dx === 0 ? 'edge-h' : dy === 0 ? 'edge-v' : 'corner',
  };
});
const east = handles.find(({ id }) => id === 'e')!;
const frame: Bounds = { x: -100, y: 20, width: 400, height: 300 };
const elements: ElementBounds[] = [
  {
    element: { type: 'key', id: 'key', index: 0 },
    bounds: { x: -20, y: 70, width: 60, height: 30 },
  },
  {
    element: { type: 'stat', id: 'stat', index: 0 },
    bounds: { x: 90, y: 95, width: 45, height: 15 },
  },
  {
    element: { type: 'graph', id: 'graph', index: 0 },
    bounds: { x: 120, y: 80, width: 80, height: 60 },
  },
  {
    element: { type: 'knob', id: 'knob', index: 0 },
    bounds: { x: 20, y: 180, width: 50, height: 50 },
  },
  {
    element: { type: 'sprite', id: 'sprite', index: 0 },
    bounds: { x: -60, y: 140, width: 90, height: 45 },
  },
];
const pointOnFrame = (bounds: Bounds, rotation: number, x: number, y: number) =>
  rotatePointAround(
    { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y },
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    rotation,
  );
const resize = (
  rotationFrame: GroupRotationFrame,
  entries: ElementBounds[],
  deltaX: number,
  deltaY: number,
  handle = east,
  snapSize = 0,
) =>
  calculateRotatedGroupResizePlan({
    rotationFrame,
    startElementBounds: entries,
    deltaX,
    deltaY,
    handle,
    snapSize,
  });

describe('회전한 그룹의 균등 리사이즈', () => {
  it.each(handles)(
    '$id 핸들은 반대 고정점과 멤버의 모든 시각 꼭짓점 배치를 보존한다',
    (handle) => {
      for (const rotation of [0, 30, 90, -135, 180]) {
        const localDelta = {
          x: handle.dx * frame.width * 0.5,
          y: handle.dy * frame.height * 0.5,
        };
        const delta = rotatePointAround(localDelta, { x: 0, y: 0 }, rotation);
        const result = resize(
          { bounds: frame, rotation },
          elements,
          delta.x,
          delta.y,
          handle,
        ).result;
        const anchor = pointOnFrame(
          frame,
          rotation,
          1 - handle.x,
          1 - handle.y,
        );
        const nextAnchor = pointOnFrame(
          result.groupBounds,
          rotation,
          1 - handle.x,
          1 - handle.y,
        );
        expect(nextAnchor.x).toBeCloseTo(anchor.x, 8);
        expect(nextAnchor.y).toBeCloseTo(anchor.y, 8);
        expect(result.groupBounds.width / frame.width).toBeCloseTo(1.5, 10);
        expect(result.groupBounds.height / frame.height).toBeCloseTo(1.5, 10);
        result.elementBounds.forEach(({ element, bounds }, index) => {
          expect(element).toBe(elements[index].element);
          const before = elements[index].bounds;
          const angle = [45, -30, 90, 135, 0][index];
          expect(bounds.width / before.width).toBeCloseTo(1.5, 10);
          expect(bounds.height / before.height).toBeCloseTo(1.5, 10);
          for (const [x, y] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]) {
            const oldCorner = pointOnFrame(before, angle, x, y);
            const newCorner = pointOnFrame(bounds, angle, x, y);
            expect(newCorner.x).toBeCloseTo(
              anchor.x + 1.5 * (oldCorner.x - anchor.x),
              8,
            );
            expect(newCorner.y).toBeCloseTo(
              anchor.y + 1.5 * (oldCorner.y - anchor.y),
              8,
            );
          }
        });
      }
    },
  );

  it('회전 프레임의 로컬 이동만 스냅하고 요소 좌표는 따로 반올림하지 않는다', () => {
    const bounds = { x: 1.3, y: 4.7, width: 150, height: 90 };
    const result = resize({ bounds, rotation: 90 }, elements, 0, 17, east, 10);
    const scale = 170 / 150;
    expect(result.guides).toEqual({ type: 'clear' });
    for (let index = 0; index < elements.length; index += 1) {
      const before = elements[index].bounds;
      const after = result.result.elementBounds[index].bounds;
      expect(after.width / before.width).toBeCloseTo(scale, 10);
      expect(after.height / before.height).toBeCloseTo(scale, 10);
    }
    expect(result.result.elementBounds[0].bounds.x % 10).not.toBe(0);
  });

  it('좌표 상한에 닿으면 모든 요소의 배율을 함께 줄인다', () => {
    const entries: ElementBounds[] = [
      { ...elements[0], bounds: { x: 32760, y: 0, width: 40, height: 40 } },
      { ...elements[1], bounds: { x: 32100, y: 50, width: 20, height: 30 } },
    ];
    const result = resize(
      { bounds: { x: 32000, y: 0, width: 1000, height: 100 }, rotation: 90 },
      entries,
      0,
      1000,
    ).result;
    const scale = result.elementBounds[0].bounds.width / 40;
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThan(2);
    expect(result.elementBounds[0].bounds.x).toBeCloseTo(
      EDITOR_BOUNDS_LIMITS.maxAbsCoordinate,
      6,
    );
    result.elementBounds.forEach(({ bounds }, index) => {
      expect(
        isBoundsTransitionWithinEditorLimits(entries[index].bounds, bounds),
      ).toBe(true);
      expect(bounds.width / entries[index].bounds.width).toBeCloseTo(scale, 12);
      expect(bounds.height / entries[index].bounds.height).toBeCloseTo(
        scale,
        12,
      );
    });
  });

  it('한 요소의 치수 상한이 전체 확대를 제한한다', () => {
    const entries = [
      { ...elements[0], bounds: { x: 0, y: 0, width: 32000, height: 100 } },
      { ...elements[1], bounds: { x: 1, y: 1, width: 20, height: 30 } },
    ];
    const result = resize(
      { bounds: { x: 0, y: 0, width: 32000, height: 100 }, rotation: 0 },
      entries,
      32000,
      0,
    ).result;
    const scale = EDITOR_BOUNDS_LIMITS.maxDimension / 32000;
    expect(result.elementBounds[0].bounds.width).toBe(
      EDITOR_BOUNDS_LIMITS.maxDimension,
    );
    expect(result.elementBounds[1].bounds.width).toBe(20 * scale);
    expect(result.elementBounds[1].bounds.height).toBe(30 * scale);
  });

  it('축소 하한과 이미 얇은 스프라이트 축을 같은 배율로 보존한다', () => {
    const entries = [
      { ...elements[0], bounds: { x: 0, y: 0, width: 40, height: 20 } },
      { ...elements[4], bounds: { x: 100, y: 20, width: 400, height: 0.1 } },
    ];
    const result = resize(
      { bounds: { x: 0, y: 0, width: 500, height: 40 }, rotation: 30 },
      entries,
      -500,
      -500,
    ).result;
    expect(result.elementBounds[0].bounds.width).toBe(20);
    expect(result.elementBounds[0].bounds.height).toBe(10);
    expect(result.elementBounds[1].bounds.width).toBe(200);
    expect(result.elementBounds[1].bounds.height).toBe(0.05);
  });

  it('범위 밖 legacy 치수의 확대를 막고 감소는 허용한다', () => {
    const entries = [
      { ...elements[0], bounds: { x: 0, y: 0, width: 40000, height: 100 } },
    ];
    const rotationFrame = { bounds: entries[0].bounds, rotation: 0 };
    expect(
      resize(rotationFrame, entries, 40000, 0).result.elementBounds,
    ).toEqual(entries);
    expect(
      resize(rotationFrame, entries, -20000, 0).result.elementBounds[0].bounds
        .width,
    ).toBe(20000);
  });

  it('이동이 없거나 입력이 유효하지 않으면 시작 값을 그대로 돌려준다', () => {
    const rotationFrame = { bounds: frame, rotation: 45 };
    for (const [x, y] of [
      [0, 0],
      [Infinity, 3],
      [1, NaN],
    ]) {
      const result = resize(rotationFrame, elements, x, y).result;
      expect(result.groupBounds).toEqual(frame);
      expect(result.elementBounds).toEqual(elements);
    }
  });
});
