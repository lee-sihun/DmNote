// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { ElementBounds as SmartGuideElementBounds } from '@utils/grid/smartGuides';
import { makeCanonicalSpritePosition } from '@utils/sprite/spriteFixtures';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import GroupResizeHandles from './GroupResizeHandles';
import type { GroupResizeHandle, GroupResizeResult } from './groupResizePlan';
import { isBoundsWithinEditorLimits } from './resizeLimits';
import type { GroupRotationFrame } from './rotatedGroupResize';
import { projectSpriteResize } from '@utils/sprite/resizeProjection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const settingsState = {
    gridSettings: {
      gridSnapSize: 10,
      alignmentGuides: true,
      spacingGuides: true,
      sizeMatchGuides: true,
    },
  };
  const smartGuidesState = {
    clearGuides: vi.fn(),
    setDraggedBounds: vi.fn(),
    setActiveGuides: vi.fn(),
    setSpacingGuides: vi.fn(),
    setSizeMatchGuides: vi.fn(),
  };

  return {
    settingsState,
    smartGuidesState,
    settingsGetState: vi.fn(() => settingsState),
    smartGuidesGetState: vi.fn(() => smartGuidesState),
    lockCustomCursor: vi.fn(),
    unlockCustomCursor: vi.fn(),
  };
});

vi.mock('@utils/core/platform', () => ({
  isMac: () => false,
}));

vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: mocks.settingsGetState,
  },
}));

vi.mock('@stores/grid/useSmartGuidesStore', () => ({
  useSmartGuidesStore: {
    getState: mocks.smartGuidesGetState,
  },
}));

vi.mock('@utils/grid/cursorUtils', () => ({
  clearPendingCustomCursorHover: vi.fn(),
  getCursor: () => 'default',
  isCustomCursorHoverSuspended: () => false,
  lockCustomCursor: mocks.lockCustomCursor,
  setCustomCursorHover: vi.fn(),
  setPendingCustomCursorHover: vi.fn(),
  unlockCustomCursor: mocks.unlockCustomCursor,
}));

const ID_A = '00000000-0000-0000-0000-000000000001';
const ID_B = '00000000-0000-0000-0000-000000000002';

const positions = {
  mode: [
    { id: ID_A, dx: 0, dy: 0, width: 40, height: 40 },
    { id: ID_B, dx: 60, dy: 40, width: 40, height: 40 },
  ],
} as unknown as CanonicalEditorDocumentV1['keyPositions'];

const mouse = (
  type: string,
  clientX: number,
  clientY: number,
  options: MouseEventInit = {},
) =>
  new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY,
    ...options,
  });

