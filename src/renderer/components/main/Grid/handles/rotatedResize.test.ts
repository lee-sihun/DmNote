import { describe, expect, it } from 'vitest';
import {
  anchorRotatedResize,
  resizeCursorForHandle,
  screenDeltaToLocal,
} from './rotatedResize';

const near = (value: number, expected: number) =>
  expect(value).toBeCloseTo(expected, 6);

describe('screenDeltaToLocal', () => {
  it('회전 0은 그대로다', () => {
    expect(screenDeltaToLocal(10, -4, 0)).toEqual({ x: 10, y: -4 });
  });

  it('90° 회전한 요소에서 화면 아래 이동은 로컬 +x다', () => {
    const local = screenDeltaToLocal(0, 10, 90);
    near(local.x, 10);
    near(local.y, 0);
  });
});

describe('anchorRotatedResize', () => {
  const start = { x: 100, y: 100, width: 60, height: 40 };

  it('회전 0은 로컬 결과 그대로다', () => {
    const local = { x: 100, y: 100, width: 80, height: 40 };
    expect(anchorRotatedResize(start, local, 0)).toBe(local);
  });

  it('90° 회전 요소의 오른쪽 핸들을 늘리면 화면에서 아래로 자라고 왼쪽(화면 위) 변은 고정된다', () => {
    // 로컬: 왼쪽 변 고정, 폭 60→80
    const local = { x: 100, y: 100, width: 80, height: 40 };
    const result = anchorRotatedResize(start, local, 90);
    // 로컬 중심이 +10 x 이동 → 화면에서는 +10 y
    near(result.x + result.width / 2, 130);
    near(result.y + result.height / 2, 130);
    expect(result.width).toBe(80);
    expect(result.height).toBe(40);
  });

  it('크기는 바꾸지 않고 중심 이동만 회전시킨다', () => {
    for (const rotation of [-135, -30, 17, 60, 180]) {
      const local = { x: 90, y: 95, width: 75, height: 50 };
      const result = anchorRotatedResize(start, local, rotation);
      expect(result.width).toBe(75);
      expect(result.height).toBe(50);
      const startCx = 130;
      const startCy = 120;
      const shift = Math.hypot(
        local.x + local.width / 2 - startCx,
        local.y + local.height / 2 - startCy,
      );
      near(
        Math.hypot(
          result.x + result.width / 2 - startCx,
          result.y + result.height / 2 - startCy,
        ),
        shift,
      );
    }
  });
});

describe('resizeCursorForHandle', () => {
  it('회전 0은 기본 커서와 같다', () => {
    expect(resizeCursorForHandle(1, 0, 0)).toBe('ew-resize');
    expect(resizeCursorForHandle(0, 1, 0)).toBe('ns-resize');
    expect(resizeCursorForHandle(1, 1, 0)).toBe('nwse-resize');
    expect(resizeCursorForHandle(1, -1, 0)).toBe('nesw-resize');
    expect(resizeCursorForHandle(-1, -1, 0)).toBe('nwse-resize');
  });

  it('90° 회전하면 가로·세로 커서가 서로 바뀐다', () => {
    expect(resizeCursorForHandle(1, 0, 90)).toBe('ns-resize');
    expect(resizeCursorForHandle(0, 1, 90)).toBe('ew-resize');
    expect(resizeCursorForHandle(1, 1, 90)).toBe('nesw-resize');
  });

  it('45° 회전하면 변 핸들이 대각 커서가 된다', () => {
    expect(resizeCursorForHandle(1, 0, 45)).toBe('nwse-resize');
    expect(resizeCursorForHandle(0, 1, 45)).toBe('nesw-resize');
  });
});
