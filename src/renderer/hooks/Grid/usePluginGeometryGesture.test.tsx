/**
 * 플러그인 요소 기하 입력(X/Y/W/H) 게스처 세션 계약 테스트
 * - preview는 세션을 한 번만 열고(begin → stage) 스토어만 바꾼다
 * - commit/cancel은 Grid 드래그와 같은 순서로 닫는다 (end → unstage)
 * - cancel은 스냅샷(measuredSize 부재 포함)을 복원하고 멱등이다
 */

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import {
  createPluginGeometryGestureController,
  usePluginGeometryGesture,
  type PluginGeometryTarget,
} from './usePluginGeometryGesture';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  beginSession: vi.fn((_pluginId: string, gestureId: string) => gestureId),
  endSession: vi.fn(),
  flushSession: vi.fn(),
  beginMixedGesture: vi.fn(),
  cancelUncommittedMixedGesture: vi.fn(),
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  beginPluginInstancesEditSession: (...args: [string, string]) => {
    mocks.order.push('begin');
    return mocks.beginSession(...args);
  },
  endPluginInstancesEditSession: (...args: unknown[]) => {
    mocks.order.push('end');
    return mocks.endSession(...(args as [never]));
  },
  flushPluginInstancesEditSession: mocks.flushSession,
  rotatePluginInstancesEditSession: vi.fn(),
}));

vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: (...args: unknown[]) => {
    mocks.order.push('stage');
    return mocks.beginMixedGesture(...(args as [never]));
  },
  cancelUncommittedMixedGestureTransaction: (...args: unknown[]) => {
    mocks.order.push('unstage');
    return mocks.cancelUncommittedMixedGesture(...(args as [never]));
  },
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: vi.fn(),
}));

const PLUGIN_ID = 'plugin-a';
const FULL_ID = 'plugin-a:element';
const OTHER_FULL_ID = 'plugin-a:other';

const pluginElement = (
  overrides: Partial<PluginDisplayElementInternal> = {},
): PluginDisplayElementInternal => ({
  id: 'element',
  fullId: FULL_ID,
  pluginId: PLUGIN_ID,
  definitionId: PLUGIN_ID,
  html: '<div />',
  position: { x: 30, y: 40 },
  estimatedSize: { width: 200, height: 150 },
  tabId: '4key',
  ...overrides,
});

const target: PluginGeometryTarget = { fullId: FULL_ID, pluginId: PLUGIN_ID };

const findElement = (fullId: string) =>
  usePluginDisplayElementStore
    .getState()
    .elements.find((element) => element.fullId === fullId);

describe('createPluginGeometryGestureController', () => {
  let unsubscribeStore: () => void;

  beforeEach(() => {
    mocks.order.length = 0;
    mocks.beginSession.mockClear();
    mocks.endSession.mockClear();
    mocks.flushSession.mockClear();
    mocks.beginMixedGesture.mockClear();
    mocks.cancelUncommittedMixedGesture.mockClear();
    usePluginDisplayElementStore.setState({ elements: [pluginElement()] });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'plugin', id: FULL_ID }]);
    unsubscribeStore = usePluginDisplayElementStore.subscribe(() => {
      mocks.order.push('update');
    });
  });

  afterEach(() => {
    unsubscribeStore();
  });

  it('preview는 세션을 한 번만 열고 스토어만 갱신한다', () => {
    const gesture = createPluginGeometryGestureController();

    gesture.preview(target, 'x', 35);
    gesture.preview(target, 'x', 41);

    expect(mocks.order).toEqual(['begin', 'stage', 'update', 'update']);
    const gestureId = mocks.beginSession.mock.calls[0][1];
    expect(typeof gestureId).toBe('string');
    expect(mocks.beginSession).toHaveBeenCalledWith(PLUGIN_ID, gestureId);
    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(gestureId, [
      PLUGIN_ID,
    ]);
    expect(findElement(FULL_ID)?.position).toEqual({ x: 41, y: 40 });
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('commit은 마지막 값을 반영한 뒤 end → unstage 순서로 닫는다', () => {
    const gesture = createPluginGeometryGestureController();

    gesture.preview(target, 'y', 45);
    gesture.commit(target, 'y', 50);

    expect(mocks.order).toEqual([
      'begin',
      'stage',
      'update',
      'update',
      'end',
      'unstage',
    ]);
    const gestureId = mocks.beginSession.mock.calls[0][1];
    expect(mocks.endSession).toHaveBeenCalledWith(PLUGIN_ID, gestureId);
    expect(mocks.cancelUncommittedMixedGesture).toHaveBeenCalledWith(gestureId);
    expect(findElement(FULL_ID)?.position).toEqual({ x: 30, y: 50 });

    // 다음 preview는 새 게스처
    gesture.preview(target, 'y', 60);
    expect(mocks.beginSession).toHaveBeenCalledTimes(2);
    expect(mocks.beginSession.mock.calls[1][1]).not.toBe(gestureId);
  });

  it('preview 없이 온 commit도 세션을 열고 닫아 저장 한 번을 보장한다', () => {
    const gesture = createPluginGeometryGestureController();

    gesture.commit(target, 'width', 120);

    expect(mocks.order).toEqual(['begin', 'stage', 'update', 'end', 'unstage']);
    expect(findElement(FULL_ID)?.measuredSize).toEqual({
      width: 120,
      height: 150,
    });
  });

  it('cancel은 measuredSize 부재까지 스냅샷으로 복원한 뒤 세션을 닫는다', () => {
    const gesture = createPluginGeometryGestureController();

    gesture.preview(target, 'width', 120);
    gesture.preview(target, 'x', 99);
    expect(findElement(FULL_ID)?.measuredSize).toEqual({
      width: 120,
      height: 150,
    });
    mocks.order.length = 0;

    gesture.cancel();

    expect(mocks.order).toEqual(['update', 'end', 'unstage']);
    const restored = findElement(FULL_ID);
    expect(restored?.position).toEqual({ x: 30, y: 40 });
    expect(restored?.measuredSize).toBeUndefined();
  });

  it('cancel은 멱등이다 - 세션이 없으면 아무것도 건드리지 않는다', () => {
    const gesture = createPluginGeometryGestureController();

    gesture.cancel();
    gesture.preview(target, 'height', 80);
    gesture.cancel();
    mocks.order.length = 0;

    gesture.cancel();

    expect(mocks.order).toEqual([]);
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
  });

  it('선택에서 빠진 요소의 지각 preview는 세션을 열지 않는다', () => {
    const gesture = createPluginGeometryGestureController();
    useGridSelectionStore.getState().setSelectedElements([]);

    gesture.preview(target, 'x', 77);

    expect(mocks.order).toEqual([]);
    expect(findElement(FULL_ID)?.position).toEqual({ x: 30, y: 40 });
  });

  it('다른 요소로 preview가 오면 이전 세션을 취소 복원한 뒤 새로 연다', () => {
    const gesture = createPluginGeometryGestureController();
    usePluginDisplayElementStore.setState({
      elements: [
        pluginElement(),
        pluginElement({
          id: 'other',
          fullId: OTHER_FULL_ID,
          position: { x: 5, y: 6 },
        }),
      ],
    });
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'plugin', id: FULL_ID },
      { type: 'plugin', id: OTHER_FULL_ID },
    ]);
    gesture.preview(target, 'x', 99);
    mocks.order.length = 0;

    gesture.preview({ fullId: OTHER_FULL_ID, pluginId: PLUGIN_ID }, 'x', 15);

    expect(mocks.order).toEqual([
      'update',
      'end',
      'unstage',
      'begin',
      'stage',
      'update',
    ]);
    expect(findElement(FULL_ID)?.position).toEqual({ x: 30, y: 40 });
    expect(findElement(OTHER_FULL_ID)?.position).toEqual({ x: 15, y: 6 });
  });
});

