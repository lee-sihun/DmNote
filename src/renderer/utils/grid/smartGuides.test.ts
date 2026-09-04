import { describe, expect, it } from 'vitest';
import {
  CANVAS_CENTER_X,
  CANVAS_CENTER_Y,
  calculateBounds,
  calculateSizeSnap,
  calculateSnapPoints,
} from './smartGuides';

describe('calculateSnapPoints 캔버스 중앙 그리드 스냅', () => {
  it('홀수 폭의 중앙 스냅 결과를 그리드 배수로 반올림한다', () => {
    const draggedBounds = calculateBounds(322, 0, 255, 60, 'dragged');

    const result = calculateSnapPoints(draggedBounds, [], undefined, {
      gridSnapSize: 5,
    });

    expect(result.snappedX).toBe(325);
    expect(result.didSnapX).toBe(true);
    expect(result.guides).toContainEqual({
      type: 'vertical',
      position: CANVAS_CENTER_X,
      alignType: 'center',
    });
  });

  it('그리드 크기 0이면 소수 중앙 좌표를 유지한다', () => {
    const draggedBounds = calculateBounds(322, 0, 255, 60, 'dragged');

    const result = calculateSnapPoints(draggedBounds, [], undefined, {
      gridSnapSize: 0,
    });

    expect(result.snappedX).toBe(322.5);
    expect(result.didSnapX).toBe(true);
  });

  it('그리드 크기가 없으면 기존 소수 중앙 좌표를 유지한다', () => {
    const draggedBounds = calculateBounds(322, 0, 255, 60, 'dragged');

    const result = calculateSnapPoints(draggedBounds, []);

    expect(result.snappedX).toBe(322.5);
    expect(result.didSnapX).toBe(true);
  });

  it('이미 그리드 배수인 중앙 스냅 결과는 유지한다', () => {
    const draggedBounds = calculateBounds(389, 0, 120, 60, 'dragged');

    const result = calculateSnapPoints(draggedBounds, [], undefined, {
      gridSnapSize: 5,
    });

    expect(result.snappedX).toBe(390);
    expect(result.didSnapX).toBe(true);
  });

  it('이웃 요소 중앙 스냅의 소수 좌표는 반올림하지 않는다', () => {
    const draggedBounds = calculateBounds(161, 20, 60, 60, 'dragged');
    const neighborBounds = calculateBounds(160, 20, 63, 60, 'neighbor');

    const result = calculateSnapPoints(
      draggedBounds,
      [neighborBounds],
      undefined,
      { gridSnapSize: 5 },
    );

    expect(result.snappedX).toBe(161.5);
    expect(result.didSnapX).toBe(true);
  });

  it('홀수 높이의 세로 중앙 스냅 결과를 그리드 배수로 반올림한다', () => {
    const draggedBounds = calculateBounds(0, 67, 60, 255, 'dragged');

    const result = calculateSnapPoints(draggedBounds, [], undefined, {
      gridSnapSize: 5,
    });

    expect(result.snappedY).toBe(70);
    expect(result.didSnapY).toBe(true);
    expect(result.guides).toContainEqual({
      type: 'horizontal',
      position: CANVAS_CENTER_Y,
      alignType: 'middle',
    });
  });
});

describe('calculateSizeSnap 활성 축', () => {
  const other = {
    id: 'other',
    left: 1000,
    top: 1000,
    right: 1100,
    bottom: 1050,
    centerX: 1050,
    centerY: 1025,
    width: 100,
    height: 50,
  };

  it('기본은 두 축 모두 일치시킨다', () => {
    const result = calculateSizeSnap(102, 52, [other]);
    expect(result).toMatchObject({
      didSnapWidth: true,
      snappedWidth: 100,
      didSnapHeight: true,
      snappedHeight: 50,
    });
    expect(result.sizeMatchGuides.map((guide) => guide.dimension)).toEqual([
      'width',
      'height',
    ]);
  });

  it('잡지 않은 축은 값도 가이드도 손대지 않는다', () => {
    const result = calculateSizeSnap(102, 52, [other], '', {
      matchHeight: false,
    });
    expect(result).toMatchObject({
      didSnapWidth: true,
      snappedWidth: 100,
      didSnapHeight: false,
      snappedHeight: 52,
    });
    expect(result.sizeMatchGuides.map((guide) => guide.dimension)).toEqual([
      'width',
    ]);
  });
});
