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
import type { SpritePositions } from '@src/types/key/sprites';
import type { DefaultsPayload } from '@src/renderer/defaults';
import type { LayerGroups } from '@src/types/layerGroups';
import type { TabNoteOverrides } from '@src/types/settings/noteSettings';
import type { TabCssOverrides } from '@src/types/plugin/css';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

export interface BootstrapPayload {
  settings: SettingsState;
  defaults: DefaultsPayload;
  keys: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  spritePositions: SpritePositions;
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
  keyCountersSessionId: string;
  keyCountersRevision: number;
  layerGroups: LayerGroups;
  tabNoteOverrides: TabNoteOverrides;
  tabCssOverrides: TabCssOverrides;
  editorRevision: number;
}

export interface CanonicalBootstrapPayload
  extends Omit<
    BootstrapPayload,
    | 'positions'
    | 'statPositions'
    | 'graphPositions'
    | 'knobPositions'
    | 'spritePositions'
  > {
  positions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
}
