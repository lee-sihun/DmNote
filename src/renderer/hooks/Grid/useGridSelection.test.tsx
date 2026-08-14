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
import { deleteFrozenSelection } from '@src/renderer/editor/runtime/deleteFrozenSelection';

const mocks = vi.hoisted(() => ({
  commitGeometry: vi.fn(() => Promise.resolve(1)),
  runMixedIntent: vi.fn(() => Promise.resolve()),
  pluginAdditionThrows: false,
  commitGeneratedPatch: vi.fn(
    (
      _generate: (base: unknown) => unknown,
      meta?: { onEnrolled?: () => void },
    ) => {
      meta?.onEnrolled?.();
      return Promise.resolve({});
    },
  ),
  runMixedGestureIntent: vi.fn(() =>
    Promise.resolve({ committed: true, satisfied: true }),
  ),
  runMixedDeleteIntent: vi.fn(
    (_options?: { receipt?: { rollback: () => void } | null }) =>
      Promise.resolve(),
  ),
  commitPatch: vi.fn((_patch: unknown, _options?: { gestureId?: string }) =>
    Promise.resolve(),
  ),
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
    commitGeneratedPatch: mocks.commitGeneratedPatch,
    getState: () => ({ lastAck: null }),
  },
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  commitSelectedGeometryByIds: mocks.commitGeometry,
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
    if (mocks.pluginAdditionThrows) {
      throw new Error('plugin eager failed');
    }
    mutate();
    return null;
  },
  applySealedMixedMutation: (options: { mutate: () => void }) => {
    options.mutate();
    return { rollback: vi.fn() };
  },
  runMixedElementIntent: mocks.runMixedIntent,
  runMixedGestureElementIntent: mocks.runMixedGestureIntent,
  runMixedElementDeleteIntent: mocks.runMixedDeleteIntent,
}));

vi.mock('@plugins/rpc/pluginElementActions', () => ({
  deletePluginElements: mocks.deletePluginElements,
  deleteLayerSelectionViaAuthority: mocks.deleteLayerSelectionViaAuthority,
}));

