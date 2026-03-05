import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import type { StatItemPositions } from '@src/types/statItems';
import type { GraphItemPositions } from '@src/types/graphItems';
import type { LayerGroups } from '@src/types/layerGroups';

export const statItemsApi = {
  getPositions: () => invoke<StatItemPositions>('stat_positions_get'),
  updatePositions: (positions: StatItemPositions) =>
    invoke<StatItemPositions>('stat_positions_update', { positions }),
  onPositionsChanged: (listener: (positions: StatItemPositions) => void) =>
    subscribe<StatItemPositions>('statPositions:changed', listener),
};

export const graphItemsApi = {
  getPositions: () => invoke<GraphItemPositions>('graph_positions_get'),
  updatePositions: (positions: GraphItemPositions) =>
    invoke<GraphItemPositions>('graph_positions_update', { positions }),
  onPositionsChanged: (listener: (positions: GraphItemPositions) => void) =>
    subscribe<GraphItemPositions>('graphPositions:changed', listener),
};

export const layerGroupsApi = {
  get: () => invoke<LayerGroups>('layer_groups_get'),
  update: (groups: LayerGroups) =>
    invoke<LayerGroups>('layer_groups_update', { groups }),
  onChanged: (listener: (groups: LayerGroups) => void) =>
    subscribe<LayerGroups>('layerGroups:changed', listener),
};
