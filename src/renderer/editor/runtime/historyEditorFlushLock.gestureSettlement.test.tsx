import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNativePositionDragReceipt } from './intent/elementIntent';
import { useGridSelection } from '@hooks/Grid/selection/useGridSelection';
import { createDefaultKeyPosition } from '../model/keys';
import { makeCanonicalSpritePosition } from '@utils/sprite/spriteFixtures';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { createPluginPositionDragReceipt } from '@plugins/runtime/displayElement/pluginElementActions';
import {
  applyEditorDocument,
  captureEditorDocument,
} from './coordinator/editorStateCoordinator';
import { useSelectionDrag } from '@hooks/Grid/drag/useSelectionDrag';
import { useDraggable } from '@hooks/Grid/drag/useDraggable';
import { useGridResize } from '@hooks/Grid/resize/useGridResize';
import { useScrubDrag } from '@hooks/ui/useScrubDrag';
import { createPluginGeometryGestureController } from '@hooks/Grid/usePluginGeometryGesture';
import { releaseDragSession } from '@hooks/Grid/drag/dragSession';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import {
  getStagedPluginInstancesGestureId,
  isPluginInstancesGestureStaged,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { flushFocusedEditor } from './lifecycle/lifecycleEditorFlush';
import {
  drainEditorWrites,
  trackEditorWrite,
} from './lifecycle/editorWriteBarrier';
import {
  acquireHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
  releaseHistoryEditorFlushLock,
} from './lifecycle/historyEditorFlushLock';

const PLUGIN_ID = 'history-lock-plugin';
const GESTURE_ID = 'history-lock-gesture';
const ELEMENT_ID = 'history-lock-element';
const KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SPRITE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

interface HarnessProps {
  cleanup: (reason?: boolean | 'history') => void;
}

const SelectionHarness = ({ cleanup }: HarnessProps) => {
  const { handlePointerDown } = useSelectionDrag({
    enabled: true,
    zoom: 1,
    startX: 0,
    startY: 0,
    elementId: 'history-lock-element',
    elementWidth: 60,
    elementHeight: 60,
    selectedElements: [{ id: 'history-lock-element', type: 'plugin' }],
    getOtherElements: () => [],
    onMultiDragStart: () => {
      beginMixedGestureTransaction(GESTURE_ID, [PLUGIN_ID]);
      return (commit = true) => {
        cancelUncommittedMixedGestureTransaction(GESTURE_ID, {
          discardPendingSave: !commit,
        });
        cleanup(commit);
      };
    },
    onMultiDrag: () => {},
  });
  return (
    <div data-testid="history-lock-drag" onPointerDown={handlePointerDown} />
  );
};

const DraggableHarness = ({ cleanup }: HarnessProps) => {
  const { ref } = useDraggable({
    elementId: ELEMENT_ID,
    onDragStart: () => {
      beginMixedGestureTransaction(GESTURE_ID, [PLUGIN_ID]);
      return (commit = true) => {
        cancelUncommittedMixedGestureTransaction(GESTURE_ID, {
          discardPendingSave: !commit,
        });
        cleanup(commit);
      };
    },
  });
  return <div data-testid="history-lock-drag" ref={ref} />;
};

const ResizeHarness = () => {
  const resize = useGridResize({
    selectedElements: [{ id: ELEMENT_ID, type: 'plugin' }],
    selectedKeyType: '4key',
  });
  return (
    <div
      data-testid="history-lock-drag"
      data-preview={resize.previewBounds !== null}
      onPointerDown={() => resize.handleResizeStart()}
      onPointerMove={() =>
        resize.handleResize({ x: 0, y: 0, width: 90, height: 80 })
      }
    />
  );
};

const ScrubHarness = ({ cleanup }: HarnessProps) => {
  const [controller] = useState(createPluginGeometryGestureController);
  const target = { fullId: ELEMENT_ID, pluginId: PLUGIN_ID };
  const scrub = useScrubDrag({
    enabled: true,
    resolveBase: () => 0,
    step: 1,
    quantize: (value) => value,
    onMove: (value) => controller.preview(target, 'x', value),
    onCommit: (value) => controller.commit(target, 'x', value),
    onCancel: (reason) => {
      controller.cancel();
      cleanup(reason);
    },
  });
  return <div data-testid="history-lock-drag" {...scrub.handlers} />;
};

const MixedNativeHarness = () => {
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const selection = useGridSelection({
    selectedElements,
    selectedKeyType: '4key',
    keyMappings: useKeyStore.getState().keyMappings,
    positions: useKeyStore.getState().canonicalPositions,
  });
  const receipt = useRef<ReturnType<
    typeof createPluginPositionDragReceipt
  > | null>(null);
  const nativeReceipt = useRef<ReturnType<
    typeof createNativePositionDragReceipt
  > | null>(null);
  const { handlePointerDown } = useSelectionDrag({
    enabled: true,
    zoom: 1,
    startX: 0,
    startY: 0,
    elementId: ELEMENT_ID,
    elementWidth: 60,
    elementHeight: 60,
    selectedElements,
    getOtherElements: () => [],
    onMultiDragStart: () => {
      selection.freezeSelectionForGesture();
      nativeReceipt.current = createNativePositionDragReceipt(
        selectedElements.flatMap(({ type, id }) =>
          type === 'plugin' ? [] : [{ type, id }],
        ),
      );
      receipt.current = createPluginPositionDragReceipt(new Set([ELEMENT_ID]));
      beginMixedGestureTransaction(GESTURE_ID, [PLUGIN_ID]);
      return (commit = true) => {
        if (!commit) nativeReceipt.current?.rollback();
        cancelUncommittedMixedGestureTransaction(GESTURE_ID, {
          discardPendingSave: !commit,
          beforeDiscard: receipt.current?.rollback,
        });
      };
    },
    onMultiDrag: (dx, dy) =>
      nativeReceipt.current?.apply(() =>
        receipt.current?.apply(() =>
          selection.moveSelectedElements(dx, dy, undefined, false),
        ),
      ),
  });
  return (
    <div data-testid="history-lock-drag" onPointerDown={handlePointerDown} />
  );
};

describe('history handshake settles active mixed selection drag', () => {
  let host: HTMLDivElement;
  let root: Root;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resetHistoryEditorFlushLock();
    releaseDragSession();
    useGridSelectionStore.setState({
      selectedElements: [{ id: ELEMENT_ID, type: 'plugin' }],
    });
    usePluginDisplayElementStore.setState({
      elements: [
        {
          id: ELEMENT_ID,
          fullId: ELEMENT_ID,
          pluginId: PLUGIN_ID,
          definitionId: PLUGIN_ID,
          html: '',
          position: { x: 0, y: 0 },
          measuredSize: { width: 60, height: 60 },
        },
      ],
    });
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    act(() => root.unmount());
    const staged = getStagedPluginInstancesGestureId(PLUGIN_ID);
    if (staged)
      cancelUncommittedMixedGestureTransaction(staged, {
        discardPendingSave: true,
      });
    await vi.runOnlyPendingTimersAsync();
    await drainEditorWrites();
    host.remove();
    resetHistoryEditorFlushLock();
    releaseDragSession();
    useGridSelectionStore.setState({ selectedElements: [] });
    usePluginDisplayElementStore.setState({ elements: [] });
    useKeyStore.getState().setKeyMappingsAndPositions({}, {});
    useSpriteStore.getState().setPositions({});
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['selection', 'draggable', 'resize', 'scrub'] as const)(
    '%s: blur와 pointer 종료 없이 lock 취득만으로 staged를 닫아 flush가 ACK 단계에 도달한다',
    async (kind) => {
      const cleanup = vi.fn();
      const Harness =
        kind === 'selection'
          ? SelectionHarness
          : kind === 'draggable'
          ? DraggableHarness
          : kind === 'resize'
          ? ResizeHarness
          : ScrubHarness;
      act(() => root.render(<Harness cleanup={cleanup} />));
      const target = host.querySelector('[data-testid="history-lock-drag"]')!;
      const pointer = (type: string, clientX: number) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX,
          clientY: 0,
        });
      act(() => {
        target.dispatchEvent(pointer('pointerdown', 0));
        target.dispatchEvent(pointer('pointermove', 20));
        frames.splice(0).forEach((callback) => callback(0));
      });
      expect(isPluginInstancesGestureStaged(PLUGIN_ID)).toBe(true);
      const historyTick = useCommittedApplyStore.getState().historyTick;

      act(() => {
        acquireHistoryEditorFlushLock('history-handshake');
      });
      const acknowledge = vi.fn();
      const flushing = flushFocusedEditor().then((committed) => {
        if (committed) acknowledge();
        return committed;
      });
      await vi.runOnlyPendingTimersAsync();

      expect(useCommittedApplyStore.getState().historyTick).toBe(historyTick);
      expect(acknowledge).toHaveBeenCalledOnce();
      if (kind === 'resize')
        expect(target.getAttribute('data-preview')).toBe('false');
      else
        expect(cleanup).toHaveBeenCalledWith(
          kind === 'scrub' ? 'history' : false,
        );
      expect(isPluginInstancesGestureStaged(PLUGIN_ID)).toBe(false);
      await expect(flushing).resolves.toBe(true);
    },
  );

  it.each([true, false])(
    'native eager 이동은 history 성공=%s 이후 원래 위치를 보존한다',
    async (succeeds) => {
      useKeyStore
        .getState()
        .setKeyMappingsAndPositions(
          { '4key': ['KeyA'] },
          { '4key': [{ ...createDefaultKeyPosition(), id: KEY_ID }] },
        );
      useSpriteStore.getState().setPositions({
        '4key': [makeCanonicalSpritePosition({ id: SPRITE_ID })],
      });
      useGridSelectionStore.setState({
        selectedElements: [
          { id: KEY_ID, type: 'key' },
          { id: SPRITE_ID, type: 'sprite' },
          { id: ELEMENT_ID, type: 'plugin' },
        ],
      });
      const canonical = captureEditorDocument();
      act(() => root.render(<MixedNativeHarness />));
      const target = host.querySelector('[data-testid="history-lock-drag"]')!;
      const pointer = (type: string, clientX: number) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX,
          clientY: 0,
        });
      act(() => {
        target.dispatchEvent(pointer('pointerdown', 0));
        target.dispatchEvent(pointer('pointermove', 20));
        frames.splice(0).forEach((callback) => callback(0));
      });
      expect(useKeyStore.getState().canonicalPositions['4key'][0].dx).toBe(20);
      expect(useSpriteStore.getState().positions['4key'][0].dx).toBe(20);
      let rejectWrite: (reason: Error) => void = () => {};
      if (!succeeds)
        trackEditorWrite(
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          }),
        );
      act(() => {
        acquireHistoryEditorFlushLock('native-history-handshake');
      });
      const flushing = flushFocusedEditor();
      if (!succeeds) rejectWrite(new Error('settings write denied'));
      await vi.runOnlyPendingTimersAsync();
      await expect(flushing).resolves.toBe(succeeds);
      act(() => {
        if (succeeds) applyEditorDocument(canonical);
        releaseHistoryEditorFlushLock('native-history-handshake');
      });
      expect(
        usePluginDisplayElementStore.getState().elements[0].position.x,
      ).toBe(0);
      expect(useKeyStore.getState().canonicalPositions['4key'][0].dx).toBe(0);
      expect(useSpriteStore.getState().positions['4key'][0].dx).toBe(0);
    },
  );
});
