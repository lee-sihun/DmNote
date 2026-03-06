import { SettingsState } from '@src/types/settings/settings';
import {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { DefaultsPayload } from '@src/renderer/defaults';

export interface BootstrapPayload {
  settings: SettingsState;
  defaults: DefaultsPayload;
  keys: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  customTabs: CustomTab[];
  selectedKeyType: string;
  currentMode: string;
  overlay: {
    visible: boolean;
    locked: boolean;
    anchor: string;
  };
  keyCounters: KeyCounters;
}
