import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDITOR_OPS_VERSION } from '@src/types/editor';
import type { EditorDocumentV1, EditorOpV1 } from '@src/types/editor';

// 실제 드래그 제스처(pointer 이벤트)부터 IPC 경계까지 한 번에 태운다.
// 대역은 invoke와 preview뿐이고 드래그 훅·선택 스토어·정산·러너·transaction·
// coordinator는 전부 프로덕션 코드를 그대로 쓴다
const runtime = vi.hoisted(() => ({
  invoke: vi.fn(),
  previewCancel: vi.fn(async () => {}),
  previewPublish: vi.fn(async () => {}),
  previewSubscribe: vi.fn(async () => 1),
  onCommitted: vi.fn(() =>
    Object.assign(() => {}, { ready: Promise.resolve() }),
  ),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }));

vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    cancel: runtime.previewCancel,
    publish: runtime.previewPublish,
    subscribe: runtime.previewSubscribe,
  },
}));

vi.mock('@api/modules/editorApi', () => ({
  editorApi: {
    get: async () => ({ revision: 0, document: makeDocument() }),
    commit: async () => {
      throw new Error('mixed drag must not use editor_commit');
    },
    onCommitted: runtime.onCommitted,
  },
  editorCommitRaw: async () => {
    throw new Error('mixed drag must not use editorCommitRaw');
  },
}));

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useGridSelection } from './useGridSelection';
import { useSelectionDrag } from './useSelectionDrag';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';

const KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLUGIN_ID = 'plugin-a';
const PLUGIN_FULL_ID = `${PLUGIN_ID}:element`;
const GESTURE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type GestureRequest = {
  gestureId?: string;
  editorOpsVersion?: number;
  editorOps?: EditorOpV1[];
  editorChanges?: unknown;
  pluginChanges?: Array<{ pluginId: string }>;
};

function makeDocument(): EditorDocumentV1 {
  return {
    schemaVersion: 1,
    keys: { '4key': ['KeyA'] },
    keyPositions: {
      '4key': [
        {
          ...createDefaultKeyPosition(0, 0),
          id: KEY_ID,
          dx: 0,
          dy: 0,
        } as never,
      ],
    },
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    layerGroups: {},
  };
}

const gestureResult = (withOps: boolean) => ({
  editorRevision: 1,
  pluginModelRevision: 1,
  authorityGeneration: 0,
  changedFields: withOps ? ['keyPositions'] : [],
  changedPluginIds: [PLUGIN_ID],
  ...(withOps
    ? {
        editorOpResults: [
          {
            status: 'applied',
            bounds: { dx: 5, dy: 0, width: 60, height: 60 },
          },
        ],
      }
    : {}),
});

// 드래그 대상 요소와 정산을 한 화면에 붙인 최소 하네스
const Harness = ({ onEnd }: { onEnd: (gestureId: string) => void }) => {
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const positions = useKeyStore((state) => state.positions);
  const { moveSelectedElements, syncSelectedElementsToOverlay } =
    useGridSelection({
      selectedElements,
      selectedKeyType: '4key',
      keyMappings: { '4key': ['KeyA'] },
      positions,
    });

  const { handlePointerDown } = useSelectionDrag({
    enabled: true,
    zoom: 1,
    startX: 0,
    startY: 0,
    elementId: KEY_ID,
    elementWidth: 60,
    elementHeight: 60,
    selectedElements,
    getOtherElements: () => [],
    onMultiDrag: (dx, dy) => moveSelectedElements(dx, dy, GESTURE_ID, false),
    onMultiDragEnd: () => {
      syncSelectedElementsToOverlay(GESTURE_ID);
      onEnd(GESTURE_ID);
    },
  });

  return (
    <div
      data-testid="drag-target"
      onPointerDown={handlePointerDown}
      style={{ width: 60, height: 60 }}
    />
  );
};

describe('혼합 선택 드래그 정산 전 구간', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId = 1;

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

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

    runtime.invoke.mockReset();
    runtime.invoke.mockImplementation(
      async (command: string, args?: { request?: GestureRequest }) => {
        if (command === 'commit_gesture') {
          return gestureResult(Boolean(args?.request?.editorOps));
        }
        if (command === 'editor_get') {
          return { revision: 0, document: makeDocument() };
        }
        return undefined;
      },
    );

    const document0 = makeDocument();
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['KeyA'] },
      positions: document0.keyPositions as never,
      canonicalPositions: document0.keyPositions as never,
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useLayerGroupStore.setState({ layerGroups: {} });
    usePluginDisplayElementStore.setState({
      elements: [
        {
          id: 'element',
          fullId: PLUGIN_FULL_ID,
          pluginId: PLUGIN_ID,
          definitionId: PLUGIN_ID,
          html: '<div />',
          position: { x: 30, y: 40 },
          tabId: '4key',
        } as never,
      ],
    });
    useGridSelectionStore.getState().clearSelection();
    window.__dmn_window_type = 'main';

    await editorCoordinator.start();

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    editorCoordinator.stop();
    vi.restoreAllMocks();
  });

  it('네이티브와 플러그인을 함께 선택해 드래그하면 setBounds op이 한 gesture로 나간다', async () => {
    const ended = vi.fn();
    await act(async () => {
      root.render(<Harness onEnd={ended} />);
    });
    await act(async () => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: KEY_ID, index: 0 },
        { type: 'plugin', id: PLUGIN_FULL_ID },
      ]);
    });

    const target = host.querySelector<HTMLElement>(
      '[data-testid="drag-target"]',
    )!;

    // 실제 포인터 제스처
    await act(async () => {
      target.dispatchEvent(pointerEvent('pointerdown'));
      target.dispatchEvent(pointerEvent('pointermove', { clientX: 5 }));
      flushRaf();
      target.dispatchEvent(pointerEvent('pointerup', { clientX: 5 }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ended).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      const calls = runtime.invoke.mock.calls.filter(
        (call) => call[0] === 'commit_gesture',
      );
      expect(calls).toHaveLength(1);
    });

    const request = (
      runtime.invoke.mock.calls.find(
        (call) => call[0] === 'commit_gesture',
      )![1] as { request: GestureRequest }
    ).request;

    expect(request.gestureId).toBe(GESTURE_ID);
    expect(request.editorOpsVersion).toBe(EDITOR_OPS_VERSION);
    expect(request.editorChanges).toBeUndefined();
    expect(request.editorOps).toHaveLength(1);
    const op = request.editorOps![0] as Extract<
      EditorOpV1,
      { kind: 'setBounds' }
    >;
    expect(op.kind).toBe('setBounds');
    expect(op.elementType).toBe('key');
    expect(op.id).toBe(KEY_ID);
    // 드래그로 이동한 dx가 실리고 크기는 base 값을 따른다
    expect(op.bounds.dx).toBe(5);
    expect(op.bounds.width).toBe(60);
    expect(op.bounds.height).toBe(60);
    // 플러그인이 같은 gesture에 함께 실린다
    expect(request.pluginChanges?.map((change) => change.pluginId)).toEqual([
      PLUGIN_ID,
    ]);
  });
});
