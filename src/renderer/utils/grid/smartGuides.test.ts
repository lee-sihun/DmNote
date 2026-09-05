import { describe, expect, it } from 'vitest';
import {
  CANVAS_CENTER_X,
  CANVAS_CENTER_Y,
  calculateBounds,
  calculateGroupBounds,
  calculateSizeSnap,
  calculateSnapPoints,
} from './smartGuides';

const bounds = (
  x: number,
  y: number,
  width: number,
  height: number,
  id: string,
) => calculateBounds(x, y, width, height, id);

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

describe('calculateSnapPoints 정렬 우선순위와 가이드 순서', () => {
  it.each([
    {
      name: '캔버스와 요소가 같은 거리면 먼저 검사한 캔버스가 유지된다',
      dragged: bounds(436, 40, 20, 20, 'dragged'),
      others: [bounds(432, 300, 20, 20, 'element')],
      threshold: 4,
      expectedX: 440,
    },
    {
      name: '요소가 캔버스보다 가까우면 요소 정렬이 교체한다',
      dragged: bounds(434, 40, 20, 20, 'dragged'),
      others: [bounds(432, 300, 20, 20, 'element')],
      threshold: 4,
      expectedX: 432,
    },
    {
      name: '요소끼리 같은 거리면 배열의 첫 요소가 유지된다',
      dragged: bounds(100, 40, 20, 20, 'dragged'),
      others: [
        bounds(96, 300, 20, 20, 'first'),
        bounds(104, 400, 20, 20, 'second'),
      ],
      threshold: 4,
      expectedX: 96,
    },
    {
      name: '동률 요소의 배열 순서를 뒤집으면 선택도 뒤집힌다',
      dragged: bounds(100, 40, 20, 20, 'dragged'),
      others: [
        bounds(104, 400, 20, 20, 'second'),
        bounds(96, 300, 20, 20, 'first'),
      ],
      threshold: 4,
      expectedX: 104,
    },
  ])('$name', ({ dragged, others, threshold, expectedX }) => {
    const result = calculateSnapPoints(dragged, others, threshold, {
      disableSpacing: true,
    });

    expect(result.snappedX).toBe(expectedX);
    expect(result.didSnapX).toBe(true);
  });

  it.each([
    { distance: 8, threshold: 8, expectedX: 108, didSnapX: true },
    { distance: 9, threshold: 8, expectedX: 100, didSnapX: false },
  ])(
    '정렬 거리가 $distance일 때 threshold $threshold 경계를 포함한다',
    ({ distance, threshold, expectedX, didSnapX }) => {
      const dragged = bounds(100, 40, 20, 20, 'dragged');
      const other = bounds(100 + distance, 300, 20, 20, 'other');

      const result = calculateSnapPoints(dragged, [other], threshold, {
        disableSpacing: true,
      });

      expect(result.snappedX).toBe(expectedX);
      expect(result.didSnapX).toBe(didSnapX);
    },
  );

  it('중복 가이드는 type·position의 첫 항목만 원래 축 순서로 유지한다', () => {
    const dragged = bounds(100, 100, 20, 20, 'dragged');
    const others = [
      bounds(100, 100, 20, 20, 'first'),
      bounds(100, 100, 20, 20, 'duplicate'),
    ];

    const result = calculateSnapPoints(dragged, others, undefined, {
      disableSpacing: true,
    });

    expect(result.guides).toEqual([
      { type: 'vertical', position: 100, alignType: 'left' },
      { type: 'vertical', position: 120, alignType: 'right' },
      { type: 'vertical', position: 110, alignType: 'center' },
      { type: 'horizontal', position: 100, alignType: 'top' },
      { type: 'horizontal', position: 120, alignType: 'bottom' },
      { type: 'horizontal', position: 110, alignType: 'middle' },
    ]);
  });
});

