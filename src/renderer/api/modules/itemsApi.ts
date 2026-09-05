import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';
import { enqueueEditorCompatibilityWrite } from '@src/renderer/editor/runtime/lifecycle/editorCompatibilityQueue';
import { editorCoordinator } from '@src/renderer/editor/runtime/coordinator/editorStateCoordinator';

import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
import type { LayerGroups } from '@src/types/layerGroups';

export const statItemsApi = {
  getPositions: () => invoke<StatItemPositions>('stat_positions_get'),
  updatePositions: (positions: StatItemPositions) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          statPositions: positions,
        }),
      () => structuredClone(positions),
    ),
  onPositionsChanged: (listener: (positions: StatItemPositions) => void) =>
    subscribe<StatItemPositions>('statPositions:changed', listener),
};

export const graphItemsApi = {
  getPositions: () => invoke<GraphItemPositions>('graph_positions_get'),
  updatePositions: (positions: GraphItemPositions) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          graphPositions: positions,
        }),
      () => structuredClone(positions),
    ),
  onPositionsChanged: (listener: (positions: GraphItemPositions) => void) =>
    subscribe<GraphItemPositions>('graphPositions:changed', listener),
};

export const knobItemsApi = {
  getPositions: () => invoke<KnobItemPositions>('knob_positions_get'),
  updatePositions: (positions: KnobItemPositions) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          knobPositions: positions,
        }),
      () => structuredClone(positions),
    ),
  onPositionsChanged: (listener: (positions: KnobItemPositions) => void) =>
    subscribe<KnobItemPositions>('knobPositions:changed', listener),
};

export const layerGroupsApi = {
  get: () => invoke<LayerGroups>('layer_groups_get'),
  update: (groups: LayerGroups) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          layerGroups: groups,
        }),
      () => structuredClone(groups),
    ),
  onChanged: (listener: (groups: LayerGroups) => void) =>
    subscribe<LayerGroups>('layerGroups:changed', listener),
};
