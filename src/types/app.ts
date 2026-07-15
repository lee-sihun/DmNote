import { SettingsState } from '@src/types/settings/settings';
import {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
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
  knobPositions: KnobItemPositions;
  customTabs: CustomTab[];
  selectedKeyType: string;
  currentMode: string;
  // 부트스트랩 시점에 눌려 있던 키 (오버레이 지연 생성 시 DOWN 상태 복원용)
  activeKeys: string[];
  overlay: {
    visible: boolean;
    locked: boolean;
    anchor: string;
  };
  keyCounters: KeyCounters;
  layerGroups: LayerGroups;
  tabNoteOverrides: TabNoteOverrides;
  tabCssOverrides: TabCssOverrides;
  editorRevision: number;
}