describe('calculateSnapPoints 간격 스냅 표', () => {
  const cases = [
    {
      name: '왼쪽 인접 요소와 기존 수평 간격',
      dragged: bounds(42, 0, 10, 10, 'dragged'),
      others: [
        bounds(20, 0, 10, 10, 'left'),
        bounds(100, 0, 10, 10, 'gap-a'),
        bounds(120, 0, 10, 10, 'gap-b'),
      ],
      expectedX: 40,
      expectedY: 0,
      axis: 'x',
      expectedPairs: [
        ['gap-a', 'gap-b'],
        ['left', 'dragged'],
      ],
    },
    {
      name: '오른쪽 인접 요소와 기존 수평 간격',
      dragged: bounds(58, 0, 10, 10, 'dragged'),
      others: [
        bounds(80, 0, 10, 10, 'right'),
        bounds(120, 0, 10, 10, 'gap-a'),
        bounds(140, 0, 10, 10, 'gap-b'),
      ],
      expectedX: 60,
      expectedY: 0,
      axis: 'x',
      expectedPairs: [
        ['gap-a', 'gap-b'],
        ['dragged', 'right'],
      ],
    },
    {
      name: '위쪽 인접 요소와 기존 수직 간격',
      dragged: bounds(0, 42, 10, 10, 'dragged'),
      others: [
        bounds(0, 20, 10, 10, 'above'),
        bounds(0, 100, 10, 10, 'gap-a'),
        bounds(0, 120, 10, 10, 'gap-b'),
      ],
      expectedX: 0,
      expectedY: 40,
      axis: 'y',
      expectedPairs: [
        ['gap-a', 'gap-b'],
        ['above', 'dragged'],
      ],
    },
    {
      name: '아래쪽 인접 요소와 기존 수직 간격',
      dragged: bounds(0, 58, 10, 10, 'dragged'),
      others: [
        bounds(0, 80, 10, 10, 'below'),
        bounds(0, 120, 10, 10, 'gap-a'),
        bounds(0, 140, 10, 10, 'gap-b'),
      ],
      expectedX: 0,
      expectedY: 60,
      axis: 'y',
      expectedPairs: [
        ['gap-a', 'gap-b'],
        ['dragged', 'below'],
      ],
    },
    {
      name: '좌우 두 요소 사이의 3요소 중점',
      dragged: bounds(16, 0, 10, 10, 'dragged'),
      others: [bounds(0, 0, 10, 10, 'left'), bounds(40, 0, 10, 10, 'right')],
      expectedX: 20,
      expectedY: 0,
      axis: 'x',
      expectedPairs: [
        ['left', 'dragged'],
        ['dragged', 'right'],
      ],
    },
    {
      name: '위아래 두 요소 사이의 3요소 중점',
      dragged: bounds(0, 16, 10, 10, 'dragged'),
      others: [bounds(0, 0, 10, 10, 'above'), bounds(0, 40, 10, 10, 'below')],
      expectedX: 0,
      expectedY: 20,
      axis: 'y',
      expectedPairs: [
        ['above', 'dragged'],
        ['dragged', 'below'],
      ],
    },
  ] as const;

  it.each(cases)(
    '$name',
    ({ dragged, others, expectedX, expectedY, axis, expectedPairs }) => {
      const result = calculateSnapPoints(dragged, [...others], 0);

      expect(result.snappedX).toBe(expectedX);
      expect(result.snappedY).toBe(expectedY);
      expect(
        axis === 'x' ? result.didSpacingSnapX : result.didSpacingSnapY,
      ).toBe(true);
      expect(
        result.spacingGuides.map((guide) => [
          guide.fromElementId,
          guide.toElementId,
        ]),
      ).toEqual(expectedPairs);
    },
  );

  it('disableSpacing은 정렬 결과만 반환하고 간격 계산을 생략한다', () => {
    const dragged = bounds(42, 0, 10, 10, 'dragged');
    const others = [
      bounds(20, 0, 10, 10, 'left'),
      bounds(100, 0, 10, 10, 'gap-a'),
      bounds(120, 0, 10, 10, 'gap-b'),
    ];

    const result = calculateSnapPoints(dragged, others, 0, {
      disableSpacing: true,
    });

    expect(result.snappedX).toBe(42);
    expect(result.spacingGuides).toEqual([]);
    expect(result.didSpacingSnapX).toBe(false);
    expect(result.didSpacingSnapY).toBe(false);
  });
});

