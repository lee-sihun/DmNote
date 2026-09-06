import { useRef } from 'react';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  beginPluginInstancesEditSession,
  endPluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { createPluginPositionDragReceipt } from '@plugins/runtime/displayElement/pluginElementActions';
import { createNativePositionDragReceipt } from '@src/renderer/editor/runtime/intent/elementIntent';

interface UseSelectedElementDragLifecycleOptions {
  freezeSelectionForGesture: () => void;
  syncSelectedElementsToOverlay: (gestureId?: string) => void;
  moveSelectedElements: (deltaX: number, deltaY: number) => void;
}

export const useSelectedElementDragLifecycle = ({
  freezeSelectionForGesture,
  syncSelectedElementsToOverlay,
  moveSelectedElements,
}: UseSelectedElementDragLifecycleOptions) => {
  const gestureIdRef = useRef<string | null>(null);
  // 드래그 시작값 영수증 - 취소된 제스처는 네이티브·플러그인 위치를 되돌린다
  const nativeReceiptRef = useRef<ReturnType<
    typeof createNativePositionDragReceipt
  > | null>(null);
  const pluginReceiptRef = useRef<ReturnType<
    typeof createPluginPositionDragReceipt
  > | null>(null);

  const moveSelectedElementsDrag = (deltaX: number, deltaY: number) => {
    const move = () => moveSelectedElements(deltaX, deltaY);
    const pluginReceipt = pluginReceiptRef.current;
    const movePlugins = () => {
      if (pluginReceipt) pluginReceipt.apply(move);
      else move();
    };
    const nativeReceipt = nativeReceiptRef.current;
    if (nativeReceipt) nativeReceipt.apply(movePlugins);
    else movePlugins();
  };

  const beginSelectedElementsDrag = () => {
    const gestureId = crypto.randomUUID();
    gestureIdRef.current = gestureId;
    freezeSelectionForGesture();
    const frozenSelection = useGridSelectionStore.getState().selectedElements;
    const nativeReceipt = createNativePositionDragReceipt(
      frozenSelection.flatMap(({ type, id }) =>
        type === 'plugin' ? [] : [{ type, id }],
      ),
    );
    nativeReceiptRef.current = nativeReceipt;
    const selectedPluginElementIds = new Set(
      frozenSelection
        .filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );
    const pluginReceipt = createPluginPositionDragReceipt(
      selectedPluginElementIds,
    );
    pluginReceiptRef.current = pluginReceipt;
    const tokens = new Map<string, string>();
    usePluginDisplayElementStore
      .getState()
      .elements.filter((element) =>
        selectedPluginElementIds.has(element.fullId),
      )
      .forEach((element) => {
        if (!tokens.has(element.pluginId)) {
          tokens.set(
            element.pluginId,
            beginPluginInstancesEditSession(element.pluginId, gestureId),
          );
        }
      });
    if (tokens.size > 0) {
      beginMixedGestureTransaction(gestureId, [...tokens.keys()]);
    }
    return (commit = true) => {
      if (!commit) {
        nativeReceipt.rollback();
        cancelUncommittedMixedGestureTransaction(gestureId, {
          discardPendingSave: true,
          beforeDiscard: pluginReceipt.rollback,
        });
      }
      tokens.forEach((token, pluginId) => {
        endPluginInstancesEditSession(pluginId, token);
      });
      cancelUncommittedMixedGestureTransaction(gestureId);
      if (gestureIdRef.current === gestureId) {
        gestureIdRef.current = null;
        nativeReceiptRef.current = null;
        pluginReceiptRef.current = null;
      }
    };
  };

  const commitSelectedElementsDrag = () => {
    syncSelectedElementsToOverlay(gestureIdRef.current ?? undefined);
  };

  return {
    beginSelectedElementsDrag,
    commitSelectedElementsDrag,
    moveSelectedElementsDrag,
  };
};
