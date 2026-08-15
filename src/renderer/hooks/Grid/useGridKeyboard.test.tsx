import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

import { useGridKeyboard } from './useGridKeyboard';
import { useGridSelection } from './useGridSelection';

import type { CanonicalKeyPosition } from '@src/types/editor';

const { commitPatchMock, rotateSessionMock, sendBridgeMessageMock } =
  vi.hoisted(() => ({
    commitPatchMock: vi.fn().mockResolvedValue(undefined),
    rotateSessionMock: vi.fn(),
    sendBridgeMessageMock: vi.fn(),
  }));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: {
    commitPatch: commitPatchMock,
    // 안정 id 기하 정산은 generator 경로 - gestureId 기록만 동일 recorder로
    commitGeneratedPatch: vi.fn(
      (
        _generate: unknown,
        meta?: { gestureId?: string; onEnrolled?: () => void },
      ) => {
        meta?.onEnrolled?.();
        commitPatchMock({ schemaVersion: 1 }, { gestureId: meta?.gestureId });
        return Promise.resolve({});
      },
    ),
    getState: () => ({ lastAck: null }),
  },
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  // 게스처 버스트 검증 대상은 gestureId 운반 - 동기 recorder로 기록
  commitSelectedGeometryByIds: vi.fn(
    (targets: unknown[], gestureId?: string) => {
      commitPatchMock({ schemaVersion: 1 }, { gestureId });
      return Promise.resolve(targets.length);
    },
  ),
}));

vi.mock('@src/renderer/editor/runtime/mixedElementIntent', () => ({
  runMixedGestureElementIntent: vi.fn((options: { gestureId: string }) => {
    commitPatchMock({ schemaVersion: 1 }, { gestureId: options.gestureId });
    return Promise.resolve({ committed: true, satisfied: true });
  }),
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: sendBridgeMessageMock,
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: rotateSessionMock,
}));

vi.mock('@utils/core/platform', () => ({ isMac: () => false }));

const firstGestureId = '00000000-0000-4000-8000-000000000001';
const secondGestureId = '00000000-0000-4000-8000-000000000002';

const STABLE_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];

const position = (index = 0): CanonicalKeyPosition =>
  ({
    id: STABLE_IDS[index],
    dx: 0,
    dy: 0,
    width: 40,
    height: 40,
  } as CanonicalKeyPosition);

interface HarnessProps {
  includePlugin?: boolean;
  selectedIndex?: number;
  locatorIndex?: number;
  continuousInputStrategy?: 'sync' | 'frame';
}

const Harness = ({
  includePlugin = false,
  selectedIndex = 0,
  locatorIndex = selectedIndex,
  continuousInputStrategy = 'sync',
}: HarnessProps) => {
  const selectedElements: SelectedElement[] = [
    {
      type: 'key' as const,
      id: STABLE_IDS[selectedIndex],
      index: locatorIndex,
    },
    ...(includePlugin
      ? [{ type: 'plugin' as const, id: 'plugin-a:element' }]
      : []),
  ];
  // 정산 라우팅은 선택 스토어를 읽는다 - 하네스 선택과 동기화
  useGridSelectionStore.setState({ selectedElements });
  const { moveSelectedElements } = useGridSelection({
    selectedElements,
    selectedKeyType: '4key',
    keyMappings: { '4key': ['KeyA', 'KeyB'] },
    positions: { '4key': [position(0), position(1)] },
  });

  useGridKeyboard({
    selectedElements,
    moveSelectedElements,
    deleteSelectedElements: vi.fn(),
    clearSelection: vi.fn(),
    copySelectedElements: vi.fn(),
    pasteElements: vi.fn(),
    continuousInputStrategy,
  });

  return null;
};