describe('GroupResizeHandles 세션', () => {
  let host: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let frameCallbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsState.gridSettings.gridSnapSize = 10;
    mocks.settingsState.gridSettings.alignmentGuides = true;
    mocks.settingsState.gridSettings.spacingGuides = true;
    mocks.settingsState.gridSettings.sizeMatchGuides = true;
    frameCallbacks = new Map();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frame = nextFrame++;
      frameCallbacks.set(frame, callback);
      return frame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => {
      frameCallbacks.delete(frame);
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderHandles = ({
    strategy = 'legacy' as const,
    zoom = 1,
    onStart = vi.fn<(handle: GroupResizeHandle) => void>(),
    onResize = vi.fn<(result: GroupResizeResult) => void>(),
    onEnd = vi.fn<() => void>(),
    getOtherElements,
    rotationFrame,
    previewGroupBounds,
  }: {
    strategy?: 'legacy' | 'frame';
    zoom?: number;
    onStart?: (handle: GroupResizeHandle) => void;
    onResize?: (result: GroupResizeResult) => void;
    onEnd?: () => void;
    getOtherElements?: (excludeIds: string[]) => SmartGuideElementBounds[];
    rotationFrame?: GroupRotationFrame;
    previewGroupBounds?: GroupRotationFrame['bounds'];
  } = {}) => {
    act(() => {
      root.render(
        <GroupResizeHandles
          selectedElements={[
            { type: 'key', id: ID_A, index: 0 },
            { type: 'key', id: ID_B, index: 1 },
          ]}
          positions={positions}
          statPositions={{}}
          graphPositions={{}}
          knobPositions={{}}
          selectedKeyType="mode"
          pluginElements={[]}
          zoom={zoom}
          rotationFrame={rotationFrame}
          previewGroupBounds={previewGroupBounds}
          onGroupResizeStart={onStart}
          onGroupResize={onResize}
          onGroupResizeEnd={onEnd}
          getOtherElements={getOtherElements}
          continuousInputStrategy={strategy}
        />,
      );
    });
  };

  const startResize = (handleId = 'se') => {
    const handle = host.querySelector<HTMLElement>(
      `[data-group-resize-handle="${handleId}"]`,
    )!;
    act(() => handle.dispatchEvent(mouse('mousedown', 100, 100)));
  };

  it('회전 프레임의 틀·핸들·커서와 동결한 로컬 드래그 축이 함께 돈다', () => {
    const rotationFrame = {
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      rotation: 90,
    };
    const onResize = vi.fn();
    const getOtherElements = vi.fn(() => []);
    renderHandles({ rotationFrame, zoom: 2, onResize, getOtherElements });
    const outline = host.querySelector<HTMLElement>(
      '[data-group-resize-outline]',
    )!;
    const east = host.querySelector<HTMLElement>(
      '[data-group-resize-handle="e"]',
    )!;
    expect(outline.style.transform).toBe('rotate(90deg)');
    expect(Number.parseFloat(east.style.left) + 9).toBeCloseTo(100, 8);
    expect(Number.parseFloat(east.style.top) + 9).toBeCloseTo(180.5, 8);
    expect(east.firstElementChild?.getAttribute('style')).toContain(
      'rotate(90deg)',
    );
    startResize('e');
    expect(mocks.lockCustomCursor).toHaveBeenCalledWith(
      'ns-resize',
      expect.any(MouseEvent),
    );

    renderHandles({
      rotationFrame: { ...rotationFrame, rotation: 0 },
      zoom: 2,
      onResize,
      getOtherElements,
    });
    act(() => document.dispatchEvent(mouse('mousemove', 100, 140)));
    const result = onResize.mock.calls.at(-1)![0] as GroupResizeResult;
    expect(result.groupBounds.x).toBeCloseTo(-10, 8);
    expect(result.groupBounds.y).toBeCloseTo(2, 8);
    expect(result.groupBounds.width).toBe(120);
    expect(result.groupBounds.height).toBe(96);
    expect(
      result.elementBounds.map(({ bounds }) => [bounds.width, bounds.height]),
    ).toEqual([
      [48, 48],
      [48, 48],
    ]);
    expect(getOtherElements).not.toHaveBeenCalled();
    expect(mocks.smartGuidesState.clearGuides).toHaveBeenCalled();
    act(() => document.dispatchEvent(mouse('mouseup', 100, 140)));
  });

  it('회전 프레임의 프리뷰는 world 논리 bounds를 다시 AABB로 바꾸지 않고 표시한다', () => {
    renderHandles({
      rotationFrame: {
        bounds: { x: 0, y: 0, width: 100, height: 80 },
        rotation: 45,
      },
      previewGroupBounds: { x: -10, y: 2, width: 120, height: 96 },
    });
    const outline = host.querySelector<HTMLElement>(
      '[data-group-resize-outline]',
    )!;
    expect(outline.style.left).toBe('-12px');
    expect(outline.style.top).toBe('0px');
    expect(outline.style.width).toBe('124px');
    expect(outline.style.height).toBe('100px');
    expect(outline.style.transform).toBe('rotate(45deg)');
  });

  it('move마다 최신 store를 읽고 zoom·grid snap을 적용하며 primary modifier는 smart snap을 막는다', () => {
    const onResize = vi.fn();
    const getOtherElements = vi.fn(() => []);
    renderHandles({ zoom: 2, onResize, getOtherElements });
    startResize();

    act(() => document.dispatchEvent(mouse('mousemove', 126, 126)));
    expect(onResize.mock.calls.at(-1)?.[0].groupBounds).toEqual({
      x: 0,
      y: 0,
      width: 110,
      height: 90,
    });

    mocks.settingsState.gridSettings.gridSnapSize = 5;
    act(() => document.dispatchEvent(mouse('mousemove', 126, 126)));
    expect(onResize.mock.calls.at(-1)?.[0].groupBounds).toEqual({
      x: 0,
      y: 0,
      width: 115,
      height: 95,
    });

    act(() =>
      document.dispatchEvent(mouse('mousemove', 126, 126, { ctrlKey: true })),
    );
    expect(mocks.settingsGetState).toHaveBeenCalledTimes(6);
    expect(mocks.smartGuidesGetState).toHaveBeenCalledTimes(3);
    expect(getOtherElements).toHaveBeenCalledTimes(2);
    expect(mocks.smartGuidesState.clearGuides).toHaveBeenCalled();

    act(() => document.dispatchEvent(mouse('mouseup', 126, 126)));
  });

  it('최종 rAF를 flush한 뒤 guides·cursor·end 순서로 정산한다', () => {
    const order: string[] = [];
    const onStart = vi.fn(() => order.push('start'));
    const onResize = vi.fn(() => order.push('resize'));
    const onEnd = vi.fn(() => order.push('end'));
    mocks.smartGuidesState.clearGuides.mockImplementation(() =>
      order.push('clear'),
    );
    mocks.unlockCustomCursor.mockImplementation(() => order.push('unlock'));
    renderHandles({ strategy: 'frame', onStart, onResize, onEnd });
    startResize('e');

    act(() => document.dispatchEvent(mouse('mousemove', 125, 100)));
    expect(onResize).not.toHaveBeenCalled();

    act(() => document.dispatchEvent(mouse('mouseup', 125, 100)));

    expect(order).toEqual(['start', 'resize', 'clear', 'unlock', 'end']);
    expect(frameCallbacks.size).toBe(0);
  });

  it('이동 없이 끝나면 resize callback을 내보내지 않는다', () => {
    const onStart = vi.fn();
    const onResize = vi.fn();
    const onEnd = vi.fn();
    renderHandles({ strategy: 'frame', onStart, onResize, onEnd });
    startResize('n');

    act(() => document.dispatchEvent(mouse('mousemove', 102, 102)));
    act(() => document.dispatchEvent(mouse('mouseup', 100, 100)));

    expect(onStart).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('unmount는 pending move를 flush하고 listener와 cursor를 한 번만 정산한다', () => {
    const onResize = vi.fn();
    const onEnd = vi.fn();
    renderHandles({ strategy: 'frame', onResize, onEnd });
    startResize('w');
    act(() => document.dispatchEvent(mouse('mousemove', 80, 100)));

    act(() => root.unmount());
    mounted = false;

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(mocks.smartGuidesState.clearGuides).toHaveBeenCalledTimes(1);
    expect(mocks.unlockCustomCursor).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(mouse('mousemove', 70, 100));
      document.dispatchEvent(mouse('mouseup', 70, 100));
    });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

const SPRITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SPRITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type SpritePositions = Record<
  string,
  ReturnType<typeof makeCanonicalSpritePosition>[]
>;

// 폭 28 요소 - 그룹 폭이 30까지 줄면 size matching 임계값(4px) 안에 들어온다.
// 가장자리는 멀리 둬 정렬 스냅은 걸리지 않게 한다
const sizeMatchTarget = (): SmartGuideElementBounds => ({
  id: 'other',
  left: 1000,
  top: 600,
  right: 1028,
  bottom: 1100,
  centerX: 1014,
  centerY: 850,
  width: 28,
  height: 500,
});

describe('GroupResizeHandles 스프라이트 최소 크기·비율 고정', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsState.gridSettings.gridSnapSize = 5;
    mocks.settingsState.gridSettings.alignmentGuides = true;
    mocks.settingsState.gridSettings.spacingGuides = true;
    mocks.settingsState.gridSettings.sizeMatchGuides = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const renderSprites = (
    spritePositions: SpritePositions,
    onGroupResize: (result: GroupResizeResult) => void,
    getOtherElements: () => SmartGuideElementBounds[] = () => [],
    rotationFrame?: GroupRotationFrame,
  ) => {
    act(() => {
      root.render(
        <GroupResizeHandles
          selectedElements={[
            { type: 'sprite', id: SPRITE_A, index: 0 },
            { type: 'sprite', id: SPRITE_B, index: 1 },
          ]}
          positions={{}}
          statPositions={{}}
          graphPositions={{}}
          knobPositions={{}}
          spritePositions={spritePositions}
          rotationFrame={rotationFrame}
          selectedKeyType="4key"
          pluginElements={[]}
          onGroupResize={onGroupResize}
          getOtherElements={getOtherElements}
          continuousInputStrategy="legacy"
        />,
      );
    });
  };

  const pressHandle = (handleId: string, x: number, y: number) => {
    const handle = host.querySelector<HTMLElement>(
      `[data-group-resize-handle="${handleId}"]`,
    )!;
    act(() => handle.dispatchEvent(mouse('mousedown', x, y)));
  };

  it('회전한 그룹은 스프라이트 자세 이동값이 잘리기 전에 전체 배율을 제한한다', () => {
    const first = makeCanonicalSpritePosition({
      id: SPRITE_A,
      dx: 0,
      dy: 0,
      width: 100,
      height: 50,
      idleTransform: { x: 1500, y: -100, rotation: 179, scale: 1 },
      poses: [
        {
          poseId: 'pose',
          triggers: [],
          transform: { x: 20, y: -1800, rotation: -179, scale: 1 },
          imageOverride: null,
          imageOverrideMetrics: null,
        },
      ],
    });
    const second = makeCanonicalSpritePosition({
      id: SPRITE_B,
      dx: 150,
      dy: 30,
      width: 50,
      height: 50,
    });
    const unrelated = makeCanonicalSpritePosition({
      id: 'unselected',
      idleTransform: { x: 2000, y: 0, rotation: 0, scale: 1 },
    });
    const onResize = vi.fn<(result: GroupResizeResult) => void>();
    renderSprites({ '4key': [first, second, unrelated] }, onResize, () => [], {
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      rotation: 90,
    });
    pressHandle('e', 100, 100);
    act(() => document.dispatchEvent(mouse('mousemove', 100, 300)));
    act(() => document.dispatchEvent(mouse('mouseup', 100, 300)));
    const result = onResize.mock.lastCall![0];
    const scale = 2000 / 1800;
    result.elementBounds.forEach(({ bounds }, index) => {
      const position = [first, second][index];
      expect(bounds.width / position.width).toBeCloseTo(scale, 12);
      expect(bounds.height / position.height).toBeCloseTo(scale, 12);
      const projected = projectSpriteResize(position, {
        dx: bounds.x,
        dy: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      expect(projected.idleTransform.x).toBeCloseTo(
        position.idleTransform.x * scale,
        9,
      );
      expect(projected.poses[0]?.transform.y ?? 0).toBeCloseTo(
        (position.poses[0]?.transform.y ?? 0) * scale,
        9,
      );
      expect(projected.idleTransform.rotation).toBe(
        position.idleTransform.rotation,
      );
    });
  });

  // 그룹 리사이즈 한 번을 돌리고 마지막 onGroupResize 결과를 돌려준다
  const dragGroup = (
    spritePositions: SpritePositions,
    handleId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    getOtherElements: () => SmartGuideElementBounds[] = () => [],
  ) => {
    const onGroupResize = vi.fn<(result: GroupResizeResult) => void>();
    renderSprites(spritePositions, onGroupResize, getOtherElements);
    pressHandle(handleId, from.x, from.y);
    act(() => document.dispatchEvent(mouse('mousemove', to.x, to.y)));
    act(() => document.dispatchEvent(mouse('mouseup', to.x, to.y)));
    const result = onGroupResize.mock.lastCall?.[0];
    return {
      groupBounds: result?.groupBounds,
      elementBounds:
        result?.elementBounds ??
        spritePositions['4key'].map((position) => ({
          bounds: {
            x: position.dx,
            y: position.dy,
            width: position.width,
            height: position.height,
          },
        })),
      previewCount: onGroupResize.mock.calls.length,
    };
  };

  it('크기 스냅이 그룹을 더 줄여도 요소는 10px 밑으로 내려가지 않는다', () => {
    // 100x100 스프라이트 둘이 (0,0)·(200,0)에 놓인 300x100 그룹.
    // 그룹 하한은 30까지만 허용하지만 size matching이 28로 다시 당긴다
    const onGroupResize = vi.fn<(result: GroupResizeResult) => void>();
    renderSprites(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 100,
            height: 100,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 200,
            dy: 0,
            width: 100,
            height: 100,
          }),
        ],
      },
      onGroupResize,
      () => [sizeMatchTarget()],
    );
    pressHandle('e', 300, 50);
    act(() => document.dispatchEvent(mouse('mousemove', 0, 50)));

    expect(onGroupResize).toHaveBeenCalledTimes(1);
    const result = onGroupResize.mock.calls[0][0];
    expect(result.groupBounds.width).toBe(30);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.height).toBeGreaterThanOrEqual(10);
    }
    // 화면 가이드도 실제 결과를 따른다 - 성립하지 않은 28px 크기 일치가 남으면 안 되고,
    // 되돌린 뒤 남는 스냅이 없으니 가이드는 통째로 비운다
    expect(mocks.smartGuidesState.setSizeMatchGuides).not.toHaveBeenCalled();
    expect(mocks.smartGuidesState.setDraggedBounds).not.toHaveBeenCalled();
    expect(mocks.smartGuidesState.clearGuides).toHaveBeenCalled();
    act(() => document.dispatchEvent(mouse('mouseup', 0, 50)));
  });

  it('그룹 축소도 투영 반올림으로 요소 하한 아래에 저장하지 않는다', () => {
    const result = dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 77,
            height: 77,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 308,
            dy: 0,
            width: 77,
            height: 77,
          }),
        ],
      },
      'e',
      { x: 385, y: 0 },
      { x: 0, y: 0 },
    );
    expect(result.previewCount).toBe(1);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.height).toBeGreaterThanOrEqual(10);
      expect(bounds.width).toBeCloseTo(10, 9);
    }
  });

  it('한 축이 얇아도 그룹 축소는 스프라이트의 정상 축 하한을 지킨다', () => {
    const result = dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 1600,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
        ],
      },
      'e',
      { x: 2000, y: 0 },
      { x: 0, y: 0 },
    );
    expect(result.previewCount).toBe(1);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.width).toBeCloseTo(10, 9);
      expect(bounds.width / 400).toBeCloseTo(bounds.height / 0.1, 9);
    }
  });

  it('8방향과 스냅별 연속 축소는 최소 크기와 고정 가장자리를 보존한다', () => {
    const handles = [
      { id: 'nw', dx: -1, dy: -1 },
      { id: 'n', dx: 0, dy: -1 },
      { id: 'ne', dx: 1, dy: -1 },
      { id: 'w', dx: -1, dy: 0 },
      { id: 'e', dx: 1, dy: 0 },
      { id: 'sw', dx: -1, dy: 1 },
      { id: 's', dx: 0, dy: 1 },
      { id: 'se', dx: 1, dy: 1 },
    ];
    for (const snapSize of [0, 1, 5, 10]) {
      mocks.settingsState.gridSettings.gridSnapSize = snapSize;
      for (const handle of handles) {
        let sprites = [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 3,
            dy: 7,
            width: 77,
            height: 77,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 311,
            dy: 315,
            width: 77,
            height: 77,
          }),
        ];
        for (let round = 0; round < 3; round += 1) {
          const result = dragGroup(
            { '4key': sprites },
            handle.id,
            { x: 0, y: 0 },
            { x: -1000 * handle.dx, y: -1000 * handle.dy },
          );
          for (const { bounds } of result.elementBounds) {
            expect(bounds.width).toBeGreaterThanOrEqual(10);
            expect(bounds.height).toBeGreaterThanOrEqual(10);
            expect(bounds.width).toBe(bounds.height);
          }
          if (result.groupBounds && handle.dx !== 0 && handle.dy !== 0) {
            const beforeX = Math.min(...sprites.map((sprite) => sprite.dx));
            const beforeY = Math.min(...sprites.map((sprite) => sprite.dy));
            const beforeRight = Math.max(
              ...sprites.map((sprite) => sprite.dx + sprite.width),
            );
            const beforeBottom = Math.max(
              ...sprites.map((sprite) => sprite.dy + sprite.height),
            );
            expect(
              handle.dx === 1
                ? result.groupBounds.x
                : result.groupBounds.x + result.groupBounds.width,
            ).toBeCloseTo(handle.dx === 1 ? beforeX : beforeRight, 9);
            expect(
              handle.dy === 1
                ? result.groupBounds.y
                : result.groupBounds.y + result.groupBounds.height,
            ).toBeCloseTo(handle.dy === 1 ? beforeY : beforeBottom, 9);
          }
          sprites = sprites.map((sprite, index) => ({
            ...sprite,
            dx: result.elementBounds[index].bounds.x,
            dy: result.elementBounds[index].bounds.y,
            width: result.elementBounds[index].bounds.width,
            height: result.elementBounds[index].bounds.height,
          }));
        }
      }
    }
  });

  it('이미 두 축이 얇은 그룹을 줄여도 강제로 키우거나 더 줄이지 않는다', () => {
    const result = dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 1,
            height: 1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 2,
            dy: 0,
            width: 1,
            height: 1,
          }),
        ],
      },
      'e',
      { x: 3, y: 0 },
      { x: -100, y: 0 },
    );
    expect(result.previewCount).toBe(0);
  });

  it.each([
    { id: 'e', dx: 1, dy: 0 },
    { id: 's', dx: 0, dy: 1 },
    { id: 'se', dx: 1, dy: 1 },
  ])(
    '두 축이 얇은 스프라이트와 큰 키를 함께 $id 방향으로 줄이면 크기를 유지하고 확대는 허용한다',
    ({ id, dx, dy }) => {
      mocks.settingsState.gridSettings.gridSnapSize = 0;
      const onGroupResize = vi.fn<(result: GroupResizeResult) => void>();
      const onGroupResizeStart = vi.fn();
      const onGroupResizeEnd = vi.fn();
      const sprite = makeCanonicalSpritePosition({
        id: SPRITE_A,
        dx: 0,
        dy: 0,
        width: 1,
        height: 2,
      });
      const key = {
        ...createDefaultKeyPosition(100, 100),
        id: SPRITE_B,
        width: 100,
        height: 100,
      };
      act(() => {
        root.render(
          <GroupResizeHandles
            selectedElements={[
              { type: 'sprite', id: SPRITE_A, index: 0 },
              { type: 'key', id: SPRITE_B, index: 0 },
            ]}
            positions={{ '4key': [key] }}
            statPositions={{}}
            graphPositions={{}}
            knobPositions={{}}
            spritePositions={{ '4key': [sprite] }}
            selectedKeyType="4key"
            pluginElements={[]}
            getOtherElements={() => []}
            onGroupResize={onGroupResize}
            onGroupResizeStart={onGroupResizeStart}
            onGroupResizeEnd={onGroupResizeEnd}
            continuousInputStrategy="legacy"
          />,
        );
      });
      pressHandle(id, 0, 0);
      const move = (distance: number) => {
        act(() =>
          document.dispatchEvent(
            mouse('mousemove', dx * distance, dy * distance),
          ),
        );
      };

      move(-100);
      expect(onGroupResize).not.toHaveBeenCalled();
      expect(onGroupResizeStart).not.toHaveBeenCalled();
      expect(onGroupResizeEnd).not.toHaveBeenCalled();

      move(50);
      expect(onGroupResize).toHaveBeenCalledTimes(1);
      expect(onGroupResizeStart).toHaveBeenCalledTimes(1);
      const result = onGroupResize.mock.lastCall![0];
      const spriteBounds = result.elementBounds.find(
        ({ element }) => element.id === SPRITE_A,
      )!.bounds;
      const keyBounds = result.elementBounds.find(
        ({ element }) => element.id === SPRITE_B,
      )!.bounds;
      expect(spriteBounds.width).toBe(1.25);
      expect(spriteBounds.height).toBe(2.5);
      expect(keyBounds.width).toBe(dx === 0 ? 100 : 125);
      expect(keyBounds.height).toBe(dy === 0 ? 100 : 125);
      expect(
        result.elementBounds.every(({ bounds }) =>
          isBoundsWithinEditorLimits(bounds),
        ),
      ).toBe(true);
      act(() => document.dispatchEvent(mouse('mouseup', 0, 0)));
      expect(onGroupResizeEnd).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['s', 'e'])(
    '얇은 그룹의 %s 핸들도 정상 축이 하한에 닿기 전까지 축소한다',
    (handleId) => {
      mocks.settingsState.gridSettings.gridSnapSize = 0;
      const vertical = handleId === 's';
      const result = dragGroup(
        {
          '4key': [SPRITE_A, SPRITE_B].map((id, index) =>
            makeCanonicalSpritePosition({
              id,
              dx: vertical ? 0 : index * 0.1,
              dy: vertical ? index * 0.1 : 0,
              width: vertical ? 400 : 0.1,
              height: vertical ? 0.1 : 400,
            }),
          ),
        },
        handleId,
        { x: 0, y: 0 },
        { x: vertical ? 0 : -0.1, y: vertical ? -0.1 : 0 },
      );
      expect(result.previewCount).toBe(1);
      for (const { bounds } of result.elementBounds) {
        expect(vertical ? bounds.width : bounds.height).toBeCloseTo(200, 9);
        expect(vertical ? bounds.height : bounds.width).toBeCloseTo(0.05, 9);
      }
    },
  );

  it('극소 두께 그룹도 하한 반올림 보정이 멈추지 않고 끝난다', () => {
    mocks.settingsState.gridSettings.gridSnapSize = 0;
    const result = dragGroup(
      {
        '4key': [SPRITE_A, SPRITE_B].map((id, index) =>
          makeCanonicalSpritePosition({
            id,
            dx: 0,
            dy: index * 1e-320,
            width: 400,
            height: 1e-320,
          }),
        ),
      },
      'e',
      { x: 0, y: 0 },
      { x: -390, y: 0 },
    );
    expect(result.previewCount).toBe(1);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.height).toBeGreaterThan(0);
    }
  });

  it('얇은 스프라이트 그룹의 세로 확대는 파생 폭 상한에서 멈춘다', () => {
    // 400x0.1 둘이 세로로 붙은 0.2 높이 그룹 - 아래 핸들 100px는 배율 500
    const result = dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 0,
            dy: 0.1,
            width: 400,
            height: 0.1,
          }),
        ],
      },
      's',
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    );
    expect(result.groupBounds!.height).toBeLessThan(100);
    for (const { bounds } of result.elementBounds) {
      expect(isBoundsWithinEditorLimits(bounds)).toBe(true);
      expect(bounds.width / 400).toBeCloseTo(bounds.height / 0.1, 6);
    }
    expect(
      Math.max(...result.elementBounds.map(({ bounds }) => bounds.width)),
    ).toBeGreaterThan(32000);
  });

  it('가로 핸들은 그룹 높이 크기 일치를 받지 않는다', () => {
    // 높이 102는 임계값 안, 폭 1000은 밖 - 예전에는 가로 핸들인데 높이가 102로 바뀌었다
    const heightTarget = (): SmartGuideElementBounds => ({
      id: 'other',
      left: 1000,
      top: 600,
      right: 2000,
      bottom: 702,
      centerX: 1500,
      centerY: 651,
      width: 1000,
      height: 102,
    });
    const result = dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 100,
            height: 100,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 200,
            dy: 0,
            width: 100,
            height: 100,
          }),
        ],
      },
      'e',
      { x: 300, y: 50 },
      { x: 290, y: 50 },
      () => [heightTarget()],
    );
    expect(result.groupBounds!.height).toBe(100);
    expect(result.groupBounds!.width).toBe(290);
  });

  it('가로 핸들은 얇은 그룹의 높이를 10으로 키우지 않는다', () => {
    // 400x0.1 둘이 세로로 붙은 0.2 높이 그룹 - 잡지 않은 세로축은 시작값 그대로
    const result = dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 0,
            dy: 0.1,
            width: 400,
            height: 0.1,
          }),
        ],
      },
      'e',
      { x: 400, y: 0 },
      { x: 440, y: 0 },
    );
    // 그룹 높이는 자란 스프라이트(0.11 둘)를 감싼 0.21 - 10으로 뛰지 않는다
    expect(result.groupBounds!.height).toBeCloseTo(0.21, 9);
    expect(result.groupBounds!.width).toBeCloseTo(440, 9);
    // 배율 1.1 로 폭 440, 높이 0.11 - 중심은 그룹 세로 배율 1 이라 y가 거의 제자리
    for (const { bounds } of result.elementBounds) {
      expect(Math.abs(bounds.y)).toBeLessThan(0.2);
      expect(bounds.width / 400).toBeCloseTo(bounds.height / 0.1, 6);
    }
  });
});
