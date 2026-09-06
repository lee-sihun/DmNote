import { describe, expect, it } from 'vitest';

import {
  aspectScaleFromPrimary,
  aspectScaleRange,
  isSameAspect,
  scaleBoundsAnchored,
  settleAspectScale,
} from './aspectResize';
import { isBoundsWithinEditorLimits } from './resizeLimits';

const MIN = 10;
const east = { dx: 1, dy: 0 } as const;
const south = { dx: 0, dy: 1 } as const;
const west = { dx: -1, dy: 0 } as const;

describe('aspectScaleRange 하한', () => {
  it('정상 4:3은 짧은 변이 10에서 멈춘다 (13.3x10 유지)', () => {
    const range = aspectScaleRange(
      { x: 0, y: 0, width: 200, height: 150 },
      east,
      MIN,
    );
    expect(range.min).toBeCloseTo(10 / 150, 12);
  });

  it('한 축이 이미 얇으면 그 축은 기준에서 빠진다 (400x0.1은 폭 10까지)', () => {
    const range = aspectScaleRange(
      { x: 0, y: 0, width: 400, height: 0.1 },
      east,
      MIN,
    );
    expect(range.min).toBeCloseTo(10 / 400, 12);
  });

  it('하한 배율은 반올림으로 10 아래를 만들지 않는다 (연속 축소 우회 방지)', () => {
    // 10/77 은 아래로 반올림돼 77 * (10/77) = 9.999999999999998
    const start = { x: 0, y: 0, width: 100, height: 77 };
    const range = aspectScaleRange(start, east, MIN);
    const shrunk = scaleBoundsAnchored(start, range.min, east);
    expect(shrunk.height).toBeGreaterThanOrEqual(10);
    // 그 결과를 다시 시작값으로 써도 두 축이 보호 축이라 10 아래로 못 내려간다
    const again = scaleBoundsAnchored(
      shrunk,
      aspectScaleRange(shrunk, east, MIN).min,
      east,
    );
    expect(again.height).toBeGreaterThanOrEqual(10);
    expect(again.width).toBeGreaterThan(12.9);
  });

  it('두 축 모두 얇으면 현재보다 축소를 막는다', () => {
    const range = aspectScaleRange(
      { x: 0, y: 0, width: 8, height: 4 },
      east,
      MIN,
    );
    expect(range.min).toBe(1);
    expect(range.max).toBeGreaterThan(1);
  });
});

describe('aspectScaleRange 상한', () => {
  it('두 치수가 32768을 넘지 않는 배율까지', () => {
    const range = aspectScaleRange(
      { x: 0, y: 0, width: 400, height: 0.1 },
      east,
      MIN,
    );
    expect(range.max).toBeCloseTo(32768 / 400, 12);
  });

  it('시작 가장자리 고정(dir 1)은 좌표를 제한하지 않는다', () => {
    const range = aspectScaleRange(
      { x: -32768, y: -32768, width: 100, height: 100 },
      { dx: 1, dy: 1 },
      MIN,
    );
    expect(range.max).toBeCloseTo(32768 / 100, 12);
  });

  it('중앙 앵커는 왼쪽 가장자리가 -32768에 닿으면 멈춘다', () => {
    // x' = cx - w·s/2 ≥ -32768. cx = -32368 이면 s ≤ 2, 이미 가장자리가 한계면 s ≤ 1
    expect(
      aspectScaleRange({ x: -32568, y: 0, width: 400, height: 0.1 }, south, MIN)
        .max,
    ).toBeCloseTo(2, 12);
    expect(
      aspectScaleRange({ x: -32768, y: 0, width: 400, height: 0.1 }, south, MIN)
        .max,
    ).toBe(1);
  });

  it('반대 가장자리 고정(dir -1)은 x = right - w·s 로 제한한다', () => {
    // right = -32668, s ≤ (right + 32768) / w = 100 / 100 = 1 → 확대 불가
    const range = aspectScaleRange(
      { x: -32768, y: 0, width: 100, height: 100 },
      west,
      MIN,
    );
    expect(range.max).toBe(1);
  });
});

