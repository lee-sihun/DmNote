import { create } from 'zustand';
import { getCounterSnapshot } from '@stores/keyCounterSignals';
import type { KeyCounters, KeyMappings, KeyPositions } from '@src/types/keys';
import type { PluginDisplayElementInternal } from '@src/types/api';
import type { StatItemPositions } from '@src/types/statItems';
import type { GraphItemPositions } from '@src/types/graphItems';
import type { LayerGroups } from '@src/types/layerGroups';

// 플러그인 요소의 히스토리 저장용 직렬화 타입 (함수 핸들러 제외)
type SerializablePluginElement = Omit<
  PluginDisplayElementInternal,
  'onClick' | 'onPositionChange' | 'onDelete' | 'contextMenu'
>;

interface HistoryState {
  keyMappings: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  pluginElements?: SerializablePluginElement[];
  layerGroups?: LayerGroups;
  keyCounters: KeyCounters;
}

interface HistoryStore {
  past: HistoryState[];
  future: HistoryState[];
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushState: (
    keyMappings: KeyMappings,
    positions: KeyPositions,
    statPositions: StatItemPositions,
    graphPositions: GraphItemPositions,
    pluginElements?: PluginDisplayElementInternal[],
    layerGroups?: LayerGroups,
    keyCounters?: KeyCounters,
  ) => void;
  undo: (
    currentKeyMappings: KeyMappings,
    currentPositions: KeyPositions,
    currentStatPositions: StatItemPositions,
    currentGraphPositions: GraphItemPositions,
    currentPluginElements?: PluginDisplayElementInternal[],
    currentLayerGroups?: LayerGroups,
  ) => HistoryState | null;
  redo: (
    currentKeyMappings: KeyMappings,
    currentPositions: KeyPositions,
    currentStatPositions: StatItemPositions,
    currentGraphPositions: GraphItemPositions,
    currentPluginElements?: PluginDisplayElementInternal[],
    currentLayerGroups?: LayerGroups,
  ) => HistoryState | null;
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
      onClick,
      onPositionChange,
      onDelete,
      contextMenu,
      _onClickId,
      _onPositionChangeId,
      _onDeleteId,
      ...serializableData
    } = el;
    return JSON.parse(JSON.stringify(serializableData));
  });
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  pushState: (
    keyMappings: KeyMappings,
    positions: KeyPositions,
    statPositions: StatItemPositions,
    graphPositions: GraphItemPositions,
    pluginElements?: PluginDisplayElementInternal[],
    layerGroups?: LayerGroups,
    keyCounters?: KeyCounters,
  ) => {
    set((state) => {
      const newState: HistoryState = {
        keyMappings: JSON.parse(JSON.stringify(keyMappings)),
        positions: JSON.parse(JSON.stringify(positions)),
        statPositions: JSON.parse(JSON.stringify(statPositions)),
        graphPositions: JSON.parse(JSON.stringify(graphPositions)),
        pluginElements: pluginElements
          ? serializePluginElements(pluginElements)
          : undefined,
        layerGroups: layerGroups
          ? JSON.parse(JSON.stringify(layerGroups))
          : undefined,
        keyCounters: keyCounters
          ? JSON.parse(JSON.stringify(keyCounters))
          : getCounterSnapshot(),
      };

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

  undo: (
    currentKeyMappings: KeyMappings,
    currentPositions: KeyPositions,
    currentStatPositions: StatItemPositions,
    currentGraphPositions: GraphItemPositions,
    currentPluginElements?: PluginDisplayElementInternal[],
    currentLayerGroups?: LayerGroups,
  ) => {
    const state = get();
    if (state.past.length === 0) return null;

    const previous = state.past[state.past.length - 1];
    const newPast = state.past.slice(0, -1);

    // 현재 상태를 future에 저장
    const currentState: HistoryState = {
      keyMappings: JSON.parse(JSON.stringify(currentKeyMappings)),
      positions: JSON.parse(JSON.stringify(currentPositions)),
      statPositions: JSON.parse(JSON.stringify(currentStatPositions)),
      graphPositions: JSON.parse(JSON.stringify(currentGraphPositions)),
      pluginElements: currentPluginElements
        ? serializePluginElements(currentPluginElements)
        : undefined,
      layerGroups: currentLayerGroups
        ? JSON.parse(JSON.stringify(currentLayerGroups))
        : undefined,
      keyCounters: getCounterSnapshot(),
    };

    set({
      past: newPast,
      future: [...state.future, currentState],
    });

    return previous;
  },

  redo: (
    currentKeyMappings: KeyMappings,
    currentPositions: KeyPositions,
    currentStatPositions: StatItemPositions,
    currentGraphPositions: GraphItemPositions,
    currentPluginElements?: PluginDisplayElementInternal[],
    currentLayerGroups?: LayerGroups,
  ) => {
    const state = get();
    if (state.future.length === 0) return null;

    const next = state.future[state.future.length - 1];
    const newFuture = state.future.slice(0, -1);

    // 현재 상태를 past에 저장
    const currentState: HistoryState = {
      keyMappings: JSON.parse(JSON.stringify(currentKeyMappings)),
      positions: JSON.parse(JSON.stringify(currentPositions)),
      statPositions: JSON.parse(JSON.stringify(currentStatPositions)),
      graphPositions: JSON.parse(JSON.stringify(currentGraphPositions)),
      pluginElements: currentPluginElements
        ? serializePluginElements(currentPluginElements)
        : undefined,
      layerGroups: currentLayerGroups
        ? JSON.parse(JSON.stringify(currentLayerGroups))
        : undefined,
      keyCounters: getCounterSnapshot(),
    };

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
