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
import { useSelectionDrag } from './useSelectionDrag';
import { releaseDragSession } from './dragSession';
import {
  calculateGroupBounds,
  type ElementBounds,
} from '@utils/grid/smartGuides';

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
    getState: () => ({ setDraggingOrResizing }),
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

// 그룹 bounds 수집 회귀 검증용 스파이 — 나머지는 실구현 유지
vi.mock('@utils/grid/smartGuides', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@utils/grid/smartGuides')
  >();
  return {
    ...actual,
    calculateGroupBounds: vi.fn(actual.calculateGroupBounds),
  };
});

interface HarnessProps {
  onClick: () => void;
  onMovedCheck: (moved: boolean) => void;
  onMultiDragStart: () => void | (() => void);
  onMultiDrag: (dx: number, dy: number) => void;
  onMultiDragEnd: () => void;
}

const Harness = ({
  onClick,
  onMovedCheck,
  onMultiDragStart,
  onMultiDrag,
  onMultiDragEnd,
}: HarnessProps) => {
  const { handlePointerDown, movedDuringPressRef } = useSelectionDrag({
    enabled: true,
    zoom: 1,
    startX: 0,
    startY: 0,
    elementId: 'key-0',
    elementWidth: 60,
    elementHeight: 60,
    selectedElements: [{ id: 'key-0', type: 'key', index: 0 }],
    getOtherElements: () => [],
    onMultiDragStart,
    onMultiDrag,
    onMultiDragEnd,
  });

  return (
    <div
      data-testid="selection-drag"
      onPointerDown={handlePointerDown}
      onClick={onClick}
      onDoubleClick={() => onMovedCheck(movedDuringPressRef.current)}
    />
  );
};

// index가 없는 플러그인 2개 선택 시나리오 — 그룹 bounds 오인 회귀 검증용
const PluginPairHarness = () => {
  const { handlePointerDown } = useSelectionDrag({
    enabled: true,
    zoom: 1,
    startX: 0,
    startY: 0,
    elementId: 'plugin-a',
    elementWidth: 100,
    elementHeight: 100,
    selectedElements: [
      { id: 'plugin-a', type: 'plugin' },
      { id: 'plugin-b', type: 'plugin' },
    ],
    getOtherElements: () => [
      {
        id: 'plugin-b',
        left: 200,
        top: 0,
        right: 300,
        bottom: 100,
        centerX: 250,
        centerY: 50,
        width: 100,
        height: 100,
      },
    ],
  });

  return <div data-testid="plugin-drag" onPointerDown={handlePointerDown} />;
};

interface MovingPluginPairHarnessProps {
  getOtherElements: () => ElementBounds[];
  onMultiDrag: (dx: number, dy: number) => void;
}

const MovingPluginPairHarness = ({
  getOtherElements,
  onMultiDrag,
}: MovingPluginPairHarnessProps) => {
  const { handlePointerDown } = useSelectionDrag({
    enabled: true,
    zoom: 1,
    startX: 0,
    startY: 0,
    elementId: 'plugin-a',
    elementWidth: 100,
    elementHeight: 100,
    selectedElements: [
      { id: 'plugin-a', type: 'plugin' },
      { id: 'plugin-b', type: 'plugin' },
    ],
    getOtherElements,
    onMultiDrag,
  });

  return (
    <div data-testid="moving-plugin-drag" onPointerDown={handlePointerDown} />
  );
};

