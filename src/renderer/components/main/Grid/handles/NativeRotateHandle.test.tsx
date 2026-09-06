import React, { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  acquireHistoryEditorFlushLock,
  releaseHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/historyEditorFlushLock';
import {
  releaseDragSession,
  tryAcquireDragSession,
} from '@hooks/Grid/dragSession';
import { endDragCursor } from '@utils/core/dragCursor';
import { rotatePointAround } from '@utils/core/rotation';
import {
  getCursor,
  setCustomCursorHover,
  unlockCustomCursor,
} from '@utils/grid/cursorUtils';
import NativeRotateHandle from './NativeRotateHandle';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  patch: vi.fn(async () => {}),
  activeGestureId: vi.fn<() => string | undefined>(),
  settleCommit: vi.fn(),
  cancel: vi.fn(),
}));

// 저장·프리뷰 경계만 대체하고 포인터·프레임·소유권·커서는 실제 경로 사용
vi.mock('../PropertiesPanel/previewPatchForwarders', () => ({
  previewSingleStyleProperty: mocks.preview,
}));
vi.mock('@src/renderer/editor/runtime/elementPaintStyleOps', () => ({
  patchStylePropertyById: mocks.patch,
}));
vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
  editGestureController: {
    activeGestureId: mocks.activeGestureId,
    settleCommit: mocks.settleCommit,
    cancel: mocks.cancel,
  },
}));
vi.mock('@utils/core/platform', () => ({ isMac: () => true }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof NativeRotateHandle>;
type PointerPosition = { clientX: number; clientY: number };

const ELEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GESTURE_ID = 'native-rotation-gesture';
const HOST_ORIGIN = { x: 30, y: 40 };
const BASE_PROPS: Props = {
  elementType: 'key',
  elementId: ELEMENT_ID,
  bounds: { x: 20, y: 30, width: 100, height: 60 },
  rotation: 30,
  zoom: 1.5,
  panX: 7,
  panY: -3,
};
const CENTER = {
  x: HOST_ORIGIN.x + (20 + 100 / 2) * 1.5 + 7,
  y: HOST_ORIGIN.y + (30 + 60 / 2) * 1.5 - 3,
};

describe('NativeRotateHandle 모서리 회전', () => {
  let container: HTMLDivElement;
  let root: Root;

  const corners = () =>
    container.querySelectorAll<HTMLDivElement>('[data-rotate-corner]');

  const render = (overrides: Partial<Props> = {}) => {
    act(() => {
      root.render(<NativeRotateHandle {...BASE_PROPS} {...overrides} />);
    });
    const overlay = container.querySelector<HTMLDivElement>(
      '[data-rotation-handles="native"]',
    )!;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(HOST_ORIGIN.x, HOST_ORIGIN.y, 1200, 900),
    );
  };

  const cornerPosition = (corner: HTMLDivElement): PointerPosition => {
    const origin = Number.parseFloat(corner.style.transformOrigin);
    const pivot = {
      x: HOST_ORIGIN.x + Number.parseFloat(corner.style.left) + origin,
      y: HOST_ORIGIN.y + Number.parseFloat(corner.style.top) + origin,
    };
    const point = rotatePointAround(
      { x: pivot.x - 18, y: pivot.y - 18 },
      pivot,
      Number.parseFloat(corner.style.transform.slice(7)),
    );
    return { clientX: point.x, clientY: point.y };
  };

  const turnedPosition = (
    start: PointerPosition,
    degrees: number,
  ): PointerPosition => {
    const angle = (degrees * Math.PI) / 180;
    const x = start.clientX - CENTER.x;
    const y = start.clientY - CENTER.y;
    return {
      clientX: CENTER.x + x * Math.cos(angle) - y * Math.sin(angle),
      clientY: CENTER.y + x * Math.sin(angle) + y * Math.cos(angle),
    };
  };

  const pointer = (
    type: string,
    target: EventTarget,
    init: PointerEventInit = {},
  ) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1,
      ...init,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };

  const flushFrame = () => {
    act(() => {
      vi.advanceTimersByTime(16);
    });
  };

  const expectReleased = (corner: HTMLDivElement) => {
    expect(corner.hasPointerCapture(1)).toBe(false);
    expect(document.documentElement.classList.contains('dmn-drag-cursor')).toBe(
      false,
    );
    expect(
      document.documentElement.style.getPropertyValue('--dmn-drag-cursor'),
    ).toBe('');
    expect(document.body.classList.contains('dmn-custom-cursor')).toBe(false);
    expect(tryAcquireDragSession()).toBe(true);
    releaseDragSession();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    mocks.activeGestureId.mockReturnValue(undefined);
    mocks.preview.mockImplementation(() => {
      mocks.activeGestureId.mockReturnValue(GESTURE_ID);
    });
    mocks.cancel.mockImplementation(() => {
      mocks.activeGestureId.mockReturnValue(undefined);
    });
    resetHistoryEditorFlushLock();
    releaseDragSession();
    useCommittedApplyStore.setState({ commitTick: 0, historyTick: 0 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetHistoryEditorFlushLock();
    releaseDragSession();
    unlockCustomCursor();
    setCustomCursorHover(null);
    endDragCursor();
    act(() => vi.runOnlyPendingTimers());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['key', 'stat', 'graph', 'knob'] as const)(
    '%s의 모서리에서 시작해 마지막 프레임을 한 번 커밋하고 커서를 해제한다',
    (elementType) => {
      render({ elementType });
      const index = ['key', 'stat', 'graph', 'knob'].indexOf(elementType);
      const corner = corners()[index];
      const cursor = getCursor(
        (['rotate-45', 'rotate-135', 'rotate-225', 'rotate-315'] as const)[
          index
        ],
      );
      const start = cornerPosition(corner);
      const bubbledDown = vi.fn();
      document.body.addEventListener('pointerdown', bubbledDown);

      expect(corners()).toHaveLength(4);
      expect(container.querySelector('[data-native-rotate-knob]')).toBeNull();
      expect(
        corner.closest('[data-dmn-canvas-editor-overlay="true"]'),
      ).not.toBeNull();
      expect(pointer('pointerdown', corner, start).defaultPrevented).toBe(true);
      document.body.removeEventListener('pointerdown', bubbledDown);
      expect(bubbledDown).not.toHaveBeenCalled();
      expect(corner.hasPointerCapture(1)).toBe(true);
      expect(
        document.documentElement.style.getPropertyValue('--dmn-drag-cursor'),
      ).toBe(cursor);
      expect(document.body.classList.contains('dmn-custom-cursor')).toBe(true);

      pointer('pointermove', window, turnedPosition(start, 20));
      flushFrame();
      expect(mocks.preview).toHaveBeenLastCalledWith(elementType, ELEMENT_ID, {
        property: 'rotation',
        value: expect.closeTo(50, 6),
      });
      expect(corners()[index]).toBe(corner);
      expect(corner.hasPointerCapture(1)).toBe(true);

      expect(
        document.documentElement.style.getPropertyValue('--dmn-drag-cursor'),
      ).toBe(cursor);

      pointer('pointermove', window, turnedPosition(start, 90));
      expect(mocks.patch).not.toHaveBeenCalled();
      pointer('pointerup', window, turnedPosition(start, 90));
      pointer('pointerup', window, turnedPosition(start, 90));
      act(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })));
      flushFrame();

      expect(mocks.preview).toHaveBeenCalledTimes(2);
      expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(
        elementType,
        ELEMENT_ID,
        { property: 'rotation', value: expect.closeTo(120, 6) },
        { gestureId: GESTURE_ID },
      );
      expect(mocks.settleCommit).toHaveBeenCalledExactlyOnceWith(
        mocks.patch.mock.results[0].value,
      );
      expect(mocks.cancel).not.toHaveBeenCalled();
      expectReleased(corner);
    },
  );

  it('Shift 회전은 절대각을 15°에 스냅하고 up의 보조키와 무관하게 저장한다', () => {
    render({ rotation: 7 });
    const corner = corners()[2];
    const start = cornerPosition(corner);
    pointer('pointerdown', corner, start);
    pointer('pointermove', window, {
      ...turnedPosition(start, 22),
      shiftKey: true,
    });
    pointer('pointerup', window, turnedPosition(start, 22));

    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(
      'key',
      ELEMENT_ID,
      { property: 'rotation', value: 30 },
      { gestureId: GESTURE_ID },
    );
    expectReleased(corner);
  });

  it.each([
    'historyUndo',
    'historyFlush',
    'pointercancel',
    'escape',
    'blur',
    'targetChange',
    'unmount',
  ] as const)(
    '%s 뒤 늦은 move·up은 취소한 회전을 다시 저장하지 않는다',
    (reason) => {
      render();
      const corner = corners()[0];
      const start = cornerPosition(corner);
      pointer('pointerdown', corner, start);
      pointer('pointermove', window, turnedPosition(start, 45));
      flushFrame();
      pointer('pointermove', window, turnedPosition(start, 90));

      switch (reason) {
        case 'historyUndo':
          act(() => useCommittedApplyStore.getState().bump('historyUndo'));
          break;
        case 'historyFlush':
          act(() => {
            acquireHistoryEditorFlushLock('rotation-history-flush');
          });
          releaseHistoryEditorFlushLock('rotation-history-flush');
          break;
        case 'pointercancel':
          pointer('pointercancel', window);
          break;
        case 'escape':
          act(() =>
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape' }),
            ),
          );
          break;
        case 'blur':
          act(() => window.dispatchEvent(new Event('blur')));
          break;
        case 'targetChange':
          render({ elementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
          break;
        case 'unmount':
          act(() => root.render(null));
          break;
      }

      pointer('pointermove', window, turnedPosition(start, 120));
      pointer('pointerup', window, turnedPosition(start, 120));
      flushFrame();

      expect(mocks.preview).toHaveBeenCalledOnce();
      expect(mocks.cancel).toHaveBeenCalledOnce();
      expect(mocks.patch).not.toHaveBeenCalled();
      expect(mocks.settleCommit).not.toHaveBeenCalled();
      expectReleased(corner);
    },
  );

  it('움직이지 않은 클릭은 편집을 만들지 않고 캡처와 커서만 해제한다', () => {
    render();
    const corner = corners()[0];
    const start = cornerPosition(corner);
    pointer('pointerdown', corner, start);
    pointer('pointerup', window, start);

    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expectReleased(corner);
  });

  it('다른 포인터는 시작한 드래그를 변경하거나 끝내지 못한다', () => {
    render();
    const corner = corners()[1];
    const start = cornerPosition(corner);
    pointer('pointerdown', corner, start);
    pointer('pointermove', window, {
      ...turnedPosition(start, 90),
      pointerId: 2,
    });
    pointer('pointerup', window, { ...start, pointerId: 2 });
    flushFrame();

    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(corner.hasPointerCapture(1)).toBe(true);
    expect(tryAcquireDragSession()).toBe(false);

    pointer('pointercancel', window);
    expectReleased(corner);
  });

  it('모서리 호버는 회전 커서를 켜고 드래그 중에는 영역을 벗어나도 유지한다', () => {
    render();
    const corner = corners()[0];
    const start = cornerPosition(corner);
    pointer('pointerover', corner, start);
    expect(document.body.classList.contains('dmn-custom-cursor')).toBe(true);
    pointer('pointerout', corner, { relatedTarget: document.body });
    expect(document.body.classList.contains('dmn-custom-cursor')).toBe(false);

    pointer('pointerover', corner, start);
    pointer('pointerdown', corner, start);
    pointer('pointerout', corner, { relatedTarget: document.body });
    expect(document.body.classList.contains('dmn-custom-cursor')).toBe(true);
    pointer('pointermove', window, turnedPosition(start, 45));
    pointer('pointerup', window, turnedPosition(start, 45));

    expect(mocks.patch).toHaveBeenCalledOnce();
    expectReleased(corner);
  });

  it('호버 중 선택 핸들이 사라지면 회전 커서도 남지 않는다', () => {
    render();
    const corner = corners()[3];
    pointer('pointerover', corner, cornerPosition(corner));
    expect(document.body.classList.contains('dmn-custom-cursor')).toBe(true);

    act(() => root.render(null));

    expect(mocks.patch).not.toHaveBeenCalled();
    expectReleased(corner);
  });
});
