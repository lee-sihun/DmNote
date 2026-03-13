import { create } from 'zustand';
import { getCounterCacheSnapshot } from '@stores/signals/keyCounterCache';
import { useKeyStore } from '@stores/data/useKeyStore';
import type {
  CustomTab,
  KeyCounters,
  KeyMappings,
  KeyPositions,
} from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { LayerGroups } from '@src/types/layerGroups';

// 플러그인 요소의 히스토리 저장용 직렬화 타입 (함수 핸들러 제외)
type SerializablePluginElement = Omit<
  PluginDisplayElementInternal,
  'onClick' | 'onPositionChange' | 'onDelete' | 'contextMenu'
>;

export interface HistoryState {
  keyMappings: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  pluginElements?: SerializablePluginElement[];
  layerGroups?: LayerGroups;
  keyCounters: KeyCounters;
  customTabs: CustomTab[];
  selectedKeyType: string;
}

export interface PushHistoryInput {
  keyMappings: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  pluginElements?: PluginDisplayElementInternal[];
  layerGroups?: LayerGroups;
  keyCounters?: KeyCounters;
  customTabs?: CustomTab[];
  selectedKeyType?: string;
}

interface CurrentStateInput {
  keyMappings: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  pluginElements?: PluginDisplayElementInternal[];
  layerGroups?: LayerGroups;
}

interface HistoryStore {
  past: HistoryState[];
  future: HistoryState[];
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushState: (input: PushHistoryInput) => void;
  undo: (current: CurrentStateInput) => HistoryState | null;
  redo: (current: CurrentStateInput) => HistoryState | null;
  clear: () => void;
  clearFuture: () => void;
}

const MAX_HISTORY_SIZE = 50;

// 플러그인 요소를 직렬화 가능한 형태로 변환 (함수 핸들러 제외)
function serializePluginElements(
  elements: PluginDisplayElementInternal[],
): SerializablePluginElement[] {
  return elements.map((el) => {
    // 함수 핸들러와 contextMenu 제외한 순수 데이터만 복사
    const {
      onClick: _onClick,
      onPositionChange: _onPositionChange,
      onDelete: _onDelete,
      contextMenu: _contextMenu,
      _onClickId,
      _onPositionChangeId,
      _onDeleteId,
      ...serializableData
    } = el;
    return JSON.parse(JSON.stringify(serializableData));
  });
}

function buildHistoryState(
  input: PushHistoryInput | CurrentStateInput,
  includeCounters: boolean,
): HistoryState {
  // customTabs/selectedKeyType: 명시적 제공 시 사용, 없으면 현재 store에서 자동 캡처
  const keyState = useKeyStore.getState();
  const tabs =
    ('customTabs' in input && input.customTabs) || keyState.customTabs;
  const selectedKeyType =
    ('selectedKeyType' in input && input.selectedKeyType) ||
    keyState.selectedKeyType;

  return {
    keyMappings: JSON.parse(JSON.stringify(input.keyMappings)),
    positions: JSON.parse(JSON.stringify(input.positions)),
    statPositions: JSON.parse(JSON.stringify(input.statPositions)),
    graphPositions: JSON.parse(JSON.stringify(input.graphPositions)),
    pluginElements: input.pluginElements
      ? serializePluginElements(input.pluginElements)
      : undefined,
    layerGroups: input.layerGroups
      ? JSON.parse(JSON.stringify(input.layerGroups))
      : undefined,
    keyCounters:
      includeCounters && 'keyCounters' in input && input.keyCounters
        ? JSON.parse(JSON.stringify(input.keyCounters))
        : getCounterCacheSnapshot(),
    customTabs: JSON.parse(JSON.stringify(tabs)),
    selectedKeyType,
  };
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  pushState: (input: PushHistoryInput) => {
    set((state) => {
      const newState = buildHistoryState(input, true);

      const newPast = [...state.past, newState];
      // 최대 히스토리 크기 유지
      if (newPast.length > MAX_HISTORY_SIZE) {
        newPast.shift();
      }

      return {
        past: newPast,
        future: [], // 새로운 상태 추가 시 future 초기화
      };
    });
  },

  undo: (current: CurrentStateInput) => {
    const state = get();
    if (state.past.length === 0) return null;

    const previous = state.past[state.past.length - 1];
    const newPast = state.past.slice(0, -1);

    const currentState = buildHistoryState(current, false);

    set({
      past: newPast,
      future: [...state.future, currentState],
    });

    return previous;
  },

  redo: (current: CurrentStateInput) => {
    const state = get();
    if (state.future.length === 0) return null;

    const next = state.future[state.future.length - 1];
    const newFuture = state.future.slice(0, -1);

    const currentState = buildHistoryState(current, false);

    set({
      past: [...state.past, currentState],
      future: newFuture,
    });

    return next;
  },

  clear: () => {
    set({ past: [], future: [] });
  },

  clearFuture: () => {
    set({ future: [] });
  },
}));
