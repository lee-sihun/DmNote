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
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  acquireHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/historyEditorFlushLock';
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
  enabled?: boolean;
  zoom?: number;
  startX?: number;
  startY?: number;
  onClick: () => void;
  onMovedCheck: (moved: boolean) => void;
  onPressMovedCheck?: (moved: boolean) => void;
  onMultiDragStart: () => void | (() => void);
  onMultiDrag: (dx: number, dy: number) => void;
  onMultiDragEnd: () => void;
}

const Harness = ({
  enabled = true,
  zoom = 1,
  startX = 0,
  startY = 0,
  onClick,
  onMovedCheck,
  onPressMovedCheck,
  onMultiDragStart,
  onMultiDrag,
  onMultiDragEnd,
}: HarnessProps) => {
  const { handlePointerDown, movedDuringPressRef, pressMovedRef } =
    useSelectionDrag({
      enabled,
      zoom,
      startX,
      startY,
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
      // 프로덕션 미러: 선택 드래그 핸들러는 enabled 조건일 때만 부착된다
      onPointerDown={enabled ? handlePointerDown : undefined}
      onClick={() => {
        onPressMovedCheck?.(pressMovedRef.current);
        onClick();
      }}
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

  const renderHarness = async (
    props: Partial<
      Pick<
        HarnessProps,
        'enabled' | 'zoom' | 'startX' | 'startY' | 'onPressMovedCheck'
      >
    > = {},
  ) => {
    await act(async () => {
      root.render(
        <Harness
          onClick={onClick}
          onMovedCheck={onMovedCheck}
          onMultiDragStart={onMultiDragStart}
          onMultiDrag={onMultiDrag}
          onMultiDragEnd={onMultiDragEnd}
          {...props}
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
    resetHistoryEditorFlushLock();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    resetHistoryEditorFlushLock();
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('임계값 이하 이동은 드래그를 발동하지 않는다', async () => {
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 3 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 3 }));
    });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onMultiDragStart).not.toHaveBeenCalled();
    expect(onMultiDrag).not.toHaveBeenCalled();
    expect(onMultiDragEnd).not.toHaveBeenCalled();
    expect(onMovedCheck).toHaveBeenCalledWith(false);
  });

  it.each([
    { painted: false, boundary: 'applied' },
    { painted: true, boundary: 'applied' },
    { painted: false, boundary: 'locked' },
    { painted: true, boundary: 'locked' },
  ])(
    'history $boundary, 프레임 처리 $painted 뒤 선택 드래그는 저장하지 않는다',
    async ({ painted, boundary }) => {
      const finish = vi.fn();
      onMultiDragStart.mockReturnValue(finish);
      const element = await renderHarness();
      await act(async () => {
        element.dispatchEvent(pointerEvent('pointerdown'));
        element.dispatchEvent(pointerEvent('pointermove', { clientX: 20 }));
        if (painted) flushRaf();
        if (boundary === 'applied')
          useCommittedApplyStore.getState().bump('historyRedo');
        else acquireHistoryEditorFlushLock('selection-release');
        element.dispatchEvent(pointerEvent('pointerup', { clientX: 20 }));
        expect(onMultiDragEnd).not.toHaveBeenCalled();
        if (boundary === 'locked')
          useCommittedApplyStore.getState().bump('historyRedo');
        flushRaf();
      });
      expect(onMultiDrag).toHaveBeenCalledTimes(painted ? 1 : 0);
      expect(onMultiDragEnd).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledTimes(painted ? 1 : 0);
      if (painted) expect(finish).toHaveBeenCalledWith(false);
      expect(element.hasPointerCapture(1)).toBe(false);
      expect(document.body.classList.contains('dmn-dragging')).toBe(false);
      expect(rafCallbacks.size).toBe(0);
    },
  );

  it('임계 돌파 후 시작 좌표 기준 스냅 delta로 이동한다', async () => {
    const element = await renderHarness();

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 7 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 7 }));
    });
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onMultiDragStart).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledWith(5, 0);
    expect(onMultiDragEnd).toHaveBeenCalledTimes(1);
    expect(onMovedCheck).toHaveBeenCalledWith(true);
  });

  it('축소 배율에서도 개별 드래그와 같은 화면 기준 스냅을 적용한다', async () => {
    const element = await renderHarness({ zoom: 0.5 });

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 7 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 7 }));
    });

    expect(onMultiDrag).toHaveBeenCalledOnce();
    expect(onMultiDrag).toHaveBeenCalledWith(10, 0);
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
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(true);
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
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('드래그 도중 enabled가 꺼지면 세션을 종료하고 이후 이동을 무시한다', async () => {
    let element = await renderHarness({ enabled: true });

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 8 }));
      flushRaf();
    });
    expect(onMultiDragStart).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledTimes(1);

    // 릴리즈 전 선택 해제 (Escape) - 진행 중 세션이 즉시 끝나야 한다
    element = await renderHarness({ enabled: false });
    expect(onMultiDragEnd).toHaveBeenCalledTimes(1);

    // 리스너 제거로 이후 pointermove가 빈 선택에 onMultiDrag를 발화하지 않는다
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 40 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 40 }));
    });
    expect(onMultiDrag).toHaveBeenCalledTimes(1);
    expect(onMultiDragEnd).toHaveBeenCalledTimes(1);

    // 세션 소유권이 풀려 재활성화 후 새 드래그가 정상 시작된다
    element = await renderHarness({ enabled: true });
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 8 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 8 }));
    });
    expect(onMultiDragStart).toHaveBeenCalledTimes(2);
    expect(onMultiDragEnd).toHaveBeenCalledTimes(2);
  });

  it('off-grid 시작 좌표에서 임계값 미만 이동은 무이동·무표식이다', async () => {
    const pressMovedChecks: boolean[] = [];
    const element = await renderHarness({
      startX: 3,
      onPressMovedCheck: (moved) => pressMovedChecks.push(moved),
    });

    // 4px 손떨림 - 임계 미만이라 스냅 점프도 표식도 없어야 한다
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 4 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 4 }));
    });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onMultiDragStart).not.toHaveBeenCalled();
    expect(onMultiDrag).not.toHaveBeenCalled();
    expect(onMultiDragEnd).not.toHaveBeenCalled();
    expect(pressMovedChecks).toEqual([false]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('off-grid 시작 좌표에서 임계값 초과 이동은 발동한다', async () => {
    const pressMovedChecks: boolean[] = [];
    const element = await renderHarness({
      startX: 3,
      onPressMovedCheck: (moved) => pressMovedChecks.push(moved),
    });

    // 6px 이동 - 임계 돌파, newX 9가 10으로 스냅되어 delta 7
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 6 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 6 }));
    });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onMultiDragStart).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledTimes(1);
    expect(onMultiDrag).toHaveBeenCalledWith(7, 0);
    expect(onMultiDragEnd).toHaveBeenCalledTimes(1);
    expect(pressMovedChecks).toEqual([true]);
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
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 6 }));
      flushRaf();
    });
    const firstFrameBounds = vi
      .mocked(calculateGroupBounds)
      .mock.calls.at(-1)?.[0];
    expect(
      firstFrameBounds?.find((bounds) => bounds.id === 'plugin-b')?.left,
    ).toBe(206);

    await act(async () => {
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 11 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 11 }));
    });
    const secondFrameBounds = vi
      .mocked(calculateGroupBounds)
      .mock.calls.at(-1)?.[0];
    expect(
      secondFrameBounds?.find((bounds) => bounds.id === 'plugin-b')?.left,
    ).toBe(211);
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

