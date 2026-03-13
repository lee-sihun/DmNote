import { create } from 'zustand';
import { getCounterSnapshot } from '@stores/signals/keyCounterSignals';
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
  pushState: (input: PushHistoryInput) => Promise<void>;
  undo: (current: CurrentStateInput) => Promise<HistoryState | null>;
  redo: (current: CurrentStateInput) => Promise<HistoryState | null>;
  clear: () => void;
  clearFuture: () => void;
}

const MAX_HISTORY_SIZE = 50;
let historyQueue: Promise<void> = Promise.resolve();

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

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type HistoryStateBase = Omit<HistoryState, 'keyCounters'>;

function buildHistoryStateBase(
  input: PushHistoryInput | CurrentStateInput,
): HistoryStateBase {
  // customTabs/selectedKeyType: 명시적 제공 시 사용, 없으면 현재 store에서 자동 캡처
  const keyState = useKeyStore.getState();
  const tabs =
    ('customTabs' in input && input.customTabs) || keyState.customTabs;
  const selectedKeyType =
    ('selectedKeyType' in input && input.selectedKeyType) ||
    keyState.selectedKeyType;

  return {
    keyMappings: cloneJson(input.keyMappings),
    positions: cloneJson(input.positions),
    statPositions: cloneJson(input.statPositions),
    graphPositions: cloneJson(input.graphPositions),
    pluginElements: input.pluginElements
      ? serializePluginElements(input.pluginElements)
      : undefined,
    layerGroups: input.layerGroups
      ? cloneJson(input.layerGroups)
      : undefined,
    customTabs: cloneJson(tabs),
    selectedKeyType,
  };
}

async function getHistoryCounters(
  counters?: KeyCounters,
): Promise<KeyCounters> {
  if (counters) {
    return cloneJson(counters);
  }

  if (
    typeof window !== 'undefined' &&
    window.__dmn_window_type === 'main' &&
    window.api?.keys?.getCounters
  ) {
    try {
      const snapshot = await window.api.keys.getCounters();
      return cloneJson(snapshot);
    } catch (error) {
      console.error('Failed to fetch key counters for history', error);
    }
  }

  return cloneJson(getCounterSnapshot());
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  pushState: (input: PushHistoryInput) => {
    const baseState = buildHistoryStateBase(input);
    const providedCounters = input.keyCounters;

    const task = historyQueue.then(async () => {
      const newState: HistoryState = {
        ...baseState,
        keyCounters: await getHistoryCounters(providedCounters),
      };

      set((state) => {
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
    });

    historyQueue = task.catch(() => undefined);
    return task;
  },

  undo: async (current: CurrentStateInput) => {
    const currentStateBase = buildHistoryStateBase(current);

    const task = historyQueue.then(async () => {
      const state = get();
      if (state.past.length === 0) return null;

      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, -1);
      const currentState: HistoryState = {
        ...currentStateBase,
        keyCounters: await getHistoryCounters(),
      };

      set({
        past: newPast,
        future: [...state.future, currentState],
      });

      return previous;
    });

    historyQueue = task.then(() => undefined).catch(() => undefined);
    return task;
  },

  redo: async (current: CurrentStateInput) => {
    const currentStateBase = buildHistoryStateBase(current);

    const task = historyQueue.then(async () => {
      const state = get();
      if (state.future.length === 0) return null;

      const next = state.future[state.future.length - 1];
      const newFuture = state.future.slice(0, -1);
      const currentState: HistoryState = {
        ...currentStateBase,
        keyCounters: await getHistoryCounters(),
      };

      set({
        past: [...state.past, currentState],
        future: newFuture,
      });

      return next;
    });

    historyQueue = task.then(() => undefined).catch(() => undefined);
    return task;
  },

  clear: () => {
    set({ past: [], future: [] });
  },

  clearFuture: () => {
    set({ future: [] });
  },
}));
