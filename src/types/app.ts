import { SettingsState } from "@src/types/settings";
import {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from "@src/types/keys";
import type { StatItemPositions } from "@src/types/statItems";

export interface BootstrapPayload {
  settings: SettingsState;
  keys: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
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
