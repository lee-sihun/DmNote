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

interface UseSelectedElementDragLifecycleOptions {
  freezeSelectionForGesture: () => void;
  syncSelectedElementsToOverlay: (gestureId?: string) => void;
}

export const useSelectedElementDragLifecycle = ({
  freezeSelectionForGesture,
  syncSelectedElementsToOverlay,
}: UseSelectedElementDragLifecycleOptions) => {
  const gestureIdRef = useRef<string | null>(null);

  const beginSelectedElementsDrag = () => {
    const gestureId = crypto.randomUUID();
    gestureIdRef.current = gestureId;
    freezeSelectionForGesture();
    const frozenSelection = useGridSelectionStore.getState().selectedElements;
    const selectedPluginElementIds = new Set(
      frozenSelection
        .filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );
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
    return () => {
      tokens.forEach((token, pluginId) => {
        endPluginInstancesEditSession(pluginId, token);
      });
      cancelUncommittedMixedGestureTransaction(gestureId);
      if (gestureIdRef.current === gestureId) gestureIdRef.current = null;
    };
  };

  const commitSelectedElementsDrag = () => {
    syncSelectedElementsToOverlay(gestureIdRef.current ?? undefined);
  };

  return { beginSelectedElementsDrag, commitSelectedElementsDrag };
};
