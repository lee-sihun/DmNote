import { describe, expect, it } from 'vitest';
import {
  elementBoundsChanged,
  projectGroupElementBounds,
  shrinkLimitSize,
  uniformGroupScale,
  type Bounds,
  type ElementBounds,
} from './groupResizeUtils';

const ID_A = '00000000-0000-0000-0000-000000000001';
const ID_B = '00000000-0000-0000-0000-000000000002';

const boundsAt = (index: number, width = 40): ElementBounds => ({
  element: { type: 'key', id: ID_A, index },
  bounds: { x: 10, y: 20, width, height: 50 },
});

describe('elementBoundsChanged', () => {
  it('같은 요소의 locator index만 바뀌면 변경으로 취급하지 않는다', () => {
    expect(elementBoundsChanged([boundsAt(0)], [boundsAt(1)])).toBe(false);
  });

  it('같은 요소의 실제 bounds가 바뀌면 변경으로 취급한다', () => {
    expect(elementBoundsChanged([boundsAt(0)], [boundsAt(1, 41)])).toBe(true);
  });
});

describe('projectGroupElementBounds', () => {
  // 키 60x60 (0,0)과 스프라이트 200x125 (100,0)이 한 그룹: 300x125
  const key = { type: 'key', id: ID_A, index: 0 } as const;
  const sprite = { type: 'sprite', id: ID_B, index: 0 } as const;
  const keyBounds: Bounds = { x: 0, y: 0, width: 60, height: 60 };
  const spriteBounds: Bounds = { x: 100, y: 0, width: 200, height: 125 };
  const startGroup: Bounds = { x: 0, y: 0, width: 300, height: 125 };
  const rightHandle = { dx: 1, dy: 0 } as const;

  it('오른쪽 핸들로 가로만 늘리면 키는 늘어나고 스프라이트는 비율을 지킨다', () => {
    const nextGroup: Bounds = { x: 0, y: 0, width: 385.65, height: 125 };
    const scaleX = 385.65 / 300;

    const projectedKey = projectGroupElementBounds(
      key,
      keyBounds,
      startGroup,
      nextGroup,
      rightHandle,
    );
    expect(projectedKey.width).toBeCloseTo(60 * scaleX, 9);
    expect(projectedKey.height).toBe(60);

    const projected = projectGroupElementBounds(
      sprite,
      spriteBounds,
      startGroup,
      nextGroup,
      rightHandle,
    );
    // 257.1x125로 왜곡되지 않고 257.1x160.69로 함께 커진다
    expect(projected.width).toBeCloseTo(257.1, 9);
    expect(projected.height).toBeCloseTo(125 * scaleX, 9);
    expect(projected.width / projected.height).toBeCloseTo(200 / 125, 9);
    // 중심은 그룹 배율대로 옮겨 다른 요소와 같은 자리를 지킨다
    expect(projected.x + projected.width / 2).toBeCloseTo(200 * scaleX, 9);
    expect(projected.y + projected.height / 2).toBeCloseTo(62.5, 9);
  });

  it('두 축 배율이 같으면 비율 고정 요소도 일반 투영과 같은 상자를 얻는다', () => {
    const nextGroup: Bounds = { x: 10, y: 20, width: 600, height: 250 };
    const projected = projectGroupElementBounds(
      sprite,
      spriteBounds,
      startGroup,
      nextGroup,
      { dx: 1, dy: 1 },
    );
    expect(projected).toEqual({ x: 210, y: 20, width: 400, height: 250 });
  });

  it('모서리 핸들은 변화가 큰 축의 배율을 따른다', () => {
    expect(uniformGroupScale(1.5, 1.1, { dx: 1, dy: 1 })).toBe(1.5);
    expect(uniformGroupScale(1.1, 0.5, { dx: -1, dy: 1 })).toBe(0.5);
    expect(uniformGroupScale(1.5, 1.1, { dx: 0, dy: 1 })).toBe(1.1);
    expect(uniformGroupScale(1.5, 1.1, { dx: -1, dy: 0 })).toBe(1.5);
  });

  it('비율 고정 요소의 축소 한계는 어느 축이든 짧은 변으로 잰다', () => {
    expect(shrinkLimitSize(sprite, spriteBounds, 'x')).toBe(125);
    expect(shrinkLimitSize(sprite, spriteBounds, 'y')).toBe(125);
    expect(shrinkLimitSize(key, { ...keyBounds, width: 80 }, 'x')).toBe(80);
    expect(shrinkLimitSize(key, { ...keyBounds, width: 80 }, 'y')).toBe(60);
  });
});
