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
  runMixedDeleteIntent: vi.fn(() => Promise.resolve()),
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
    mocks.commitGeometry.mockClear();
    mocks.runMixedIntent.mockClear();
    mocks.commitGeneratedPatch.mockClear();
    mocks.pluginAdditionThrows = false;
    mocks.runMixedGestureIntent.mockClear();
    mocks.runMixedDeleteIntent.mockClear();
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
    expect(result.kind).toBe('patch');
    expect(result.patch?.keys?.['4key']).toEqual(['KeyB']);
    expect(result.patch?.keyPositions?.['4key']).toHaveLength(1);
    const pastedId = result.patch?.keyPositions?.['4key'][0].id as string;

    // 멱등 재시도: 같은 payload가 이미 base에 있으면 satisfied
    const appliedBase = {
      ...emptyBase,
      keys: { '4key': ['KeyB'] },
      keyPositions: {
        '4key': [result.patch!.keyPositions!['4key'][0]],
      },
    };
    expect(
      options.generate({ base: appliedBase, pluginProjection: [] }).kind,
    ).toBe('satisfied');

    // 충돌: 같은 id에 다른 payload면 전체 중단 sentinel
    const conflictedBase = {
      ...appliedBase,
      keyPositions: {
        '4key': [
          { ...result.patch!.keyPositions!['4key'][0], dx: 987, id: pastedId },
        ],
      },
    };
    expect(() =>
      options.generate({ base: conflictedBase, pluginProjection: [] }),
    ).toThrowError(/paste id collision/);
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
    const positions = result.patch?.keyPositions?.['4key'] ?? [];
    const pasted = positions.find(
      (position) =>
        position.id !== STABLE_KEY_ID &&
        position.id !== survivorId &&
        position.id !== topId,
    );
    const survivor = positions.find((position) => position.id === survivorId);
    const top = positions.find((position) => position.id === topId);
    // 그룹 경계 위에 삽입 - 살아있는 g1 자식보다 위지만 그룹 밖 최상단
    // 요소보다는 아래 (element 앵커 소실의 전역 최상단 폴백과 구별)
    expect(pasted).toBeDefined();
    expect((pasted!.zIndex as number) > (survivor!.zIndex as number)).toBe(
      true,
    );
    expect((pasted!.zIndex as number) < (top!.zIndex as number)).toBe(true);
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