describe('빈 입력·자기 제외·크기 스냅 우선순위', () => {
  it('빈 그룹은 null이고 단일 그룹은 입력 bounds 객체를 그대로 반환한다', () => {
    const only = bounds(10, 20, 30, 40, 'only');

    expect(calculateGroupBounds([])).toBeNull();
    expect(calculateGroupBounds([only])).toBe(only);
  });

  it.each([
    { name: '빈 요소', others: [] },
    {
      name: '자기 자신만 포함',
      others: [bounds(100, 40, 20, 20, 'dragged')],
    },
  ])('$name이면 위치 스냅을 만들지 않는다', ({ others }) => {
    const dragged = bounds(100, 40, 20, 20, 'dragged');
    const result = calculateSnapPoints(dragged, others, undefined, {
      disableSpacing: true,
    });

    expect(result).toMatchObject({
      snappedX: 100,
      snappedY: 40,
      guides: [],
      spacingGuides: [],
      didSnapX: false,
      didSnapY: false,
    });
  });

  it('width와 height는 각각 가장 가까운 요소를 고르고 width guide가 먼저 온다', () => {
    const widthCandidate = bounds(0, 0, 102, 104, 'width');
    const heightCandidate = bounds(200, 10, 104, 100, 'height');

    const result = calculateSizeSnap(100, 101, [
      heightCandidate,
      widthCandidate,
    ]);

    expect(result.snappedWidth).toBe(102);
    expect(result.snappedHeight).toBe(100);
    expect(
      result.sizeMatchGuides.map((guide) => guide.matchedElementId),
    ).toEqual(['width', 'height']);
  });

  it.each([
    {
      name: '동률이면 첫 요소를 유지한다',
      others: [bounds(0, 0, 96, 80, 'first'), bounds(0, 0, 104, 90, 'second')],
      expectedWidth: 96,
      expectedId: 'first',
    },
    {
      name: '동률 배열을 뒤집으면 선택도 뒤집힌다',
      others: [bounds(0, 0, 104, 90, 'second'), bounds(0, 0, 96, 80, 'first')],
      expectedWidth: 104,
      expectedId: 'second',
    },
  ])('$name', ({ others, expectedWidth, expectedId }) => {
    const result = calculateSizeSnap(100, 50, others);

    expect(result.snappedWidth).toBe(expectedWidth);
    expect(result.sizeMatchGuides).toHaveLength(1);
    expect(result.sizeMatchGuides[0]?.matchedElementId).toBe(expectedId);
  });

  it.each([
    { delta: 4, didSnap: true, expected: 104 },
    { delta: 5, didSnap: false, expected: 100 },
  ])(
    '크기 차이 $delta는 임계값 경계를 따른다',
    ({ delta, didSnap, expected }) => {
      const other = bounds(0, 0, 100 + delta, 100 + delta, 'other');
      const result = calculateSizeSnap(100, 100, [other]);

      expect(result.didSnapWidth).toBe(didSnap);
      expect(result.didSnapHeight).toBe(didSnap);
      expect(result.snappedWidth).toBe(expected);
      expect(result.snappedHeight).toBe(expected);
    },
  );

  it('빈 요소와 자기 자신은 크기 스냅 후보에서 제외한다', () => {
    const self = bounds(0, 0, 102, 102, 'dragged');

    for (const others of [[], [self]]) {
      expect(calculateSizeSnap(100, 100, others, 'dragged')).toEqual({
        snappedWidth: 100,
        snappedHeight: 100,
        sizeMatchGuides: [],
        didSnapWidth: false,
        didSnapHeight: false,
      });
    }
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
