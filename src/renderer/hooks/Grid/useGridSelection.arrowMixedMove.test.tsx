/**
 * 화살표 혼합 이동의 staging 순서 계약 테스트
 * - eager 쓰기 시점에 예약되는 debounce 커밋이 settle의 gesture 커밋보다
 *   먼저 착지하지 않도록, staging이 plugin 스토어 쓰기보다 선행하는지 고정
 * - settle이 mixed 커밋을 시작하지 못한 경로의 사전 staging 정산까지 검증
 */

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { CanonicalKeyPosition } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import { useGridSelection } from './useGridSelection';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  lastAck: null as unknown,
  runMixedGestureIntent: vi.fn((_options: unknown) =>
    Promise.resolve({ committed: true, satisfied: true }),
  ),
  runMixedDeleteIntent: vi.fn(() => Promise.resolve()),
  commitPatch: vi.fn(() => Promise.resolve()),
  deletePluginElements: vi.fn(),
  deleteLayerSelectionViaAuthority: vi.fn(() => Promise.resolve(true)),
  rotateSession: vi.fn(),
  beginMixedGesture: vi.fn(),
  cancelUncommittedMixedGesture: vi.fn(),
  commitMixedGesture: vi.fn(() => Promise.resolve()),
  sendBridgeMessage: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: {
    commitPatch: mocks.commitPatch,
    getState: () => ({ lastAck: mocks.lastAck }),
  },
}));

vi.mock('@src/renderer/editor/runtime/mixedElementIntent', () => ({
  applyPluginRemovalEagerly: (
    _fullIds: readonly string[],
    mutate: () => void,
  ) => {
    mutate();
    return null;
  },
  applyPluginAdditionEagerly: (
    _added: readonly string[],
    _z: unknown[],
    mutate: () => void,
  ) => {
    mutate();
    return null;
  },
  runMixedGestureElementIntent: (options: unknown) => {
    mocks.order.push('settle');
    return mocks.runMixedGestureIntent(options);
  },
  runMixedElementDeleteIntent: mocks.runMixedDeleteIntent,
}));

vi.mock('@plugins/runtime/displayElement/pluginElementActions', () => ({
  deletePluginElements: mocks.deletePluginElements,
  deleteLayerSelectionViaAuthority: mocks.deleteLayerSelectionViaAuthority,
}));

vi.mock('@plugins/runtime/pluginAuthorityGeneration', () => ({
  getPluginAuthorityGeneration: () => 7,
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: (...args: unknown[]) => {
    mocks.order.push('rotate');
    return mocks.rotateSession(...(args as [never]));
  },
}));

vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: (...args: unknown[]) => {
    mocks.order.push('stage');
    return mocks.beginMixedGesture(...(args as [never]));
  },
  cancelUncommittedMixedGestureTransaction: (...args: unknown[]) => {
    mocks.order.push('cancel');
    return mocks.cancelUncommittedMixedGesture(...(args as [never]));
  },
  commitMixedGestureTransaction: mocks.commitMixedGesture,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: mocks.sendBridgeMessage,
}));

const gestureId = '00000000-0000-4000-8000-0000000000a7';
const STABLE_KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keyPosition = {
  id: STABLE_KEY_ID,
  dx: 10,
  dy: 20,
  width: 60,
  height: 60,
} as CanonicalKeyPosition;
const pluginElement = (): PluginDisplayElementInternal => ({
  id: 'element',
  fullId: 'plugin-a:element',
  pluginId: 'plugin-a',
  html: '<div />',
  position: { x: 30, y: 40 },
  tabId: '4key',
});

type SelectionApi = ReturnType<typeof useGridSelection>;

interface HarnessProps {
  expose: (api: SelectionApi) => void;
}

const Harness = ({ expose }: HarnessProps) => {
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const api = useGridSelection({
    selectedElements,
    selectedKeyType: '4key',
    keyMappings: useKeyStore.getState().keyMappings,
    positions: useKeyStore.getState().canonicalPositions,
  });
  useEffect(() => expose(api), [api, expose]);
  return null;
};

