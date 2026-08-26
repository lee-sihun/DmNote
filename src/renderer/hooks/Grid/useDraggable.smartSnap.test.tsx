// @vitest-environment jsdom
/* eslint-disable react-hooks/refs -- callback ref 반환 계약 테스트 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

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

// 이 파일은 스마트 가이드 스냅 경로 전용 - 정렬 가이드를 켠다
vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      gridSettings: {
        gridSnapSize: 5,
        alignmentGuides: true,
        spacingGuides: false,
      },
    }),
  },
}));

import { useDraggable } from './useDraggable';
import { calculateBounds, type ElementBounds } from '@utils/grid/smartGuides';

interface HarnessProps {
  initialX: number;
  initialY: number;
  otherElements: ElementBounds[];
  onPositionChange: (x: number, y: number) => void;
}

const Harness = ({
  initialX,
  initialY,
  otherElements,
  onPositionChange,
}: HarnessProps) => {
  const draggable = useDraggable({
    initialX,
    initialY,
    elementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    elementWidth: 60,
    elementHeight: 60,
    getOtherElements: () => otherElements,
    onPositionChange,
  });

  return <div ref={draggable.ref} data-testid="draggable" />;
};

describe('useDraggable 스마트 스냅 좌표 정밀도', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let onPositionChange: Mock<(x: number, y: number) => void>;

  const renderHarness = async (
    initial: { x: number; y: number },
    otherElements: ElementBounds[],
  ) => {
    await act(async () => {
      root.render(
        <Harness
          initialX={initial.x}
          initialY={initial.y}
          otherElements={otherElements}
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
    onPositionChange = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('홀수 크기 이웃과의 중앙 정렬은 소수 좌표를 그대로 커밋한다', async () => {
    // 이웃: x=160 폭 63 → 중앙 191.5. 드래그 요소 폭 60이 중앙 정렬되려면 x=161.5
    const neighbor = calculateBounds(160, 30, 63, 60, 'neighbor');
    const element = await renderHarness({ x: 60, y: 120 }, [neighbor]);

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      // dx 60 + 101 = 161 → 중앙 191, 이웃 중앙 191.5과 0.5 차이로 중앙 스냅
      dispatchPointer(element, 'pointermove', { clientX: 101, clientY: 0 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 101, clientY: 0 });
    });

    // 스냅 좌표를 반올림하면 162가 되어 가이드 선(191.5)과 0.5px 어긋난다
    expect(onPositionChange).toHaveBeenLastCalledWith(161.5, 120);
  });

  it('스마트 스냅이 없는 축은 그리드 스냅을 유지한다', async () => {
    const neighbor = calculateBounds(160, 30, 63, 60, 'neighbor');
    const element = await renderHarness({ x: 60, y: 120 }, [neighbor]);

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      // Y는 이웃과 정렬 후보가 없어 5px 그리드로 반올림된다
      dispatchPointer(element, 'pointermove', { clientX: 101, clientY: 8 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 101, clientY: 8 });
    });

    const [, y] = onPositionChange.mock.lastCall!;
    expect(y % 5).toBe(0);
  });

  it('primary modifier를 누르면 스마트 스냅을 건너뛰고 그리드 스냅만 남는다', async () => {
    const neighbor = calculateBounds(160, 30, 63, 60, 'neighbor');
    const element = await renderHarness({ x: 60, y: 120 }, [neighbor]);

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      // 먼저 modifier 없이 스냅 상태를 만든 뒤 초기화 - 억제 분기의
      // clearGuides만 검증한다 (pointerdown·pointerup의 청소와 구분)
      dispatchPointer(element, 'pointermove', { clientX: 101, clientY: 0 });
      flushRaf();
    });
    clearGuides.mockClear();

    await act(async () => {
      // macOS mock 기준 metaKey - 같은 지점이지만 중앙 스냅 대신 5px 격자로
      dispatchPointer(element, 'pointermove', {
        clientX: 102,
        clientY: 0,
        metaKey: true,
      });
      flushRaf();
    });
    // 억제 분기가 남아 있던 가이드를 지운다 (pointerup 전에 검증)
    expect(clearGuides).toHaveBeenCalled();

    await act(async () => {
      dispatchPointer(element, 'pointerup', { clientX: 102, clientY: 0 });
    });

    const [x] = onPositionChange.mock.lastCall!;
    expect(x % 5).toBe(0);
  });

  it('이웃이 없으면 소수 시작점도 그리드 배수로 스냅된다', async () => {
    const element = await renderHarness({ x: 61.5, y: 120 }, []);

    await act(async () => {
      dispatchPointer(element, 'pointerdown');
      dispatchPointer(element, 'pointermove', { clientX: 12, clientY: 0 });
      flushRaf();
      dispatchPointer(element, 'pointerup', { clientX: 12, clientY: 0 });
    });

    const [x] = onPositionChange.mock.lastCall!;
    expect(x % 5).toBe(0);
  });
});
