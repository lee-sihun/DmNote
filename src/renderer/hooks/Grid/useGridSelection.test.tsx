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
import type { KeyPosition } from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import { useGridSelection } from './useGridSelection';

const mocks = vi.hoisted(() => ({
  commitPatch: vi.fn((_patch: unknown, _options?: { gestureId?: string }) =>
    Promise.resolve(),
  ),
  deletePluginElements: vi.fn(),
  rotateSession: vi.fn(),
  beginMixedGesture: vi.fn(),
  cancelUncommittedMixedGesture: vi.fn(),
  commitMixedGesture: vi.fn(() => Promise.resolve()),
  sendBridgeMessage: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch: mocks.commitPatch },
}));

vi.mock('@plugins/rpc/pluginElementActions', () => ({
  deletePluginElements: mocks.deletePluginElements,
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: mocks.rotateSession,
}));

vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: mocks.beginMixedGesture,
  cancelUncommittedMixedGestureTransaction: mocks.cancelUncommittedMixedGesture,
  commitMixedGestureTransaction: mocks.commitMixedGesture,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: mocks.sendBridgeMessage,
}));

const gestureId = '00000000-0000-4000-8000-0000000000f4';
const keyPosition = {
  dx: 10,
  dy: 20,
  width: 60,
  height: 60,
} as KeyPosition;
const pluginElement = (): PluginDisplayElementInternal => ({
  id: 'element',
  fullId: 'plugin-a:element',
  pluginId: 'plugin-a',
  html: '<div />',
  position: { x: 30, y: 40 },
  tabId: '4key',
});
const pluginClipboardElement = () => {
  const { fullId: _fullId, ...element } = pluginElement();
  return element;
};

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

describe('useGridSelection compound history gesture', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: SelectionApi;
  let randomUUID: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.commitPatch.mockClear();
    mocks.deletePluginElements.mockClear();
    mocks.rotateSession.mockClear();
    mocks.beginMixedGesture.mockClear();
    mocks.cancelUncommittedMixedGesture.mockClear();
    mocks.commitMixedGesture.mockClear();
    mocks.sendBridgeMessage.mockClear();
    randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue(gestureId);

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
    await act(async () => root.unmount());
    host.remove();
    randomUUID.mockRestore();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('혼합 삭제는 editor와 plugin에 같은 gestureId를 전달한다', async () => {
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: 'key-0', index: 0 },
        { type: 'plugin', id: 'plugin-a:element' },
      ]);
    });

    await act(async () => api.deleteSelectedElements());

    expect(mocks.deletePluginElements).toHaveBeenCalledWith(
      ['plugin-a:element'],
      gestureId,
    );
    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(gestureId, [
      'plugin-a',
    ]);
    expect(mocks.commitMixedGesture).toHaveBeenCalledWith(
      gestureId,
      expect.objectContaining({ schemaVersion: 1 }),
      ['plugin-a'],
    );
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('혼합 삭제 중 동기 예외가 나도 staged transaction을 정산한다', async () => {
    const error = new Error('delete projection failed');
    mocks.deletePluginElements.mockImplementationOnce(() => {
      throw error;
    });
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: 'key-0', index: 0 },
        { type: 'plugin', id: 'plugin-a:element' },
      ]);
    });

    let caught: unknown;
    await act(async () => {
      try {
        await api.deleteSelectedElements();
      } catch (nextError) {
        caught = nextError;
      }
    });

    expect(caught).toBe(error);
    expect(mocks.cancelUncommittedMixedGesture).toHaveBeenCalledWith(gestureId);
  });

  it('혼합 붙여넣기는 editor와 plugin에 같은 gestureId를 전달한다', async () => {
    act(() => {
      useGridSelectionStore.getState().setClipboard([
        { type: 'key', keyCode: 'KeyB', position: keyPosition },
        {
          type: 'plugin',
          element: pluginClipboardElement(),
        },
      ]);
    });

    await act(async () => api.pasteElements());

    expect(mocks.rotateSession).toHaveBeenCalledWith('plugin-a', gestureId);
    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(gestureId, [
      'plugin-a',
    ]);
    expect(mocks.commitMixedGesture).toHaveBeenCalledWith(
      gestureId,
      expect.objectContaining({ schemaVersion: 1 }),
      ['plugin-a'],
    );
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('혼합 붙여넣기 중 동기 예외가 나도 staged transaction을 정산한다', async () => {
    act(() => {
      useGridSelectionStore.getState().setClipboard([
        { type: 'key', keyCode: 'KeyB', position: keyPosition },
        {
          type: 'plugin',
          element: pluginClipboardElement(),
        },
      ]);
    });
    const error = new Error('paste projection failed');
    const pluginStore = usePluginDisplayElementStore.getState();
    const setElements = vi
      .spyOn(pluginStore, 'setElements')
      .mockImplementationOnce(() => {
        throw error;
      });

    let caught: unknown;
    await act(async () => {
      try {
        await api.pasteElements();
      } catch (nextError) {
        caught = nextError;
      }
    });
    setElements.mockRestore();

    expect(caught).toBe(error);
    expect(mocks.cancelUncommittedMixedGesture).toHaveBeenCalledWith(gestureId);
  });

  it('resize 종료 callback은 전달받은 gestureId로 editor를 저장한다', () => {
    api.syncSelectedElementsToOverlay(gestureId);

    expect(mocks.commitPatch).toHaveBeenCalledTimes(1);
    expect(mocks.commitPatch.mock.calls[0]?.[1]).toEqual({ gestureId });
  });
});
