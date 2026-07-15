/* eslint-disable react-hooks/refs -- callback ref 반환 계약 테스트 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { useDraggable } from './useDraggable';
import { releaseDragSession } from './dragSession';

const { clearGuides, setDraggingOrResizing } = vi.hoisted(() => ({
  clearGuides: vi.fn(),
  setDraggingOrResizing: vi.fn(),
}));

vi.mock('@stores/grid/useSmartGuidesStore', () => ({
  useSmartGuidesStore: {
    getState: () => ({
      clearGuides,
      setDraggedBounds: vi.fn(),
      setActiveGuides: vi.fn(),
      setSpacingGuides: vi.fn(),
    }),
  },
}));

vi.mock('@stores/grid/useGridSelectionStore', () => ({
  useGridSelectionStore: {
    getState: () => ({
      isMiddleButtonDragging: false,
      setDraggingOrResizing,
    }),
  },
}));

vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      gridSettings: {
        gridSnapSize: 5,
        alignmentGuides: false,
        spacingGuides: false,
      },
    }),
  },
}));

interface HarnessProps {
  activeTool?: 'select' | 'eraser';
  onClick: () => void;
  onDoubleClick: () => void;
  onPositionChange: (x: number, y: number) => void;
}

const Harness = ({
  activeTool = 'select',
  onClick,
  onDoubleClick,
  onPositionChange,
}: HarnessProps) => {
  const draggable = useDraggable({
    initialX: 0,
    initialY: 0,
    onPositionChange,
  });

  return (
    <div
      ref={draggable.ref}
      data-testid="draggable"
      onClick={() => {
        if (!draggable.wasMoved) onClick();
      }}
      onDoubleClick={(event) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
        if (activeTool === 'eraser' || draggable.recentPressMovedRef.current)
          return;
        onDoubleClick();
      }}
    />
  );
};

describe('useDraggable pointer contract', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let onClick: Mock<() => void>;
  let onDoubleClick: Mock<() => void>;
  let onPositionChange: Mock<(x: number, y: number) => void>;

  const renderHarness = async (activeTool: 'select' | 'eraser' = 'select') => {
    await act(async () => {
      root.render(
        <Harness
          activeTool={activeTool}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onPositionChange={onPositionChange}
        />,
      );
    });
    return host.querySelector<HTMLElement>('[data-testid="draggable"]')!;
  };

  const dispatchPointer = (
    target: Element,
    type: string,
    init: PointerEventInit = {},
  ) => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        ...init,
      }),
    );
  };

  const flushRaf = () => {
    const callbacks = [...rafCallbacks.values()];
    rafCallbacks.clear();
    callbacks.forEach((callback) => callback(performance.now()));
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    rafCallbacks = new Map();
    nextRafId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      rafCallbacks.delete(id);
    });
    onClick = vi.fn();
    onDoubleClick = vi.fn();
    onPositionChange = vi.fn();
    clearGuides.mockClear();
    setDraggingOrResizing.mockClear();
    document.body.style.cursor = '';
    releaseDragSession();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('treats a stationary press as one click', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointerup');
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('allows only a stationary unmodified select-mode double click', async () => {
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      element.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, shiftKey: true }),
      );
      element.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, metaKey: true }),
      );
      element.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, ctrlKey: true }),
      );
    });
    expect(onDoubleClick).toHaveBeenCalledTimes(1);

    await renderHarness('eraser');
    await act(async () => {
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onDoubleClick).toHaveBeenCalledTimes(1);

    await renderHarness();
    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 10 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 10 });
    });
    await act(async () => {
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('keeps movement under 5px eligible for click', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 4 });
      dispatchPointer(element, 'pointerup', { clientX: 4 });
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('commits one drag over 5px and suppresses the following click', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 11 });
    });
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenCalledWith(10, 0);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores an additional press while the active pointer owns the session', async () => {
    const element = await renderHarness();
    const setPointerCapture = vi.spyOn(element, 'setPointerCapture');

    await act(async () => {
      dispatchPointer(element, 'pointerdown', { pointerId: 1 });
      dispatchPointer(element, 'pointerdown', { pointerId: 2 });
      dispatchPointer(element, 'pointermove', { pointerId: 1, clientX: 11 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { pointerId: 1, clientX: 11 });
    });

    expect(setPointerCapture).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('ends on blur and restores both element and body cursors', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
    });
    expect(element.style.cursor).toBe('grabbing');
    expect(document.body.style.cursor).toBe('grabbing');

    await act(async () => window.dispatchEvent(new Event('blur')));

    expect(element.style.cursor).toBe('');
    expect(document.body.style.cursor).toBe('');
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('ignores non-primary pointers', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown', { isPrimary: false });
    });

    expect(element.style.cursor).toBe('');
    expect(setDraggingOrResizing).not.toHaveBeenCalled();
  });

  it('blocks double click when the first press of the pair dragged', async () => {
    const element = await renderHarness();

    // 첫 press: 드래그 후 제자리 복귀 → 두 번째 press: 정지 → dblclick
    await act(async () => {
      dispatchPointer(element, 'pointerdown', { clientX: 0, clientY: 0 });
      dispatchPointer(element, 'pointermove', { clientX: 10, clientY: 0 });
      flushRaf();
      dispatchPointer(element, 'pointermove', { clientX: 0, clientY: 0 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 0, clientY: 0 });
      dispatchPointer(element, 'pointerdown', { clientX: 0, clientY: 0 });
      dispatchPointer(element, 'pointerup', { clientX: 0, clientY: 0 });
    });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onDoubleClick).not.toHaveBeenCalled();

    // 그 다음의 정지 press 쌍에서는 다시 허용
    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointerup');
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointerup');
    });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('runs drag completion once across duplicate terminal signals', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 11 });
      dispatchPointer(element, 'lostpointercapture');
      window.dispatchEvent(new Event('blur'));
    });

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(setDraggingOrResizing).toHaveBeenLastCalledWith(false);
    expect(
      setDraggingOrResizing.mock.calls.filter(([value]) => value === false),
    ).toHaveLength(1);
  });
});
