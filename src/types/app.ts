import { SettingsState } from '@src/types/settings/settings';
import {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { DialItemPositions } from '@src/types/key/dials';
import type { DefaultsPayload } from '@src/renderer/defaults';
import type { LayerGroups } from '@src/types/layerGroups';
import type { TabNoteOverrides } from '@src/types/settings/noteSettings';
import type { TabCssOverrides } from '@src/types/plugin/css';

export interface BootstrapPayload {
  settings: SettingsState;
  defaults: DefaultsPayload;
  keys: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  dialPositions: DialItemPositions;
  customTabs: CustomTab[];
  selectedKeyType: string;
  currentMode: string;
  overlay: {
    visible: boolean;
    locked: boolean;
    anchor: string;
  };
  keyCounters: KeyCounters;
  layerGroups: LayerGroups;
  tabNoteOverrides: TabNoteOverrides;
  tabCssOverrides: TabCssOverrides;
}
