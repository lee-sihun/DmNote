// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { ElementBounds as SmartGuideElementBounds } from '@utils/grid/smartGuides';
import GroupResizeHandles from './GroupResizeHandles';
import type { GroupResizeHandle, GroupResizeResult } from './groupResizePlan';

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
  }: {
    strategy?: 'legacy' | 'frame';
    zoom?: number;
    onStart?: (handle: GroupResizeHandle) => void;
    onResize?: (result: GroupResizeResult) => void;
    onEnd?: () => void;
    getOtherElements?: (excludeIds: string[]) => SmartGuideElementBounds[];
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