describe('usePluginGeometryGesture', () => {
  let host: HTMLDivElement;
  let root: Root;

  interface HarnessProps {
    target: PluginGeometryTarget | null;
    expose: (api: ReturnType<typeof usePluginGeometryGesture>) => void;
  }

  const Harness = ({ target, expose }: HarnessProps) => {
    const api = usePluginGeometryGesture(target);
    useEffect(() => expose(api));
    return null;
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.order.length = 0;
    mocks.beginSession.mockClear();
    mocks.endSession.mockClear();
    mocks.beginMixedGesture.mockClear();
    mocks.cancelUncommittedMixedGesture.mockClear();
    usePluginDisplayElementStore.setState({
      elements: [
        pluginElement(),
        pluginElement({
          id: 'other',
          fullId: OTHER_FULL_ID,
          position: { x: 5, y: 6 },
        }),
      ],
    });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'plugin', id: FULL_ID }]);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('대상이 바뀌면 열려 있던 세션을 취소 복원한다', () => {
    let api: ReturnType<typeof usePluginGeometryGesture> | null = null;
    const expose = (next: typeof api) => {
      api = next;
    };
    act(() => {
      root.render(<Harness target={target} expose={expose} />);
    });
    act(() => {
      api?.preview('x', 88);
    });
    expect(findElement(FULL_ID)?.position.x).toBe(88);

    act(() => {
      root.render(
        <Harness
          target={{ fullId: OTHER_FULL_ID, pluginId: PLUGIN_ID }}
          expose={expose}
        />,
      );
    });

    expect(findElement(FULL_ID)?.position).toEqual({ x: 30, y: 40 });
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.cancelUncommittedMixedGesture).toHaveBeenCalledTimes(1);
  });

  it('언마운트되면 열려 있던 세션을 취소 복원한다', () => {
    let api: ReturnType<typeof usePluginGeometryGesture> | null = null;
    const expose = (next: typeof api) => {
      api = next;
    };
    act(() => {
      root.render(<Harness target={target} expose={expose} />);
    });
    act(() => {
      api?.preview('width', 300);
    });
    expect(findElement(FULL_ID)?.measuredSize?.width).toBe(300);

    act(() => root.unmount());
    root = createRoot(host);

    expect(findElement(FULL_ID)?.measuredSize).toBeUndefined();
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
  });

  it('대상이 없으면 preview·commit은 무시된다', () => {
    let api: ReturnType<typeof usePluginGeometryGesture> | null = null;
    const expose = (next: typeof api) => {
      api = next;
    };
    act(() => {
      root.render(<Harness target={null} expose={expose} />);
    });
    act(() => {
      api?.preview('x', 1);
      api?.commit('x', 2);
    });

    expect(mocks.beginSession).not.toHaveBeenCalled();
    expect(findElement(FULL_ID)?.position).toEqual({ x: 30, y: 40 });
  });
});