describe('pressMovedRef 클릭 가드 계약', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

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

  it('드래그 press의 trailing click에서 참, 다음 일반 press에서 거짓', async () => {
    const pressMovedChecks: boolean[] = [];
    await act(async () => {
      root.render(
        <Harness
          onClick={() => {}}
          onMovedCheck={() => {}}
          onPressMovedCheck={(moved) => pressMovedChecks.push(moved)}
          onMultiDragStart={() => {}}
          onMultiDrag={() => {}}
          onMultiDragEnd={() => {}}
        />,
      );
    });
    const element = host.querySelector<HTMLElement>(
      '[data-testid="selection-drag"]',
    )!;

    // 드래그로 끝난 press - click 시점에 참이어야 가드가 삼킬 수 있다
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 8 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 8 }));
    });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // 이동 없는 다음 press - 거짓이어야 정상 클릭이 통과한다
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointerup'));
    });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(pressMovedChecks).toEqual([true, false]);
  });

  it('드래그 후 enabled가 꺼져도 다음 press가 표식을 소비한다', async () => {
    const pressMovedChecks: boolean[] = [];
    const renderWith = async (enabled: boolean) => {
      await act(async () => {
        root.render(
          <Harness
            enabled={enabled}
            onClick={() => {}}
            onMovedCheck={() => {}}
            onPressMovedCheck={(moved) => pressMovedChecks.push(moved)}
            onMultiDragStart={() => {}}
            onMultiDrag={() => {}}
            onMultiDragEnd={() => {}}
          />,
        );
      });
      return host.querySelector<HTMLElement>('[data-testid="selection-drag"]')!;
    };

    // 선택 모드에서 드래그 - 실이동 표식이 참으로 남는다
    let element = await renderWith(true);
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 8 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 8 }));
    });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // 선택 해제(enabled=false)로 핸들러가 떨어진 뒤의 일반 클릭 - press가
    // 훅을 거치지 않아도 비활성화 청소가 표식을 지워 클릭이 삼켜지지
    // 않아야 한다 (선택 씹힘 회귀)
    element = await renderWith(false);
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointerup'));
    });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(pressMovedChecks).toEqual([true, false]);
  });

  it('드래그 도중 enabled가 꺼지면 이후 pointermove가 표식을 재오염하지 않는다', async () => {
    const pressMovedChecks: boolean[] = [];
    const movedChecks: boolean[] = [];
    const renderWith = async (enabled: boolean) => {
      await act(async () => {
        root.render(
          <Harness
            enabled={enabled}
            onClick={() => {}}
            onMovedCheck={(moved) => movedChecks.push(moved)}
            onPressMovedCheck={(moved) => pressMovedChecks.push(moved)}
            onMultiDragStart={() => {}}
            onMultiDrag={() => {}}
            onMultiDragEnd={() => {}}
          />,
        );
      });
      return host.querySelector<HTMLElement>('[data-testid="selection-drag"]')!;
    };

    // 선택 모드 드래그 진행 중 (릴리즈 전) 표식이 참으로 오염된 상태
    let element = await renderWith(true);
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 8 }));
      flushRaf();
    });

    // 릴리즈 없이 선택 해제 - 청소가 세션과 표식을 함께 정리해야 한다
    element = await renderWith(false);

    // 리스너가 살아 있었다면 이 이동이 lastPressMovedRef를 재오염시킨다
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointermove', { clientX: 40 }));
      flushRaf();
      element.dispatchEvent(pointerEvent('pointerup', { clientX: 40 }));
    });

    // enabled=false라 press가 훅을 거치지 않아도 클릭이 삼켜지지 않는다
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('pointerup'));
    });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(pressMovedChecks).toEqual([false]);
    // movedDuringPressRef도 함께 청소되어 더블클릭 편집 진입이 막히지 않는다
    expect(movedChecks).toEqual([false]);
  });
});
