import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import {
  LAYER_PANEL_TABS,
  TABS,
} from '@components/main/Grid/PropertiesPanel/types';

import type { PanelViewState } from '@api/modules/selectionSessionApi';

const validTabs = Object.values(LAYER_PANEL_TABS) as string[];
const validPropertyTabs = Object.values(TABS) as string[];

export const capturePanelViewState = (): PanelViewState => {
  const state = usePropertiesPanelStore.getState();
  return {
    mode: state.canvasPanelMode,
    activeTab: state.canvasPanelActiveTab,
    propertyActiveTab: state.propertyPanelActiveTab,
  };
};

export const applyPanelViewState = (payload: Partial<PanelViewState>): void => {
  const next: Partial<ReturnType<typeof usePropertiesPanelStore.getState>> = {};
  if (payload.mode === 'layer' || payload.mode === 'property') {
    next.canvasPanelMode = payload.mode;
  }
  if (
    typeof payload.activeTab === 'string' &&
    validTabs.includes(payload.activeTab)
  ) {
    next.canvasPanelActiveTab =
      payload.activeTab as (typeof LAYER_PANEL_TABS)[keyof typeof LAYER_PANEL_TABS];
  }
  if (
    typeof payload.propertyActiveTab === 'string' &&
    validPropertyTabs.includes(payload.propertyActiveTab)
  ) {
    next.propertyPanelActiveTab =
      payload.propertyActiveTab as (typeof TABS)[keyof typeof TABS];
  }
  usePropertiesPanelStore.setState(next);
};