describe('useSelectionDrag', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let onClick: Mock<() => void>;
  let onMovedCheck: Mock<(moved: boolean) => void>;
  let onMultiDragStart: Mock<() => void | (() => void)>;
  let onMultiDrag: Mock<(dx: number, dy: number) => void>;
  let onMultiDragEnd: Mock<() => void>;

  const renderHarness = async () => {
    await act(async () => {
      root.render(
        <Harness
          onClick={onClick}
          onMovedCheck={onMovedCheck}
          onMultiDragStart={onMultiDragStart}
          onMultiDrag={onMultiDrag}
          onMultiDragEnd={onMultiDragEnd}
        />,
      );
    });
    return host.querySelector<HTMLElement>('[data-testid="selection-drag"]')!;
  };

  const pointerEvent = (type: string, init: PointerEventInit = {}) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      ...init,
    });

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
    onMovedCheck = vi.fn();
    onMultiDragStart = vi.fn();
    onMultiDrag = vi.fn();
    onMultiDragEnd = vi.fn();
    clearGuides.mockClear();
    setDraggingOrResizing.mockClear();
    releaseDragSession();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('moves on the first valid snapped delta without a 5px threshold', async () => {
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 3 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 3 }));
    });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onMultiDragStart).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledWith(5, 0);
    expect(onMultiDragEnd).toHaveBeenCalledTimes(1);
    expect(onMovedCheck).toHaveBeenCalledWith(true);
  });

  it('한 프레임의 연속 이동에서 최신 좌표를 사용한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 3 }));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 12 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 12 }));
    });

    expect(onMultiDrag).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledWith(10, 0);
  });

  it('프레임 전에 pointerup해도 대기 중인 이동을 반영한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 7 }));
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 7 }));
    });

    expect(rafCallbacks).toHaveLength(0);
    expect(onMultiDrag).toHaveBeenCalledWith(5, 0);
    expect(onMultiDragEnd).toHaveBeenCalledOnce();
  });

  it('keeps pointerdown uncanceled so compatibility click remains available', async () => {
    const element = await renderHarness();
    const down = pointerEvent('pointerdown');

    await act(async () => {
      element.dispatchEvent(down);
      element.dispatchEvent(pointerEvent('pointerup'));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(down.defaultPrevented).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMultiDragStart).not.toHaveBeenCalled();
    expect(onMultiDragEnd).not.toHaveBeenCalled();
  });

  it('ignores an additional press during the owned pointer session', async () => {
    const element = await renderHarness();
    const setPointerCapture = vi.spyOn(element, 'setPointerCapture');

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
      element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }));
      element.dispatchEvent(
        pointerEvent('pointermove', { pointerId: 1, clientX: 7 }),
      );
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }));
    });

    expect(setPointerCapture).toHaveBeenCalledTimes(1);
    expect(onMultiDragStart).toHaveBeenCalledTimes(1);
    expect(onMultiDragEnd).toHaveBeenCalledTimes(1);
  });

  it('completes once across duplicate terminal signals', async () => {
    const cleanup = vi.fn();
    onMultiDragStart.mockReturnValue(cleanup);
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 7 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointercancel'));
      element.dispatchEvent(pointerEvent('lostpointercapture'));
      window.dispatchEvent(new Event('blur'));
    });

    expect(onMultiDragEnd).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(onMultiDragEnd.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.mock.invocationCallOrder[0]!,
    );
    expect(
      setDraggingOrResizing.mock.calls.filter(([value]) => value === false),
    ).toHaveLength(1);
  });

  it('active drag를 unmount할 때 gesture cleanup을 한 번 실행한다', async () => {
    const cleanup = vi.fn();
    onMultiDragStart.mockReturnValue(cleanup);
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 7 }));
      flushRaf();
      root.render(null);
    });

    expect(onMultiDragEnd).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('keeps the double-click guard across the second stationary press', async () => {
    const element = await renderHarness();

    // 첫 press 드래그 → 두 번째 정지 press → dblclick: 가드 유지돼야 함
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 7 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 7 }));
      element.dispatchEvent(pointerEvent('pointerdown', { clientX: 7 }));
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 7 }));
    });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onMovedCheck).toHaveBeenLastCalledWith(true);
  });

  it('keeps other plugins distinct in group bounds without index collision', async () => {
    await act(async () => {
      root.render(<PluginPairHarness />);
    });
    const element = host.querySelector<HTMLElement>(
      '[data-testid="plugin-drag"]',
    )!;

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 7 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 7 }));
    });

    const groupCall = vi
      .mocked(calculateGroupBounds)
      .mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(groupCall).toHaveLength(2);
    expect(groupCall.map((bounds) => bounds.id).sort()).toEqual([
      'plugin-a',
      'plugin-b',
    ]);
  });

  it('keeps selected group bounds based on drag-start positions across frames', async () => {
    let pluginBLeft = 200;
    const getOtherElements = vi.fn(() => [
      {
        id: 'plugin-b',
        left: pluginBLeft,
        top: 0,
        right: pluginBLeft + 100,
        bottom: 100,
        centerX: pluginBLeft + 50,
        centerY: 50,
        width: 100,
        height: 100,
      },
    ]);
    const updateStorePosition = vi.fn((dx: number) => {
      pluginBLeft += dx;
    });

    await act(async () => {
      root.render(
        <MovingPluginPairHarness
          getOtherElements={getOtherElements}
          onMultiDrag={updateStorePosition}
        />,
      );
    });
    const element = host.querySelector<HTMLElement>(
      '[data-testid="moving-plugin-drag"]',
    )!;

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 5 }));
      flushRaf();
    });
    const firstFrameBounds = vi
      .mocked(calculateGroupBounds)
      .mock.calls.at(-1)?.[0];
    expect(
      firstFrameBounds?.find((bounds) => bounds.id === 'plugin-b')?.left,
    ).toBe(205);

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 10 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 10 }));
    });
    const secondFrameBounds = vi
      .mocked(calculateGroupBounds)
      .mock.calls.at(-1)?.[0];
    expect(
      secondFrameBounds?.find((bounds) => bounds.id === 'plugin-b')?.left,
    ).toBe(210);
    expect(updateStorePosition).toHaveBeenNthCalledWith(1, 5, 0);
    expect(updateStorePosition).toHaveBeenNthCalledWith(2, 5, 0);
  });

  it('ignores non-primary pointers', async () => {
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown', { isPrimary: false }));
    });

    expect(onMultiDragStart).not.toHaveBeenCalled();
  });

  it('rejects a concurrent session from another hook instance', async () => {
    const element = await renderHarness();

    // 두 번째 인스턴스 — 별도 루트에 렌더해 교차 인스턴스 소유권 검증
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const root2 = createRoot(host2);
    const onMultiDragStart2 = vi.fn();
    await act(async () => {
      root2.render(
        <Harness
          onClick={vi.fn()}
          onMovedCheck={vi.fn()}
          onMultiDragStart={onMultiDragStart2}
          onMultiDrag={vi.fn()}
          onMultiDragEnd={vi.fn()}
        />,
      );
    });
    const element2 = host2.querySelector<HTMLElement>(
      '[data-testid="selection-drag"]',
    )!;

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
      element2.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }));
      element.dispatchEvent(
        pointerEvent('pointermove', { pointerId: 1, clientX: 7 }),
      );
      flushRaf();
    });
    expect(onMultiDragStart).toHaveBeenCalledTimes(1);
    expect(onMultiDragStart2).not.toHaveBeenCalled();

    // 첫 세션이 끝나면 소유권이 풀려 다른 인스턴스가 시작 가능
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }));
      element2.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3 }));
      element2.dispatchEvent(
        pointerEvent('pointermove', { pointerId: 3, clientX: 7 }),
      );
      flushRaf();
    });
    expect(onMultiDragStart2).toHaveBeenCalledTimes(1);

    await act(async () => {
      element2.dispatchEvent(pointerEvent('pointerup', { pointerId: 3 }));
      root2.unmount();
    });
    host2.remove();
  });
});