describe('aspectScaleRange 좌표 하한 (양쪽 부등식)', () => {
  it('상단이 좌표 상한 근처면 중앙 앵커 축소가 하한을 올린다', () => {
    // y=32760, h=100 을 가로 핸들로 줄이면 y' = 32810 - 50·s ≤ 32768 → s ≥ 0.84
    const start = { x: 0, y: 32760, width: 100, height: 100 };
    const range = aspectScaleRange(start, east, MIN);
    expect(range.min).toBeCloseTo(0.84, 12);
    expect(
      isBoundsWithinEditorLimits(scaleBoundsAnchored(start, range.min, east)),
    ).toBe(true);
    expect(
      isBoundsWithinEditorLimits(scaleBoundsAnchored(start, 0.5, east)),
    ).toBe(false);
  });

  it('유효한 시작이면 s=1은 항상 구간 안이다', () => {
    const starts = [
      { x: 32768, y: 32768, width: 32768, height: 32768 },
      { x: -32768, y: -32768, width: 0.001, height: 0.001 },
      { x: 32760, y: -32760, width: 100, height: 1 },
      // origin + size 를 먼저 더하면 정밀도가 깨져 빈 구간이 되던 극단값
      { x: 32768, y: -32768, width: 0.01141460293365526, height: 1e-12 },
    ];
    const handles = [
      east,
      south,
      west,
      { dx: -1, dy: -1 },
      { dx: 1, dy: -1 },
    ] as const;
    for (const start of starts) {
      for (const handle of handles) {
        const range = aspectScaleRange(start, handle, MIN);
        expect(range.min).toBeLessThanOrEqual(1);
        expect(range.max).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('scaleBoundsAnchored', () => {
  const start = { x: 100, y: 50, width: 200, height: 100 };

  it('s=1은 극단 좌표에서도 시작 bounds를 비트 단위로 돌려준다', () => {
    const extreme = {
      x: 32768,
      y: -32768,
      width: 0.01141460293365526,
      height: 1e-12,
    };
    const handle = { dx: -1, dy: -1 } as const;
    expect(scaleBoundsAnchored(extreme, 1, handle)).toEqual(extreme);
    const range = aspectScaleRange(extreme, handle, MIN);
    expect(settleAspectScale(extreme, 1, handle, range)).toBe(1);
    expect(
      isBoundsWithinEditorLimits(
        scaleBoundsAnchored(
          extreme,
          settleAspectScale(extreme, 3, handle, range),
          handle,
        ),
      ),
    ).toBe(true);
  });

  it('잡지 않은 가장자리를 고정한다', () => {
    expect(scaleBoundsAnchored(start, 2, east)).toEqual({
      x: 100,
      y: 0,
      width: 400,
      height: 200,
    });
    expect(scaleBoundsAnchored(start, 0.5, west)).toEqual({
      x: 200,
      y: 75,
      width: 100,
      height: 50,
    });
    expect(scaleBoundsAnchored(start, 2, { dx: -1, dy: -1 })).toEqual({
      x: -100,
      y: -50,
      width: 400,
      height: 200,
    });
  });

  it('두 변이 같은 배율로 움직인다', () => {
    const next = scaleBoundsAnchored(
      { x: 0, y: 0, width: 400, height: 0.1 },
      11,
      south,
    );
    expect(isSameAspect({ x: 0, y: 0, width: 400, height: 0.1 }, next)).toBe(
      true,
    );
  });
});

describe('settleAspectScale', () => {
  it('범위로 자른 뒤 경계 오차가 있으면 s를 1 쪽으로 물린다', () => {
    const start = { x: 0, y: 32760, width: 100, height: 100 };
    const range = aspectScaleRange(start, east, MIN);
    const settled = settleAspectScale(start, 0.1, east, range);
    expect(settled).toBeGreaterThanOrEqual(range.min);
    expect(
      isBoundsWithinEditorLimits(scaleBoundsAnchored(start, settled, east)),
    ).toBe(true);
  });

  it('극소 치수는 배율이 표현 범위를 넘어도 NaN 없이 1로 닫힌다', () => {
    // 1e-305 는 백엔드가 받는 유효 치수지만 5000/1e-305 은 Infinity
    const tiny = { x: 0, y: 0, width: 1e-305, height: 1e-305 };
    const range = aspectScaleRange(tiny, east, MIN);
    expect(Number.isFinite(range.max)).toBe(true);
    const primary = aspectScaleFromPrimary(
      tiny,
      'width',
      5000,
      (v) => v,
      range,
    );
    // 배율로는 비율을 지킬 수 없으니 이 프레임은 움직이지 않는다
    expect(primary).toEqual({
      scale: 1,
      exact: { axis: 'width', size: 1e-305 },
    });
    const settled = settleAspectScale(tiny, Infinity, east, range);
    expect(settled).toBe(1);
    expect(scaleBoundsAnchored(tiny, settled, east)).toEqual(tiny);
  });

  it('legacy 시작은 범위 밖 항목을 건드리지 않는 축소를 허용한다', () => {
    // x=40000 은 범위 밖이지만 동쪽 핸들 축소는 x를 그대로 둔다
    const legacy = { x: 40000, y: 0, width: 200, height: 100 };
    const range = aspectScaleRange(legacy, east, MIN);
    const settled = settleAspectScale(legacy, 0.5, east, range);
    expect(settled).toBe(0.5);
    expect(scaleBoundsAnchored(legacy, settled, east)).toEqual({
      x: 40000,
      y: 25,
      width: 100,
      height: 50,
    });
  });

  it('상한 배율의 결과는 백엔드 검증을 통과한다', () => {
    const cases = [
      { start: { x: -32768, y: 0, width: 400, height: 0.1 }, handle: south },
      { start: { x: 0, y: 0, width: 400, height: 0.1 }, handle: south },
      {
        start: { x: 32700, y: 32700, width: 3, height: 7 },
        handle: { dx: -1, dy: -1 } as const,
      },
    ];
    for (const { start, handle } of cases) {
      const range = aspectScaleRange(start, handle, MIN);
      const settled = settleAspectScale(start, Number.MAX_VALUE, handle, range);
      expect(
        isBoundsWithinEditorLimits(scaleBoundsAnchored(start, settled, handle)),
      ).toBe(true);
    }
  });
});

describe('aspectScaleFromPrimary', () => {
  const snap5 = (size: number) => Math.round(size / 5) * 5;
  const thin = { x: 0, y: 0, width: 400, height: 0.1 };

  it('스냅이 치수 0으로 무너지면 그 프레임은 스냅을 버린다', () => {
    const range = aspectScaleRange(thin, south, MIN);
    // 아래쪽 +1px: 1.1은 그리드 5에서 0 → 무효 → 원래 후보 → 배율 11
    const unsnapped = aspectScaleFromPrimary(thin, 'height', 1.1, snap5, range);
    expect(unsnapped.scale).toBeCloseTo(11, 12);
    expect(unsnapped.exact).toEqual({ axis: 'height', size: 1.1 });
    // +3px: 3.1 → 5 유효 → 배율 50, 기준 축 치수는 스냅값 그대로
    const snapped = aspectScaleFromPrimary(thin, 'height', 3.1, snap5, range);
    expect(snapped.scale).toBe(50);
    expect(snapped.exact).toEqual({ axis: 'height', size: 5 });
  });

  it('스냅이 상한을 넘으면 원래 후보를 상한으로 자른다', () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const range = { min: 0.1, max: 1.022 };
    // 102.51 → 스냅 105는 범위 밖 → raw 1.0251 → clamp 1.022, 치수는 다시 곱한다
    const clamped = aspectScaleFromPrimary(
      start,
      'width',
      102.51,
      snap5,
      range,
    );
    expect(clamped.scale).toBe(1.022);
    expect(clamped.exact.size).toBeCloseTo(102.2, 12);
    // 102.49 → 스냅 100 유효
    expect(
      aspectScaleFromPrimary(start, 'width', 102.49, snap5, range),
    ).toEqual({
      scale: 1,
      exact: { axis: 'width', size: 100 },
    });
  });

  it('후보가 앵커를 지나 0 이하가 되면 하한으로 올린다', () => {
    const start = { x: 0, y: 0, width: 200, height: 150 };
    const range = aspectScaleRange(start, east, MIN);
    expect(
      aspectScaleFromPrimary(start, 'width', -30, snap5, range).scale,
    ).toBe(range.min);
  });

  it('왼쪽 핸들은 주입된 가장자리 스냅으로 폭을 정한다', () => {
    const start = { x: 3, y: 0, width: 200, height: 150 };
    const right = start.x + start.width;
    const edgeSnap = (size: number) => right - snap5(right - size);
    const range = aspectScaleRange(start, west, MIN);
    // 후보 폭 190 → 왼쪽 가장자리 13 → 스냅 15 → 폭 188
    expect(
      aspectScaleFromPrimary(start, 'width', 190, edgeSnap, range),
    ).toEqual({
      scale: 188 / 200,
      exact: { axis: 'width', size: 188 },
    });
  });
});
