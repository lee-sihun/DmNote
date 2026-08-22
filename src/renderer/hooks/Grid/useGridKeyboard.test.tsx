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
import { registerPopupLayer } from '@components/main/Modal/popupLayer';

import type { CanonicalKeyPosition } from '@src/types/editor';

const {
  commitPatchMock,
  rotateSessionMock,
  sendBridgeMessageMock,
  recordedGenerates,
  groupSelectedElementsMock,
  ungroupSelectedElementsMock,
} = vi.hoisted(() => ({
  commitPatchMock: vi.fn().mockResolvedValue(undefined),
  rotateSessionMock: vi.fn(),
  sendBridgeMessageMock: vi.fn(),
  recordedGenerates: [] as Array<(base: unknown) => unknown>,
  groupSelectedElementsMock: vi.fn().mockResolvedValue(undefined),
  ungroupSelectedElementsMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@utils/grid/groupActions', () => ({
  groupSelectedElements: groupSelectedElementsMock,
  ungroupSelectedElements: ungroupSelectedElementsMock,
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: {
    commitPatch: commitPatchMock,
    getState: () => ({ lastAck: null }),
  },
}));

vi.mock('@src/renderer/editor/runtime/editorSemanticOps', () => ({
  // 게스처 버스트 검증 대상은 gestureId 운반 - 동기 recorder로 기록.
  // generate 클로저도 보관해 정산 의도가 어느 요소를 실었는지 검증 가능
  commitGeneratedSemanticOps: vi.fn(
    (
      generate: (base: unknown) => unknown,
      meta?: { gestureId?: string; onEnrolled?: () => void },
    ) => {
      meta?.onEnrolled?.();
      recordedGenerates.push(generate);
      commitPatchMock({ schemaVersion: 1 }, { gestureId: meta?.gestureId });
      return Promise.resolve({ document: null, opResults: [] });
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
  // 혼합 이동의 사전 staging이 실제 gestureTransaction을 타는 경로용 무상태 stub
  getStagedPluginInstancesGestureId: () => undefined,
  stagePluginInstancesGesture: vi.fn(),
  unstagePluginInstancesGesture: vi.fn(),
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

interface BlockingHarnessProps {
  move: () => void;
  remove: () => void;
  clear: () => void;
  copy: () => void;
  paste: () => void;
  forward: () => void;
  backward: () => void;
  continuousInputStrategy?: 'sync' | 'frame';
}

const BlockingHarness = ({
  move,
  remove,
  clear,
  copy,
  paste,
  forward,
  backward,
  continuousInputStrategy = 'sync',
}: BlockingHarnessProps) => {
  useGridKeyboard({
    selectedElements: [
      { type: 'key', id: STABLE_IDS[0], index: 0 },
      { type: 'key', id: STABLE_IDS[1], index: 1 },
    ],
    moveSelectedElements: move,
    deleteSelectedElements: remove,
    clearSelection: clear,
    copySelectedElements: copy,
    pasteElements: paste,
    onMoveForward: forward,
    onMoveBackward: backward,
    continuousInputStrategy,
  });
  return null;
};

describe('useGridKeyboard arrow history burst', () => {
  let host: HTMLDivElement;
  let root: Root;
  let randomUUIDMock: ReturnType<typeof vi.spyOn>;
  const layerCleanups: Array<() => void> = [];

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    commitPatchMock.mockClear();
    rotateSessionMock.mockClear();
    sendBridgeMessageMock.mockClear();
    recordedGenerates.length = 0;
    groupSelectedElementsMock.mockClear();
    ungroupSelectedElementsMock.mockClear();
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
    useGridSelectionStore.setState({ clipboard: [{} as never] });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () =>
      layerCleanups
        .splice(0)
        .reverse()
        .forEach((cleanup) => cleanup()),
    );
    await act(async () => root.unmount());
    useGridSelectionStore.setState({ clipboard: [] });
    host.remove();
    document
      .querySelectorAll('[data-dmn-modal-backdrop="true"]')
      .forEach((element) => element.remove());
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

  it('pending 중 선택이 바뀌어도 flush는 옛 대상 이동을 wire에 커밋한다', async () => {
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
    expect(commitPatchMock).not.toHaveBeenCalled();

    // flush 전에 선택이 A → B로 넘어간다 - cleanup flush가 옛 클로저로 실행
    await act(async () => {
      root.render(
        <Harness continuousInputStrategy="frame" selectedIndex={1} />,
      );
    });

    expect(commitPatchMock).toHaveBeenCalledOnce();
    expect(committedGestureIds()).toEqual([firstGestureId]);
    // 정산 커밋은 eager를 적용한 옛 대상(A)의 이동을 실어야 한다 -
    // 현재 선택(B)을 재독하면 A의 이동이 wire에 실리지 않아 소실된다
    const ops = recordedGenerates.at(-1)?.({
      schemaVersion: 1,
      keys: {},
      keyPositions: structuredClone(useKeyStore.getState().canonicalPositions),
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      layerGroups: {},
    });
    expect(ops).toEqual([
      {
        kind: 'setBounds',
        elementType: 'key',
        id: STABLE_IDS[0],
        bounds: { dx: 1, dy: 0, width: 40, height: 40 },
      },
    ]);
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

  it('활성 모달 동안 모든 배경 편집 키를 차단하고 종료 후 복원한다', async () => {
    const handlers = {
      move: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      forward: vi.fn(),
      backward: vi.fn(),
    };
    await act(async () => root.render(<BlockingHarness {...handlers} />));

    const modal = document.createElement('div');
    modal.dataset.dmnModalBackdrop = 'true';
    document.body.appendChild(modal);
    let unregister = () => {};
    await act(async () => {
      unregister = registerPopupLayer(modal);
      layerCleanups.push(unregister);
    });

    const press = (init: KeyboardEventInit) =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    press({ key: 'g', code: 'KeyG', ctrlKey: true });
    press({ key: 'g', code: 'KeyG', ctrlKey: true, shiftKey: true });
    press({ key: 'c', code: 'KeyC', ctrlKey: true });
    press({ key: 'v', code: 'KeyV', ctrlKey: true });
    press({ key: 'ArrowRight', code: 'ArrowRight' });
    press({ key: 'Backspace', code: 'Backspace' });
    press({ key: 'Escape', code: 'Escape' });
    press({ key: ']', code: 'BracketRight' });
    press({ key: '[', code: 'BracketLeft' });

    Object.values(handlers).forEach((handler) =>
      expect(handler).not.toHaveBeenCalled(),
    );
    expect(groupSelectedElementsMock).not.toHaveBeenCalled();
    expect(ungroupSelectedElementsMock).not.toHaveBeenCalled();

    await act(async () => unregister());
    press({ key: 'Backspace', code: 'Backspace' });
    expect(handlers.remove).toHaveBeenCalledOnce();
  });

  it('모달 직전에 예약된 방향키 프레임도 폐기한다', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(1, callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    const move = vi.fn();
    await act(async () =>
      root.render(
        <BlockingHarness
          move={move}
          remove={vi.fn()}
          clear={vi.fn()}
          copy={vi.fn()}
          paste={vi.fn()}
          forward={vi.fn()}
          backward={vi.fn()}
          continuousInputStrategy="frame"
        />,
      ),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(callbacks).toHaveLength(1);

    const modal = document.createElement('div');
    modal.dataset.dmnModalBackdrop = 'true';
    document.body.appendChild(modal);
    await act(async () => {
      layerCleanups.push(registerPopupLayer(modal));
    });
    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(performance.now());
    });

    expect(move).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