vi.mock('@plugins/rpc/pluginRpcClient', () => ({
  getPluginAuthorityGeneration: () => 7,
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
  let originalWindowType: typeof window.__dmn_window_type;

  beforeEach(async () => {
    originalWindowType = window.__dmn_window_type;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.commitPatch.mockClear();
    mocks.commitGeometry.mockClear();
    mocks.runMixedIntent.mockClear();
    mocks.commitGeneratedPatch.mockClear();
    mocks.pluginAdditionThrows = false;
    mocks.runMixedGestureIntent.mockClear();
    mocks.runMixedDeleteIntent.mockClear();
    mocks.deletePluginElements.mockClear();
    mocks.deleteLayerSelectionViaAuthority.mockClear();
    mocks.deleteLayerSelectionViaAuthority.mockResolvedValue(true);
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
    window.__dmn_window_type = 'main';

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
    if (originalWindowType === undefined) delete window.__dmn_window_type;
    else window.__dmn_window_type = originalWindowType;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('혼합 삭제는 editor와 plugin에 같은 gestureId를 전달한다', async () => {
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: STABLE_KEY_ID, index: 0 },
        { type: 'plugin', id: 'plugin-a:element' },
      ]);
    });

    await act(async () => api.deleteSelectedElements());

    expect(mocks.deletePluginElements).toHaveBeenCalledWith(
      ['plugin-a:element'],
      gestureId,
    );
    // wire는 슬롯 정합 mixed intent - full-record 커밋 금지
    expect(mocks.runMixedDeleteIntent).toHaveBeenCalledTimes(1);
    const intentOptions = (
      mocks.runMixedDeleteIntent.mock.calls[0] as unknown[]
    )[0] as {
      gestureId: string;
      pluginIds: readonly string[];
      deletedPluginFullIds: readonly string[];
      ops: readonly unknown[];
    };
    expect(intentOptions.gestureId).toBe(gestureId);
    expect(intentOptions.pluginIds).toEqual(['plugin-a']);
    expect(intentOptions.deletedPluginFullIds).toEqual(['plugin-a:element']);
    expect(intentOptions.ops).toEqual([
      {
        kind: 'deleteElement',
        elementType: 'key',
        id: STABLE_KEY_ID,
      },
    ]);
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('분리 패널 삭제는 stable descriptor만 main authority에 위임한다', async () => {
    window.__dmn_window_type = 'panel';
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: STABLE_KEY_ID, index: 0 },
        { type: 'plugin', id: 'plugin-a:element' },
      ]);
    });

    await act(async () => api.deleteSelectedElements());

    expect(mocks.deleteLayerSelectionViaAuthority).toHaveBeenCalledWith([
      { elementType: 'key', id: STABLE_KEY_ID },
      { elementType: 'plugin', id: 'plugin-a:element' },
    ]);
    expect(mocks.runMixedDeleteIntent).not.toHaveBeenCalled();
    expect(mocks.deletePluginElements).not.toHaveBeenCalled();
    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
  });

  it('분리 패널의 synthetic 선택은 삭제를 main에 보내지 않는다', async () => {
    window.__dmn_window_type = 'panel';
    await act(async () => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    });

    await act(async () => api.deleteSelectedElements());

    expect(mocks.deleteLayerSelectionViaAuthority).not.toHaveBeenCalled();
    expect(mocks.runMixedDeleteIntent).not.toHaveBeenCalled();
    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: 'key-0', index: 0 },
    ]);
  });

  it('main의 synthetic native 선택도 로컬과 wire 삭제를 모두 중단한다', async () => {
    await act(async () => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    });

    await act(async () => api.deleteSelectedElements());

    expect(mocks.runMixedDeleteIntent).not.toHaveBeenCalled();
    expect(mocks.runMixedGestureIntent).not.toHaveBeenCalled();
    expect(mocks.deletePluginElements).not.toHaveBeenCalled();
    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: 'key-0', index: 0 },
    ]);
  });

  it('stable 삭제 실패 복원은 main의 무관한 현재 mode 변경과 격리된다', async () => {
    const otherPosition = {
      ...keyPosition,
      id: '77777777-7777-4777-8777-777777777777',
    };
    useKeyStore.setState({
      selectedKeyType: '7key',
      keyMappings: { '4key': ['KeyA'], '7key': ['KeyZ'] },
      positions: { '4key': [keyPosition], '7key': [otherPosition] },
      canonicalPositions: {
        '4key': [keyPosition],
        '7key': [otherPosition],
      },
    });
    mocks.runMixedDeleteIntent.mockImplementationOnce(async (rawOptions) => {
      const options = rawOptions as {
        receipt?: { rollback: () => void };
      };
      const state = useKeyStore.getState();
      state.setKeyMappingsAndPositions(
        { ...state.keyMappings, '7key': ['KeyY'] },
        {
          ...state.canonicalPositions,
          '7key': [{ ...state.canonicalPositions['7key'][0], width: 321 }],
        },
      );
      options.receipt?.rollback();
    });

    await deleteFrozenSelection([{ type: 'key', id: STABLE_KEY_ID }], '7key');

    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['KeyA']);
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual([
      keyPosition,
    ]);
    expect(useKeyStore.getState().keyMappings['7key']).toEqual(['KeyY']);
    expect(useKeyStore.getState().canonicalPositions['7key'][0].width).toBe(
      321,
    );
  });

  it('혼합 삭제 중 동기 예외가 나도 staged를 정산하고 editor eager를 복원한다', async () => {
    const error = new Error('delete projection failed');
    const mappingsBefore = useKeyStore.getState().keyMappings;
    const positionsBefore = useKeyStore.getState().canonicalPositions;
    mocks.deletePluginElements.mockImplementationOnce(() => {
      throw error;
    });
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: STABLE_KEY_ID, index: 0 },
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
    // plugin eager 실패 시 editor eager(삭제)도 복원 - key가 부활한다
    expect(useKeyStore.getState().keyMappings).toEqual(mappingsBefore);
    expect(useKeyStore.getState().canonicalPositions).toEqual(positionsBefore);
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
    // paste는 항상 mixed-capable 슬롯 정합 러너 - full-record 커밋 금지
    expect(mocks.runMixedGestureIntent).toHaveBeenCalledTimes(1);
    const pasteOptions = (
      mocks.runMixedGestureIntent.mock.calls[0] as unknown[]
    )[0] as {
      gestureId: string;
      initialPluginIds: readonly string[];
    };
    expect(pasteOptions.gestureId).toBe(gestureId);
    expect(pasteOptions.initialPluginIds).toEqual(['plugin-a']);
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

  it('안정 id 이동 정산은 기하 의도 커밋에 gestureId를 전달한다', async () => {
    await act(async () => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: STABLE_KEY_ID, index: 0 }]);
    });
    api.syncSelectedElementsToOverlay(gestureId);

    expect(mocks.commitGeometry).toHaveBeenCalledTimes(1);
    expect(mocks.commitGeometry).toHaveBeenCalledWith(
      [{ type: 'key', id: STABLE_KEY_ID }],
      gestureId,
    );
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('빈 선택 정산은 editor를 커밋하지 않는다', () => {
    api.syncSelectedElementsToOverlay(gestureId);

    expect(mocks.commitGeometry).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('editor 전용 삭제는 슬롯 base에서 id 재해석으로 pair mask 재생성한다', async () => {
    await act(async () => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: STABLE_KEY_ID, index: 0 }]);
    });
    await act(async () => api.deleteSelectedElements());

    expect(mocks.runMixedDeleteIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        gestureId,
        pluginIds: [],
        ops: [
          {
            kind: 'deleteElement',
            elementType: 'key',
            id: STABLE_KEY_ID,
          },
        ],
      }),
    );
    expect(mocks.commitGeneratedPatch).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('삭제 대상이 base에서 이미 사라졌으면 무패치(satisfied)다', async () => {
    await act(async () => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([
          { type: 'key', id: '99999999-9999-4999-8999-999999999999', index: 0 },
        ]);
    });
    await act(async () => api.deleteSelectedElements());

    expect(mocks.runMixedDeleteIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        ops: [
          expect.objectContaining({
            id: '99999999-9999-4999-8999-999999999999',
          }),
        ],
      }),
    );
  });

  it('paste generator는 슬롯 base에 동결 payload를 재적용하고 멱등·충돌을 판별한다', async () => {
    act(() => {
      useGridSelectionStore
        .getState()
        .setClipboard([
          { type: 'key', keyCode: 'KeyB', position: keyPosition },
        ]);
    });
    await act(async () => api.pasteElements());

    expect(mocks.runMixedGestureIntent).toHaveBeenCalledTimes(1);
    const options = (
      mocks.runMixedGestureIntent.mock.calls[0] as unknown[]
    )[0] as {
      generate: (context: { base: unknown; pluginProjection: unknown[] }) => {
        kind: string;
        ops?: Array<{
          kind: string;
          elements: Array<{
            elementType: string;
            slot?: unknown;
            position: Record<string, unknown>;
          }>;
          zUpdates: Array<{
            id: string;
            zIndex: number;
          }>;
        }>;
        patch?: {
          keys?: Record<string, unknown[]>;
          keyPositions?: Record<string, Array<Record<string, unknown>>>;
        };
      };
    };
    const emptyBase = {
      schemaVersion: 1,
      keys: { '4key': [] },
      keyPositions: {
        '4key': [],
      },
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      layerGroups: {},
    };
    const result = options.generate({ base: emptyBase, pluginProjection: [] });
    expect(result.kind).toBe('ops');
    expect(result.ops).toEqual([
      expect.objectContaining({
        kind: 'insertFrozenElements',
        mode: '4key',
        elements: [
          expect.objectContaining({
            elementType: 'key',
            slot: 'KeyB',
          }),
        ],
      }),
    ]);
    const pastedPosition = result.ops![0].elements[0].position;
    const pastedId = pastedPosition.id as string;

    // 멱등 재시도: whole plan을 보내 backend noChange로 판정
    const appliedBase = {
      ...emptyBase,
      keys: { '4key': ['KeyB'] },
      keyPositions: {
        '4key': [pastedPosition],
      },
    };
    expect(
      options.generate({ base: appliedBase, pluginProjection: [] }).kind,
    ).toBe('ops');

    // 충돌: 같은 id에 다른 payload면 전체 중단 sentinel
    const conflictedBase = {
      ...appliedBase,
      keyPositions: {
        '4key': [{ ...pastedPosition, dx: 987, id: pastedId }],
      },
    };
    expect(() =>
      options.generate({ base: conflictedBase, pluginProjection: [] }),
    ).toThrowError(/paste id collision/);
  });

  it('paste batch의 일부 ID나 신규 group만 이미 있으면 전체를 중단한다', async () => {
    const firstId = '10000000-0000-4000-8000-000000000011';
    const secondId = '10000000-0000-4000-8000-000000000012';
    randomUUID
      .mockReturnValueOnce(gestureId)
      .mockReturnValueOnce(firstId)
      .mockReturnValueOnce(secondId);
    act(() => {
      useGridSelectionStore.getState().setClipboard([
        { type: 'key', keyCode: 'KeyB', position: keyPosition },
        { type: 'key', keyCode: 'KeyC', position: keyPosition },
      ]);
    });
    await act(async () => api.pasteElements());

    const options = (
      mocks.runMixedGestureIntent.mock.calls[0] as unknown[]
    )[0] as {
      generate: (context: { base: unknown; pluginProjection: unknown[] }) => {
        kind: string;
      };
    };
    const partiallyApplied = {
      schemaVersion: 1,
      keys: { '4key': ['KeyB'] },
      keyPositions: {
        '4key': [
          {
            ...keyPosition,
            id: firstId,
            dx: keyPosition.dx + 20,
            dy: keyPosition.dy + 20,
          },
        ],
      },
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      layerGroups: {},
    };
    expect(() =>
      options.generate({ base: partiallyApplied, pluginProjection: [] }),
    ).toThrowError(/paste partial state collision/);

    const groupId = '10000000-0000-4000-8000-000000000013';
    const groupedElementId = '10000000-0000-4000-8000-000000000014';
    randomUUID
      .mockReset()
      .mockReturnValueOnce(gestureId)
      .mockReturnValueOnce(groupId)
      .mockReturnValueOnce(groupedElementId);
    act(() => {
      useGridSelectionStore.getState().setClipboard(
        [
          {
            type: 'key',
            keyCode: 'KeyD',
            position: { ...keyPosition, groupId: 'source-group' },
          },
        ],
        [{ id: 'source-group', name: 'Group' }],
      );
    });
    await act(async () => api.pasteElements());
    const groupedOptions = (
      mocks.runMixedGestureIntent.mock.calls[1] as unknown[]
    )[0] as {
      generate: (context: { base: unknown; pluginProjection: unknown[] }) => {
        kind: string;
        ops: Array<{
          groups: Array<{ id: string; name: string }>;
        }>;
      };
    };
    const emptyGroupedBase = {
      schemaVersion: 1,
      keys: { '4key': [] },
      keyPositions: { '4key': [] },
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      layerGroups: {},
    };
    const frozenGroup = groupedOptions.generate({
      base: emptyGroupedBase,
      pluginProjection: [],
    }).ops[0].groups[0];
    expect(() =>
      groupedOptions.generate({
        base: {
          ...emptyGroupedBase,
          layerGroups: {
            '4key': [frozenGroup],
          },
        },
        pluginProjection: [],
      }),
    ).toThrowError(/paste partial state collision/);
  });

  it('paste op는 key pair와 네 native 타입의 full payload를 한 batch에 싣는다', async () => {
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
    ];
    randomUUID
      .mockReturnValueOnce(gestureId)
      .mockReturnValueOnce(ids[0])
      .mockReturnValueOnce(ids[1])
      .mockReturnValueOnce(ids[2])
      .mockReturnValueOnce(ids[3]);
    act(() => {
      useGridSelectionStore.getState().setClipboard([
        { type: 'key', keyCode: 'KeyB', position: keyPosition },
        {
          type: 'stat',
          position: { ...keyPosition, statType: 'kps' },
        },
        {
          type: 'graph',
          position: {
            ...keyPosition,
            statType: 'total',
            graphType: 'line',
            graphSpeed: 1,
            graphColor: '#ffffff',
          },
        },
        {
          type: 'knob',
          position: {
            ...keyPosition,
            axisId: 'axis',
            sensitivity: 1,
            reverse: false,
          },
        },
      ]);
    });
    await act(async () => api.pasteElements());

    const options = (
      mocks.runMixedGestureIntent.mock.calls[0] as unknown[]
    )[0] as {
      generate: (context: { base: unknown; pluginProjection: unknown[] }) => {
        kind: string;
        ops: Array<{
          kind: string;
          elements: Array<{
            elementType: string;
            slot?: unknown;
            position: Record<string, unknown>;
          }>;
        }>;
      };
    };
    const result = options.generate({
      base: {
        schemaVersion: 1,
        keys: { '4key': ['KeyA'] },
        keyPositions: { '4key': [keyPosition] },
        statPositions: {},
        graphPositions: {},
        knobPositions: {},
        layerGroups: {},
      },
      pluginProjection: [],
    });

    expect(result.kind).toBe('ops');
    expect(result.ops[0].kind).toBe('insertFrozenElements');
    expect(
      result.ops[0].elements.map((element) => element.elementType),
    ).toEqual(['key', 'stat', 'graph', 'knob']);
    expect(result.ops[0].elements[0]).toMatchObject({
      elementType: 'key',
      slot: 'KeyB',
      position: { id: ids[0] },
    });
    expect(
      result.ops[0].elements.map((element) => element.position.id),
    ).toEqual(ids);
  });

  it('plugin-only paste도 existing native z를 batch op로 함께 정산한다', async () => {
    act(() => {
      useGridSelectionStore
        .getState()
        .setClipboard([{ type: 'plugin', element: pluginClipboardElement() }]);
    });
    await act(async () => api.pasteElements());

    const options = (
      mocks.runMixedGestureIntent.mock.calls[0] as unknown[]
    )[0] as {
      generate: (context: {
        base: unknown;
        pluginProjection: PluginDisplayElementInternal[];
      }) => {
        kind: string;
        ops: Array<{
          elements: unknown[];
          zUpdates: Array<{ id: string }>;
        }>;
        desiredPluginProjection: PluginDisplayElementInternal[];
      };
    };
    const result = options.generate({
      base: {
        schemaVersion: 1,
        keys: { '4key': ['KeyA'] },
        keyPositions: { '4key': [keyPosition] },
        statPositions: {},
        graphPositions: {},
        knobPositions: {},
        layerGroups: {},
      },
      pluginProjection: [],
    });

    expect(result.kind).toBe('ops');
    expect(result.ops[0].elements).toEqual([]);
    expect(result.ops[0].zUpdates).toEqual([
      expect.objectContaining({ id: STABLE_KEY_ID }),
    ]);
    expect(result.desiredPluginProjection).toHaveLength(1);
  });

  it('기존 native에 invalid ID가 하나라도 있으면 paste 의도를 중단한다', async () => {
    const firstId = '10000000-0000-4000-8000-000000000023';
    const secondId = '10000000-0000-4000-8000-000000000024';
    randomUUID
      .mockReturnValueOnce(gestureId)
      .mockReturnValueOnce(firstId)
      .mockReturnValueOnce(secondId);
    act(() => {
      useGridSelectionStore.getState().setClipboard([
        { type: 'key', keyCode: 'KeyB', position: keyPosition },
        { type: 'key', keyCode: 'KeyC', position: keyPosition },
      ]);
    });
    await act(async () => api.pasteElements());

    const options = (
      mocks.runMixedGestureIntent.mock.calls[0] as unknown[]
    )[0] as {
      generate: (context: { base: unknown; pluginProjection: unknown[] }) => {
        kind: string;
        patch?: Record<string, unknown>;
        ops?: unknown[];
      };
    };
    expect(() =>
      options.generate({
        base: {
          schemaVersion: 1,
          keys: { '4key': ['KeyA', 'KeyB'] },
          keyPositions: {
            '4key': [
              { ...keyPosition, id: 'key-0' },
              {
                ...keyPosition,
                id: firstId,
                dx: keyPosition.dx + 20,
                dy: keyPosition.dy + 20,
              },
            ],
          },
          statPositions: {},
          graphPositions: {},
          knobPositions: {},
          layerGroups: {},
        },
        pluginProjection: [],
      }),
    ).toThrow('paste source document is not canonical');
  });

  it('paste 선택은 성공 뒤 신규 ID로 이동하고 실패하면 기존 선택을 유지한다', async () => {
    const pastedId = '10000000-0000-4000-8000-000000000021';
    randomUUID.mockReturnValueOnce(gestureId).mockReturnValueOnce(pastedId);
    act(() => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: STABLE_KEY_ID, index: 0 }]);
      useGridSelectionStore
        .getState()
        .setClipboard([
          { type: 'key', keyCode: 'KeyB', position: keyPosition },
        ]);
    });
    await act(async () => api.pasteElements());
    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: pastedId, index: 1 },
    ]);

    mocks.runMixedGestureIntent.mockRejectedValueOnce(
      new Error('paste failed'),
    );
    const nextId = '10000000-0000-4000-8000-000000000022';
    randomUUID
      .mockReset()
      .mockReturnValueOnce(gestureId)
      .mockReturnValueOnce(nextId);
    await act(async () => api.pasteElements());
    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: pastedId, index: 1 },
    ]);
  });

  it('그룹 앵커는 당시 자식이 사라져도 살아있는 그룹 경계로 재해석한다', async () => {
    // 그룹 g1의 최상단 자식과 함께 그룹 선택 상태에서 paste
    const memberId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await act(async () => {
      useKeyStore.setState({
        canonicalPositions: {
          '4key': [
            keyPosition,
            { ...keyPosition, id: memberId, groupId: 'g1', zIndex: 5 },
          ],
        } as never,
        keyMappings: { '4key': ['KeyA', 'KeyB'] } as never,
      });
      // 실사용 그룹 클릭 상태: 자식 전체 + groupId 동시 선택 (tie에서
      // 그룹 앵커가 이겨야 한다)
      useGridSelectionStore
        .getState()
        .setFullSelection([{ type: 'key', id: memberId, index: 1 }], ['g1']);
      useGridSelectionStore
        .getState()
        .setClipboard([
          { type: 'key', keyCode: 'KeyC', position: keyPosition },
        ]);
    });
    await act(async () => api.pasteElements());

    const options = (
      mocks.runMixedGestureIntent.mock.calls[0] as unknown[]
    )[0] as {
      generate: (context: { base: unknown; pluginProjection: unknown[] }) => {
        ops?: Array<{
          elements: Array<{ position: Record<string, unknown> }>;
          zUpdates: Array<{ id: string; zIndex: number }>;
        }>;
        patch?: {
          keyPositions?: Record<string, Array<Record<string, unknown>>>;
        };
      };
    };
    // 슬롯 base: 당시 자식(memberId)은 삭제됐지만 g1에 새 자식이 존재
    const survivorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const topId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const base = {
      schemaVersion: 1,
      keys: { '4key': ['KeyA', 'KeyZ', 'KeyT'] },
      keyPositions: {
        '4key': [
          { ...keyPosition, id: STABLE_KEY_ID, zIndex: 1 },
          { ...keyPosition, id: survivorId, groupId: 'g1', zIndex: 9 },
          { ...keyPosition, id: topId, zIndex: 20 },
        ],
      },
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      layerGroups: { '4key': [{ id: 'g1', name: 'g1' }] },
    };
    const result = options.generate({ base, pluginProjection: [] });
    const inserted = result.ops?.[0].elements[0].position;
    const zUpdates = new Map(
      result.ops?.[0].zUpdates.map((update) => [update.id, update.zIndex]),
    );
    // 그룹 경계 위에 삽입 - 살아있는 g1 자식보다 위지만 그룹 밖 최상단
    // 요소보다는 아래 (element 앵커 소실의 전역 최상단 폴백과 구별)
    expect(inserted).toBeDefined();
    expect((inserted!.zIndex as number) > zUpdates.get(survivorId)!).toBe(true);
    expect((inserted!.zIndex as number) < zUpdates.get(topId)!).toBe(true);
  });

  it('plugin eager가 실패하면 editor eager도 함께 복원한다', async () => {
    mocks.pluginAdditionThrows = true;
    const mappingsBefore = useKeyStore.getState().keyMappings;
    const positionsBefore = useKeyStore.getState().canonicalPositions;
    act(() => {
      useGridSelectionStore
        .getState()
        .setClipboard([
          { type: 'key', keyCode: 'KeyB', position: keyPosition },
        ]);
    });
    let caught: unknown;
    await act(async () => {
      try {
        await api.pasteElements();
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as Error).message).toBe('plugin eager failed');
    expect(useKeyStore.getState().keyMappings).toEqual(mappingsBefore);
    expect(useKeyStore.getState().canonicalPositions).toEqual(positionsBefore);
  });

  it('plugin scope staging은 eager 스토어 변이보다 앞선다', async () => {
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: STABLE_KEY_ID, index: 0 },
        { type: 'plugin', id: 'plugin-a:element' },
      ]);
    });
    await act(async () => api.deleteSelectedElements());

    const beginOrder =
      mocks.beginMixedGesture.mock.invocationCallOrder[0] ?? Infinity;
    const deleteOrder =
      mocks.deletePluginElements.mock.invocationCallOrder[0] ?? -1;
    expect(beginOrder).toBeLessThan(deleteOrder);
  });
});