describe('useGridKeyboard arrow history burst', () => {
  let host: HTMLDivElement;
  let root: Root;
  let randomUUIDMock: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    commitPatchMock.mockClear();
    rotateSessionMock.mockClear();
    sendBridgeMessageMock.mockClear();
    randomUUIDMock = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(firstGestureId)
      .mockReturnValueOnce(secondGestureId);

    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['KeyA', 'KeyB'] },
      positions: { '4key': [position(0), position(1)] },
      canonicalPositions: { '4key': [position(0), position(1)] },
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    usePluginDisplayElementStore.setState({ elements: [] });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    randomUUIDMock.mockRestore();
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const pressArrow = (key: string) => {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  };

  const committedGestureIds = () =>
    commitPatchMock.mock.calls.map((call) => call[1]?.gestureId);

  it('500ms 안의 연속 이동을 같은 history gesture로 묶는다', () => {
    pressArrow('ArrowRight');
    vi.advanceTimersByTime(500);
    pressArrow('ArrowRight');

    expect(committedGestureIds()).toEqual([firstGestureId, firstGestureId]);
    expect(randomUUIDMock).toHaveBeenCalledOnce();
  });

  it('500ms를 넘긴 이동은 새 history gesture로 분리한다', () => {
    pressArrow('ArrowRight');
    vi.advanceTimersByTime(501);
    pressArrow('ArrowRight');

    expect(committedGestureIds()).toEqual([firstGestureId, secondGestureId]);
    expect(randomUUIDMock).toHaveBeenCalledTimes(2);
  });

  it('방향이 섞여도 500ms burst 안에서는 같은 gesture를 사용한다', () => {
    pressArrow('ArrowLeft');
    vi.advanceTimersByTime(100);
    pressArrow('ArrowUp');
    vi.advanceTimersByTime(100);
    pressArrow('ArrowDown');

    expect(committedGestureIds()).toEqual([
      firstGestureId,
      firstGestureId,
      firstGestureId,
    ]);
    expect(randomUUIDMock).toHaveBeenCalledOnce();
  });

  it('500ms 안이어도 선택 대상이 바뀌면 새 history gesture를 사용한다', async () => {
    pressArrow('ArrowRight');
    vi.advanceTimersByTime(100);
    await act(async () => {
      root.render(<Harness selectedIndex={1} />);
    });
    pressArrow('ArrowRight');

    expect(committedGestureIds()).toEqual([firstGestureId, secondGestureId]);
    expect(randomUUIDMock).toHaveBeenCalledTimes(2);
  });

  it('같은 ID의 locator index만 바뀌면 기존 gesture를 유지한다', async () => {
    pressArrow('ArrowRight');
    vi.advanceTimersByTime(100);
    await act(async () => {
      root.render(<Harness locatorIndex={1} />);
    });
    pressArrow('ArrowRight');

    expect(committedGestureIds()).toEqual([firstGestureId, firstGestureId]);
    expect(randomUUIDMock).toHaveBeenCalledOnce();
  });

  it('혼합 선택 방향키 이동은 editor와 plugin에 같은 gesture를 전달한다', async () => {
    usePluginDisplayElementStore.setState({
      elements: [
        {
          id: 'element',
          fullId: 'plugin-a:element',
          pluginId: 'plugin-a',
          html: '<div />',
          position: { x: 0, y: 0 },
        },
      ],
    });
    await act(async () => {
      root.render(<Harness includePlugin />);
    });

    pressArrow('ArrowRight');

    expect(committedGestureIds()).toEqual([firstGestureId]);
    expect(rotateSessionMock).toHaveBeenCalledWith('plugin-a', firstGestureId);
  });

  it('같은 프레임의 방향키 burst를 누적해 한 번만 이동한다', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    await act(async () => {
      root.render(<Harness continuousInputStrategy="frame" />);
    });

    pressArrow('ArrowRight');
    pressArrow('ArrowRight');
    pressArrow('ArrowDown');
    expect(commitPatchMock).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);

    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(performance.now());
    });
    expect(commitPatchMock).toHaveBeenCalledOnce();
    expect(useKeyStore.getState().positions['4key']?.[0]).toMatchObject({
      dx: 2,
      dy: 1,
    });
    vi.unstubAllGlobals();
  });

  it('방향키를 떼면 대기 이동을 프레임 전에 flush한다', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(1, callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    await act(async () => {
      root.render(<Harness continuousInputStrategy="frame" />);
    });

    pressArrow('ArrowLeft');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
    });
    expect(commitPatchMock).toHaveBeenCalledOnce();
    expect(callbacks).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
