import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calculateSnapPoints: vi.fn(),
  calculateSizeSnap: vi.fn(),
}));

vi.mock('@utils/grid/smartGuides', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@utils/grid/smartGuides')
  >();
  return {
    ...original,
    calculateSnapPoints: mocks.calculateSnapPoints,
    calculateSizeSnap: mocks.calculateSizeSnap,
  };
});

import { calculateResizePreviewPlan } from './resizePreviewPlan';

const settings = {
  alignmentGuidesEnabled: true,
  spacingGuidesEnabled: false,
  sizeMatchGuidesEnabled: false,
  gridSnapSize: 5,
};

const emptySnapResult = {
  snappedX: 10,
  snappedY: 10,
  guides: [],
  spacingGuides: [],
  didSnapX: false,
  didSnapY: false,
  didSpacingSnapX: false,
  didSpacingSnapY: false,
};

describe('calculateResizePreviewPlan', () => {
  beforeEach(() => {
    mocks.calculateSnapPoints.mockReset();
    mocks.calculateSizeSnap.mockReset();
    mocks.calculateSnapPoints.mockReturnValue(emptySnapResult);
    mocks.calculateSizeSnap.mockImplementation((width, height) => ({
      snappedWidth: width,
      snappedHeight: height,
      sizeMatchGuides: [],
      didSnapWidth: false,
      didSnapHeight: false,
    }));
  });

  it.each([
    {
      name: '왼쪽',
      handle: { id: 'w', dx: -1, dy: 0 },
      snap: { snappedX: 8, didSnapX: true },
      expected: { x: 8, y: 10, width: 102, height: 100 },
    },
    {
      name: '오른쪽',
      handle: { id: 'e', dx: 1, dy: 0 },
      snap: { snappedX: 12, didSnapX: true },
      expected: { x: 10, y: 10, width: 102, height: 100 },
    },
    {
      name: '위쪽',
      handle: { id: 'n', dx: 0, dy: -1 },
      snap: { snappedY: 8, didSnapY: true },
      expected: { x: 10, y: 8, width: 100, height: 102 },
    },
    {
      name: '아래쪽',
      handle: { id: 's', dx: 0, dy: 1 },
      snap: { snappedY: 12, didSnapY: true },
      expected: { x: 10, y: 10, width: 100, height: 102 },
    },
  ])('$name 핸들의 정렬 스냅 좌표를 보존한다', ({ handle, snap, expected }) => {
    mocks.calculateSnapPoints.mockReturnValue({
      ...emptySnapResult,
      ...snap,
    });

    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: { x: 10, y: 10, width: 100, height: 100, handle },
      otherElements: [],
      settings,
      policy: 'native',
    });

    expect(plan.bounds).toEqual(expected);
    expect(plan.guideUpdate.kind).toBe('set');
  });

  it('왼쪽·위쪽 size match는 반대쪽 가장자리를 고정한다', () => {
    mocks.calculateSizeSnap.mockReturnValue({
      snappedWidth: 120,
      snappedHeight: 130,
      sizeMatchGuides: [],
      didSnapWidth: true,
      didSnapHeight: true,
    });

    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: {
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        handle: { id: 'nw', dx: -1, dy: -1 },
      },
      otherElements: [],
      settings: { ...settings, sizeMatchGuidesEnabled: true },
      policy: 'plugin',
    });

    expect(plan.bounds).toEqual({ x: -10, y: -10, width: 120, height: 130 });
    expect(plan.guideUpdate.kind).toBe('set');
  });

  it('size-only snap은 정렬 가이드를 비우고 size guide payload만 유지한다', () => {
    const sizeGuide = {
      type: 'size-match' as const,
      dimension: 'width' as const,
      value: 120,
      position: { x: 10, y: 20 },
      matchedElementId: 'reference-a',
      matchedElementBounds: { left: 0, top: 0, width: 120, height: 80 },
    };
    mocks.calculateSizeSnap.mockReturnValue({
      snappedWidth: 120,
      snappedHeight: 80,
      sizeMatchGuides: [sizeGuide],
      didSnapWidth: true,
      didSnapHeight: false,
    });

    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: {
        x: 10,
        y: 20,
        width: 118,
        height: 80,
        handle: { id: 'e', dx: 1, dy: 0 },
      },
      otherElements: [],
      settings: { ...settings, sizeMatchGuidesEnabled: true },
      policy: 'native',
    });

    expect(plan.bounds).toEqual({ x: 10, y: 20, width: 120, height: 80 });
    expect(plan.guideUpdate).toMatchObject({
      kind: 'set',
      activeGuides: [],
      spacingGuides: [],
      sizeMatchGuides: [sizeGuide],
    });
  });

  it('handle이 없으면 snap 결과와 기존 guide 상태를 적용하지 않는다', () => {
    mocks.calculateSnapPoints.mockReturnValue({
      ...emptySnapResult,
      snappedX: 0,
      didSnapX: true,
    });

    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: { x: 10, y: 20, width: 100, height: 80 },
      otherElements: [],
      settings: { ...settings, sizeMatchGuidesEnabled: true },
      policy: 'plugin',
    });

    expect(plan).toEqual({
      bounds: { x: 10, y: 20, width: 100, height: 80 },
      guideUpdate: { kind: 'none' },
    });
    expect(mocks.calculateSizeSnap).not.toHaveBeenCalled();
  });

  it.each([
    { spacingGuidesEnabled: true, disableSpacing: false },
    { spacingGuidesEnabled: false, disableSpacing: true },
  ])(
    'spacing 설정을 snap 계산 옵션으로 전달한다: $spacingGuidesEnabled',
    ({ spacingGuidesEnabled, disableSpacing }) => {
      calculateResizePreviewPlan({
        elementId: 'element-a',
        newBounds: {
          x: 10,
          y: 10,
          width: 100,
          height: 100,
          handle: { id: 'e', dx: 1, dy: 0 },
        },
        otherElements: [],
        settings: { ...settings, spacingGuidesEnabled },
        policy: 'native',
      });

      expect(mocks.calculateSnapPoints).toHaveBeenCalledWith(
        expect.anything(),
        [],
        undefined,
        { disableSpacing, gridSnapSize: 5 },
      );
    },
  );

  it('smart snap 억제 중에는 계산하지 않고 가이드를 지운다', () => {
    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: {
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        handle: { id: 'e', dx: 1, dy: 0 },
        suppressSmartSnap: true,
      },
      otherElements: [],
      settings,
      policy: 'native',
    });

    expect(plan).toEqual({
      bounds: { x: 10, y: 20, width: 100, height: 80 },
      guideUpdate: { kind: 'clear' },
    });
    expect(mocks.calculateSnapPoints).not.toHaveBeenCalled();
    expect(mocks.calculateSizeSnap).not.toHaveBeenCalled();
  });

  it('잡은 핸들이 움직이는 축만 크기 일치를 요청한다', () => {
    calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: {
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        handle: { id: 'e', dx: 1, dy: 0 },
      },
      otherElements: [],
      settings: { ...settings, sizeMatchGuidesEnabled: true },
      policy: 'native',
    });

    expect(mocks.calculateSizeSnap).toHaveBeenCalledWith(
      100,
      100,
      [],
      'element-a',
      { matchWidth: true, matchHeight: false },
    );
  });

  it('비율 고정은 기준 축 스냅만 받고 반대 축을 같은 배율로 놓는다', () => {
    mocks.calculateSizeSnap.mockReturnValue({
      snappedWidth: 104,
      snappedHeight: 100,
      sizeMatchGuides: [],
      didSnapWidth: true,
      didSnapHeight: false,
    });
    const start = { x: 0, y: 0, width: 100, height: 100 };

    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: {
        ...start,
        handle: { id: 'se', dx: 1, dy: 1 },
        aspect: { start, primary: 'width', range: { min: 0.1, max: 10 } },
      },
      otherElements: [],
      settings: { ...settings, sizeMatchGuidesEnabled: true },
      policy: 'native',
    });

    // 모서리라도 기준 축(폭)만 크기 일치를 받는다
    expect(mocks.calculateSizeSnap).toHaveBeenCalledWith(
      100,
      100,
      [],
      'element-a',
      { matchWidth: true, matchHeight: false },
    );
    expect(plan.bounds).toEqual({ x: 0, y: 0, width: 104, height: 104 });
    expect(plan.guideUpdate.kind).toBe('set');
  });

  it('비율 고정 배율이 범위에 잘리면 스냅과 가이드를 버린다', () => {
    mocks.calculateSizeSnap.mockReturnValue({
      snappedWidth: 104,
      snappedHeight: 100,
      sizeMatchGuides: [],
      didSnapWidth: true,
      didSnapHeight: false,
    });
    const start = { x: 0, y: 0, width: 100, height: 100 };

    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: {
        ...start,
        handle: { id: 'e', dx: 1, dy: 0 },
        aspect: { start, primary: 'width', range: { min: 0.5, max: 1.02 } },
      },
      otherElements: [],
      settings: { ...settings, sizeMatchGuidesEnabled: true },
      policy: 'native',
    });

    // 104 → 배율 1.04 는 상한 밖 → 102x102, 세로는 중앙 고정
    expect(plan.bounds).toEqual({ x: 0, y: -1, width: 102, height: 102 });
    expect(plan.guideUpdate).toEqual({ kind: 'clear' });
  });

  it('잡지 않은 축의 정렬 스냅은 적용하지도 가이드에 그리지도 않는다', () => {
    mocks.calculateSnapPoints.mockReturnValue({
      ...emptySnapResult,
      snappedX: 0,
      snappedY: 8,
      didSnapX: true,
      didSnapY: true,
      guides: [
        { type: 'vertical', position: 0, alignType: 'left' },
        { type: 'horizontal', position: 8, alignType: 'top' },
      ],
    });

    const plan = calculateResizePreviewPlan({
      elementId: 'element-a',
      newBounds: {
        x: 3,
        y: 10,
        width: 100,
        height: 100,
        handle: { id: 's', dx: 0, dy: 1 },
      },
      otherElements: [],
      settings,
      policy: 'native',
    });

    expect(plan.bounds).toEqual({ x: 3, y: 10, width: 100, height: 98 });
    expect(plan.guideUpdate).toMatchObject({
      kind: 'set',
      activeGuides: [{ type: 'horizontal', position: 8, alignType: 'top' }],
    });
  });
});
