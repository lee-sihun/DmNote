import { editorApi } from '@api/modules/editorApi';
import { unstable_batchedUpdates } from 'react-dom';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { invalidateSelectionForChangedIndexedElementArrays } from '@stores/grid/useGridSelectionStore';
import { stableStringify } from '@utils/core/stableStringify';

import { createEditorCoordinator } from './editorCoordinator';

import type { EditorDocumentV1 } from '@src/types/editor';

const hasChanged = (current: unknown, next: unknown) =>
  stableStringify(current) !== stableStringify(next);

export const captureEditorDocument = (): EditorDocumentV1 => {
  const keyState = useKeyStore.getState();
  return {
    schemaVersion: 1,
    keys: keyState.keyMappings,
    keyPositions: keyState.positions,
    statPositions: useStatItemStore.getState().positions,
    graphPositions: useGraphItemStore.getState().positions,
    knobPositions: useKnobItemStore.getState().positions,
    layerGroups: useLayerGroupStore.getState().layerGroups,
  };
};

export const applyEditorDocument = (document: EditorDocumentV1): void => {
  unstable_batchedUpdates(() => {
    const keyState = useKeyStore.getState();
    const mode = keyState.selectedKeyType;
    invalidateSelectionForChangedIndexedElementArrays(
      {
        keyMappings: keyState.keyMappings[mode] ?? [],
        keyPositions: keyState.positions[mode] ?? [],
        stat: useStatItemStore.getState().positions[mode] ?? [],
        graph: useGraphItemStore.getState().positions[mode] ?? [],
        knob: useKnobItemStore.getState().positions[mode] ?? [],
      },
      {
        keyMappings: document.keys[mode] ?? [],
        keyPositions: document.keyPositions[mode] ?? [],
        stat: document.statPositions[mode] ?? [],
        graph: document.graphPositions[mode] ?? [],
        knob: document.knobPositions[mode] ?? [],
      },
    );
    const keyChanges: Partial<
      Pick<typeof keyState, 'keyMappings' | 'positions'>
    > = {};
    if (hasChanged(keyState.keyMappings, document.keys)) {
      keyChanges.keyMappings = document.keys;
    }
    if (hasChanged(keyState.positions, document.keyPositions)) {
      keyChanges.positions = document.keyPositions;
    }
    if (Object.keys(keyChanges).length > 0) {
      useKeyStore.setState(keyChanges);
    }

    if (
      hasChanged(useStatItemStore.getState().positions, document.statPositions)
    ) {
      useStatItemStore.setState({ positions: document.statPositions });
    }
    if (
      hasChanged(
        useGraphItemStore.getState().positions,
        document.graphPositions,
      )
    ) {
      useGraphItemStore.setState({ positions: document.graphPositions });
    }
    if (
      hasChanged(useKnobItemStore.getState().positions, document.knobPositions)
    ) {
      useKnobItemStore.setState({ positions: document.knobPositions });
    }
    if (
      hasChanged(
        useLayerGroupStore.getState().layerGroups,
        document.layerGroups,
      )
    ) {
      useLayerGroupStore.getState().setLayerGroups(document.layerGroups);
    }
  });
};

export const editorCoordinator = createEditorCoordinator({
  transport: editorApi,
  readDocument: captureEditorDocument,
  // OBS 브릿지는 읽기 전용, 네이티브 창은 revision 충돌 검사를 거쳐 쓰기 허용
  readOnly: () => window.__dmn_runtime === 'obs',
  applyDocument: (document, reason) => {
    // OBS는 읽기 전용이므로 차단될 쓰기를 화면에 낙관 적용하지 않음
    if (reason === 'localPatch' && window.__dmn_runtime === 'obs') return;
    applyEditorDocument(document);
  },
});
