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
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  acquireHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock';
import {
  isCustomCursorHoverSuspended,
  setCustomCursorHover,
} from '@utils/grid/cursorUtils';

// macOS 커스텀 커서 경로 강제 (호버 억제 계약 검증용)
vi.mock('@utils/core/platform', () => ({
  isMac: () => true,
}));

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
  initialX?: number;
  initialY?: number;
  disabled?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onDragStart: () => void | (() => void);
  onPositionChange: (x: number, y: number) => void;
}

const Harness = ({
  activeTool = 'select',
  initialX = 0,
  initialY = 0,
  disabled = false,
  onClick,
  onDoubleClick,
  onDragStart,
  onPositionChange,
}: HarnessProps) => {
  const draggable = useDraggable({
    initialX,
    initialY,
    elementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    onDragStart,
    onPositionChange,
    disabled,
  });

  return (
    <div
      ref={draggable.ref}
      data-testid="draggable"
      data-dx={draggable.dx}
      data-dy={draggable.dy}
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

// main.css의 body.dmn-dragging 규칙과 결합되는 클래스 계약
const DRAG_CLASS = 'dmn-dragging';

describe('useDraggable pointer contract', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let onClick: Mock<() => void>;
  let onDoubleClick: Mock<() => void>;
  let onDragStart: Mock<() => void | (() => void)>;
  let onPositionChange: Mock<(x: number, y: number) => void>;

  const renderHarness = async (
    activeTool: 'select' | 'eraser' = 'select',
    initial: { x: number; y: number } = { x: 0, y: 0 },
    disabled = false,
  ) => {
    await act(async () => {
      root.render(
        <Harness
          activeTool={activeTool}
          initialX={initial.x}
          initialY={initial.y}
          disabled={disabled}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onDragStart={onDragStart}
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
    onDragStart = vi.fn();
    onPositionChange = vi.fn();
    clearGuides.mockClear();
    setDraggingOrResizing.mockClear();
    document.body.classList.remove(DRAG_CLASS);
    releaseDragSession();
    resetHistoryEditorFlushLock();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    resetHistoryEditorFlushLock();
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
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it.each([
    { painted: false, boundary: 'applied' },
    { painted: true, boundary: 'applied' },
    { painted: false, boundary: 'locked' },
    { painted: true, boundary: 'locked' },
  ])(
    'history $boundary, 프레임 처리 $painted 뒤 늦은 릴리즈는 저장하지 않는다',
    async ({ painted, boundary }) => {
      const finish = vi.fn();
      onDragStart.mockReturnValue(finish);
      const element = await renderHarness();
      await act(async () => {
        dispatchPointer(element, 'pointerdown');
        dispatchPointer(element, 'pointermove', { clientX: 20 });
        if (painted) flushRaf();
        if (boundary === 'applied')
          useCommittedApplyStore.getState().bump('historyUndo');
        else acquireHistoryEditorFlushLock('drag-release');
        dispatchPointer(element, 'pointerup', { clientX: 20 });
        expect(onPositionChange).not.toHaveBeenCalled();
        if (boundary === 'locked')
          useCommittedApplyStore.getState().bump('historyUndo');
        flushRaf();
      });
      expect(onPositionChange).not.toHaveBeenCalled();
      expect(rafCallbacks.size).toBe(0);
      expect(element.hasPointerCapture(1)).toBe(false);
      expect(document.body.classList.contains(DRAG_CLASS)).toBe(false);
      expect(finish).toHaveBeenCalledExactlyOnceWith(false);
      await renderHarness('select', { x: -15, y: 10 });
      expect(element.dataset.dx).toBe('-15');
      expect(element.dataset.dy).toBe('10');
    },
  );

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
    const cleanup = vi.fn();
    onDragStart.mockReturnValue(cleanup);
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
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(true);
    expect(onPositionChange.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.mock.invocationCallOrder[0]!,
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it('한 프레임의 연속 이동에서 최신 좌표를 사용한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      dispatchPointer(element, 'pointermove', { clientX: 21 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 21 });
    });

    expect(onPositionChange).toHaveBeenCalledWith(20, 0);
  });

  it('프레임 전에 pointerup해도 대기 중인 최종 위치를 커밋한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      dispatchPointer(element, 'pointerup', { clientX: 11 });
    });

    expect(rafCallbacks).toHaveLength(0);
    expect(onPositionChange).toHaveBeenCalledWith(10, 0);
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

  it('ends on blur and clears the drag cursor class', async () => {
    const cleanup = vi.fn();
    onDragStart.mockReturnValue(cleanup);
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(true);

    await act(async () => window.dispatchEvent(new Event('blur')));

    expect(document.body.classList.contains(DRAG_CLASS)).toBe(false);
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('press에서 드래그 커서 클래스를 붙이고 정지 릴리즈에 제거한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(true);

    await act(async () => {
      dispatchPointer(element, 'pointerup');
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(false);
  });

  it('드래그 정상 종료에 드래그 커서 클래스를 제거한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(true);

    await act(async () => {
      dispatchPointer(element, 'pointerup', { clientX: 11 });
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(false);
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('pointercancel 취소 경로에서도 드래그 커서 클래스를 제거한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(true);

    await act(async () => {
      dispatchPointer(element, 'pointercancel', { clientX: 11 });
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(false);
  });

  it('active drag 중 unmount에도 드래그 커서 클래스를 제거한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(true);

    await act(async () => {
      root.render(null);
    });
    expect(document.body.classList.contains(DRAG_CLASS)).toBe(false);
  });

  it('active drag를 unmount할 때 gesture cleanup을 한 번 실행한다', async () => {
    const cleanup = vi.fn();
    onDragStart.mockReturnValue(cleanup);
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
      root.render(null);
    });

    expect(onPositionChange).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('ignores non-primary pointers', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown', { isPrimary: false });
    });

    expect(document.body.classList.contains(DRAG_CLASS)).toBe(false);
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

  it('드래그 직후 press 없는 disabled 전이가 표식을 청소한다', async () => {
    let element = await renderHarness();

    // 개별 드래그로 wasMoved·recentPressMovedRef 오염
    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 11 });
    });
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    // press 없이 선택 편입 (마퀴·레이어 탭) - disabled 전이만 발생
    element = await renderHarness('select', { x: 0, y: 0 }, true);

    // wasMoved 리셋 - 클릭 가드가 수식키 클릭을 삼키지 않는다
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    // recentPressMovedRef 리셋 - 더블클릭 편집 진입이 막히지 않는다
    await act(async () => {
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onDoubleClick).toHaveBeenCalledTimes(1);

    // movedThisPressRef 리셋 - 재활성화 후 정지 press 쌍의 더블클릭 허용 유지
    element = await renderHarness('select', { x: 0, y: 0 }, false);
    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointerup');
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointerup');
    });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onDoubleClick).toHaveBeenCalledTimes(2);
  });

  it('드래그 도중 disabled 전이는 trailing click을 흡수하고 한 태스크 뒤 청소한다', async () => {
    let element = await renderHarness();

    // 드래그 진행 중 (릴리즈 전)
    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
    });

    // 릴리즈 전 disabled flip - 표식 청소는 세션 종료 후로 보류된다
    element = await renderHarness('select', { x: 0, y: 0 }, true);

    // 릴리즈 + trailing click - 실드래그이므로 여전히 흡수돼야 한다
    await act(async () => {
      dispatchPointer(element, 'pointerup', { clientX: 11 });
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).not.toHaveBeenCalled();
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    // 한 태스크 뒤 보류된 청소가 정산되어 다음 클릭은 통과한다
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    // recentPressMovedRef도 함께 정산되어 더블클릭 편집 진입이 막히지 않는다
    await act(async () => {
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('runs drag completion once across duplicate terminal signals', async () => {
    const cleanup = vi.fn();
    onDragStart.mockReturnValue(cleanup);
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
      dispatchPointer(element, 'pointercancel', { clientX: 11 });
      dispatchPointer(element, 'lostpointercapture');
      window.dispatchEvent(new Event('blur'));
    });

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(true);
    expect(setDraggingOrResizing).toHaveBeenLastCalledWith(false);
    expect(
      setDraggingOrResizing.mock.calls.filter(([value]) => value === false),
    ).toHaveLength(1);
  });

  it('드래그 중 외부 initial 변경이 시작 좌표를 오염시키지 않는다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 11 });
      flushRaf();
    });
    // 드래그 중 외부 store 변경 (다른 창 커밋, undo 등)
    await renderHarness('select', { x: 100, y: 50 });
    expect(element.dataset.dx).toBe('10');
    expect(element.dataset.dy).toBe('0');

    await act(async () => {
      dispatchPointer(element, 'pointerup', { clientX: 11 });
    });

    // 릴리즈 커밋은 드래그 결과 좌표, 외부 값이 아니다
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenCalledWith(10, 0);
    expect(element.dataset.dx).toBe('10');
    expect(element.dataset.dy).toBe('0');
  });

  it('정지 press 중 도착한 외부 initial 변경은 릴리즈 후 반영된다', async () => {
    const element = await renderHarness();

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
    });
    await renderHarness('select', { x: 70, y: 30 });
    await act(async () => {
      dispatchPointer(element, 'pointerup');
    });

    // 커밋 없이 종료된 press는 유예된 외부 동기화를 정산한다
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(element.dataset.dx).toBe('70');
    expect(element.dataset.dy).toBe('30');
  });

  it('press가 기존 호버 커서를 걷어내고 세션 해제 한 태스크 뒤까지 호버 갱신을 막는다', async () => {
    const CURSOR_BODY_CLASS = 'dmn-custom-cursor';
    const element = await renderHarness();

    // 이전 테스트 세션의 resume 지연 타이머 정산
    await new Promise((resolve) => setTimeout(resolve, 0));

    setCustomCursorHover('ns-resize');
    expect(document.body.classList.contains(CURSOR_BODY_CLASS)).toBe(true);

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
    });
    // 세션 시작 시 잔여 호버 강제 클리어
    expect(document.body.classList.contains(CURSOR_BODY_CLASS)).toBe(false);
    expect(isCustomCursorHoverSuspended()).toBe(true);

    // 세션 중 도착한 enter성 호버 설정 무시
    setCustomCursorHover('ew-resize');
    expect(document.body.classList.contains(CURSOR_BODY_CLASS)).toBe(false);

    // 해제와 같은 태스크로 도착하는 boundary 잔여분 재현을 위해 동기 act 사용
    act(() => {
      dispatchPointer(element, 'pointerup');
      setCustomCursorHover('ew-resize');
    });
    expect(document.body.classList.contains(CURSOR_BODY_CLASS)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isCustomCursorHoverSuspended()).toBe(false);

    // 억제 해제 후에는 정상 호버 복귀
    setCustomCursorHover('ns-resize');
    expect(document.body.classList.contains(CURSOR_BODY_CLASS)).toBe(true);
    setCustomCursorHover(null);
  });
});