describe('useGridSelection 화살표 혼합 이동 staging 순서', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: SelectionApi;
  let unsubscribeEagerWrite: () => void;
  let originalWindowType: typeof window.__dmn_window_type;

  beforeEach(async () => {
    originalWindowType = window.__dmn_window_type;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.order.length = 0;
    mocks.lastAck = null;
    mocks.runMixedGestureIntent.mockClear();
    mocks.runMixedDeleteIntent.mockClear();
    mocks.commitPatch.mockClear();
    mocks.deletePluginElements.mockClear();
    mocks.deleteLayerSelectionViaAuthority.mockClear();
    mocks.rotateSession.mockClear();
    mocks.beginMixedGesture.mockClear();
    mocks.cancelUncommittedMixedGesture.mockClear();
    mocks.commitMixedGesture.mockClear();
    mocks.sendBridgeMessage.mockClear();

    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['KeyA'] },
      positions: { '4key': [keyPosition] },
      canonicalPositions: { '4key': [keyPosition] },
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useLayerGroupStore.setState({ layerGroups: {} });
    usePluginDisplayElementStore.setState({ elements: [pluginElement()] });
    useGridSelectionStore.getState().clearSelection();
    window.__dmn_window_type = 'main';

    // plugin 스토어 eager 쓰기 시점 기록 (debounce 예약이 걸리는 지점)
    unsubscribeEagerWrite = usePluginDisplayElementStore.subscribe(
      (state, prevState) => {
        if (state.elements !== prevState.elements) {
          mocks.order.push('eagerWrite');
        }
      },
    );

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <Harness
          expose={(nextApi) => {
            api = nextApi;
          }}
        />,
      );
    });
  });

  afterEach(async () => {
    unsubscribeEagerWrite();
    await act(async () => root.unmount());
    host.remove();
    if (originalWindowType === undefined) delete window.__dmn_window_type;
    else window.__dmn_window_type = originalWindowType;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const selectMixed = async () => {
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: STABLE_KEY_ID, index: 0 },
        { type: 'plugin', id: 'plugin-a:element' },
      ]);
    });
  };

  it('혼합 이동은 staging이 plugin eager 쓰기보다 선행한다', async () => {
    await selectMixed();

    await act(async () => api.moveSelectedElements(5, 7, gestureId));

    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(gestureId, [
      'plugin-a',
    ]);
    const stageIndex = mocks.order.indexOf('stage');
    const eagerWriteIndex = mocks.order.indexOf('eagerWrite');
    const settleIndex = mocks.order.indexOf('settle');
    expect(stageIndex).toBeGreaterThanOrEqual(0);
    expect(eagerWriteIndex).toBeGreaterThan(stageIndex);
    expect(settleIndex).toBeGreaterThan(eagerWriteIndex);
    // 이동 자체는 그대로 적용
    expect(
      usePluginDisplayElementStore.getState().elements[0].position,
    ).toEqual({ x: 35, y: 47 });
  });

  it('settle의 mixed 커밋 시작 이후에만 미커밋 staging 정산을 요청한다', async () => {
    await selectMixed();

    await act(async () => api.moveSelectedElements(1, 0, gestureId));

    expect(mocks.runMixedGestureIntent).toHaveBeenCalledTimes(1);
    expect(mocks.cancelUncommittedMixedGesture).toHaveBeenCalledWith(gestureId);
    const settleIndex = mocks.order.indexOf('settle');
    const cancelIndex = mocks.order.indexOf('cancel');
    expect(cancelIndex).toBeGreaterThan(settleIndex);
  });

  it('settle이 mixed 커밋을 못 타면 사전 staging을 정산한다', async () => {
    // synthetic id는 wire 커밋이 스킵되는 선택
    const syntheticPosition = { ...keyPosition, id: 'key-0' };
    useKeyStore.setState({
      positions: { '4key': [syntheticPosition] },
      canonicalPositions: { '4key': [syntheticPosition] },
    });
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: 'key-0', index: 0 },
        { type: 'plugin', id: 'plugin-a:element' },
      ]);
    });

    await act(async () => api.moveSelectedElements(1, 0, gestureId));

    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(gestureId, [
      'plugin-a',
    ]);
    expect(mocks.runMixedGestureIntent).not.toHaveBeenCalled();
    expect(mocks.cancelUncommittedMixedGesture).toHaveBeenCalledWith(gestureId);
  });

  it('plugin 전용 이동은 staging 없이 기존 debounce 경로를 유지한다', async () => {
    await act(async () => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'plugin', id: 'plugin-a:element' }]);
    });

    await act(async () => api.moveSelectedElements(1, 0, gestureId));

    expect(mocks.beginMixedGesture).not.toHaveBeenCalled();
    expect(mocks.cancelUncommittedMixedGesture).not.toHaveBeenCalled();
    expect(mocks.rotateSession).toHaveBeenCalledWith('plugin-a', gestureId);
  });

  it('settle 없는 이동(syncToOverlay=false)은 staging하지 않는다', async () => {
    await selectMixed();

    await act(async () => api.moveSelectedElements(1, 0, gestureId, false));

    expect(mocks.beginMixedGesture).not.toHaveBeenCalled();
    expect(mocks.runMixedGestureIntent).not.toHaveBeenCalled();
    expect(mocks.cancelUncommittedMixedGesture).not.toHaveBeenCalled();
  });
});
