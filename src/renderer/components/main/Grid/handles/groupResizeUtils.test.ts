import { describe, expect, it } from 'vitest';

import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
import {
  limitGroupGrowth,
  elementBoundsChanged,
  projectGroupElementBounds,
  shrinkLimitSize,
  uniformGroupScale,
  type Bounds,
  type ElementBounds,
} from './groupResizeUtils';
import { isBoundsWithinEditorLimits } from './resizeLimits';

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

  it('비율 고정 요소에 이미 얇은 축이 있으면 정상 축을 하한 기준으로 쓴다', () => {
    const thin = { ...spriteBounds, width: 400, height: 0.1 };
    expect(shrinkLimitSize(sprite, thin, 'x', 10)).toBe(400);
    expect(shrinkLimitSize(sprite, thin, 'y', 10)).toBe(400);
    expect(shrinkLimitSize(sprite, { ...thin, width: 1 }, 'x', 10)).toBe(0.1);
  });
});

describe('limitGroupGrowth', () => {
  const limits = EDITOR_BOUNDS_LIMITS;
  const key = { type: 'key', id: ID_A, index: 0 } as const;
  const sprite = { type: 'sprite', id: ID_B, index: 0 } as const;
  const bottomHandle = { dx: 0, dy: 1 } as const;
  const rightHandle = { dx: 1, dy: 0 } as const;
  const leftHandle = { dx: -1, dy: 0 } as const;

  it('상한 안이면 후보를 그대로 돌려준다', () => {
    const bounds: Bounds = { x: 0, y: 0, width: 200, height: 125 };
    const candidate: Bounds = { x: 0, y: 0, width: 200, height: 250 };
    expect(
      limitGroupGrowth(
        [{ element: sprite, bounds }],
        { ...bounds },
        candidate,
        bottomHandle,
        limits,
      ),
    ).toEqual({ bounds: candidate, limitedWidth: false, limitedHeight: false });
  });

  it('얇은 스프라이트의 세로 확대는 파생 폭이 32768에 닿는 진행 배율에서 멈춘다', () => {
    const bounds: Bounds = { x: 0, y: 0, width: 400, height: 0.1 };
    const start: Bounds = { ...bounds };
    // 세로 배율 100 → 단일 배율로 폭 40000
    const candidate: Bounds = { x: 0, y: 0, width: 400, height: 10 };
    const result = limitGroupGrowth(
      [{ element: sprite, bounds }],
      start,
      candidate,
      bottomHandle,
      limits,
    );
    expect(result.limitedHeight).toBe(true);
    expect(result.limitedWidth).toBe(false);
    const projected = projectGroupElementBounds(
      sprite,
      bounds,
      start,
      result.bounds,
      bottomHandle,
    );
    expect(isBoundsWithinEditorLimits(projected)).toBe(true);
    expect(projected.width).toBeGreaterThan(32767);
    expect(projected.width / 400).toBeCloseTo(projected.height / 0.1, 6);
  });

  it('혼합 그룹은 가장 먼저 닿는 제약이 진행을 정한다 (여기서는 키의 저장 좌표)', () => {
    const spriteBounds: Bounds = { x: 0, y: 0, width: 400, height: 0.1 };
    const keyBounds: Bounds = { x: 500, y: 0, width: 100, height: 100 };
    const elements = [
      { element: sprite, bounds: spriteBounds },
      { element: key, bounds: keyBounds },
    ];
    const start: Bounds = { x: 0, y: 0, width: 600, height: 100 };
    // 가로 배율 1000. 스프라이트 폭은 81.92배, 키 x=500은 65.536배에서 32768에 닿는다
    const candidate: Bounds = { x: 0, y: 0, width: 600000, height: 100 };
    const result = limitGroupGrowth(
      elements,
      start,
      candidate,
      rightHandle,
      limits,
    );
    const projected = elements.map(({ element, bounds }) =>
      projectGroupElementBounds(
        element,
        bounds,
        start,
        result.bounds,
        rightHandle,
      ),
    );
    expect(projected.every(isBoundsWithinEditorLimits)).toBe(true);
    expect(projected[1].x).toBeGreaterThan(32767);
    expect(projected[0].width).toBeCloseTo(400 * 65.536, 3);
  });

  it('저장 좌표 상한도 진행을 막는다', () => {
    // 왼쪽 핸들 확대는 요소 x를 -32768 아래로 민다
    const bounds: Bounds = { x: -32000, y: 0, width: 100, height: 100 };
    const start: Bounds = { ...bounds };
    const candidate: Bounds = { x: -34000, y: 0, width: 2100, height: 100 };
    const result = limitGroupGrowth(
      [{ element: key, bounds }],
      start,
      candidate,
      leftHandle,
      limits,
    );
    const projected = projectGroupElementBounds(
      key,
      bounds,
      start,
      result.bounds,
      leftHandle,
    );
    expect(projected.x).toBeGreaterThanOrEqual(-32768);
    expect(projected.x).toBeLessThan(-32700);
    expect(result.limitedWidth).toBe(true);
  });

  it('범위 밖 legacy 요소가 있어도 그 항목을 건드리지 않는 직교축 리사이즈는 통과한다', () => {
    // 폭 40000 legacy 키 + 정상 키. 아래 핸들로 높이만 두 배
    const legacyBounds: Bounds = { x: 0, y: 0, width: 40000, height: 100 };
    const keyBounds: Bounds = { x: 0, y: 100, width: 100, height: 100 };
    const elements = [
      {
        element: { type: 'key', id: ID_A, index: 0 } as const,
        bounds: legacyBounds,
      },
      { element: key, bounds: keyBounds },
    ];
    const start: Bounds = { x: 0, y: 0, width: 40000, height: 200 };
    const candidate: Bounds = { x: 0, y: 0, width: 40000, height: 400 };
    const result = limitGroupGrowth(
      elements,
      start,
      candidate,
      bottomHandle,
      limits,
    );
    expect(result).toEqual({
      bounds: candidate,
      limitedWidth: false,
      limitedHeight: false,
    });
  });

  it('안 움직인 축은 극단 좌표에서도 요소 값을 비트 단위로 보존한다', () => {
    // 되돌린 뺄셈·덧셈이 1ulp 흔들리면 범위 밖 legacy x가 커진 것으로 거부되던 반례
    const bounds: Bounds = {
      x: 50577.53549435205,
      y: 0,
      width: 100,
      height: 100,
    };
    const start: Bounds = {
      x: -38245.44619570407,
      y: 0,
      width: 88922.98169005613,
      height: 100,
    };
    const candidate: Bounds = { ...start, height: 200 };
    const projected = projectGroupElementBounds(
      key,
      bounds,
      start,
      candidate,
      bottomHandle,
    );
    expect(projected.x).toBe(bounds.x);
    expect(projected.width).toBe(bounds.width);
    expect(projected.height).toBe(200);
    expect(
      limitGroupGrowth(
        [{ element: key, bounds }],
        start,
        candidate,
        bottomHandle,
        limits,
      ),
    ).toEqual({ bounds: candidate, limitedWidth: false, limitedHeight: false });
  });
});
