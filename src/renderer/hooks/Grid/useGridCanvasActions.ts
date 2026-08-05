/**
 * 캔버스 요소(stat/graph) CRUD 및 z-order 액션 훅
 * Grid.tsx에서 추출된 stat/graph 편집 로직
 */

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { reconcileSelectionAfterIndexedElementDeletion } from '@stores/grid/useGridSelectionStore';
import type { KeyPosition } from '@src/types/key/keys';
import type {
  StatItemPosition,
  StatItemPositions,
} from '@src/types/key/statItems';
import type {
  GraphItemPosition,
  GraphItemPositions,
} from '@src/types/key/graphItems';
import type { KnobItemPosition, KnobItemPositions } from '@src/types/key/knobs';
import type {
  KeyCounterSettings,
  CounterAnimationBezier,
} from '@src/types/key/keys';
import { createDefaultCounterSettings } from '@src/types/key/keys';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_HAIRLINE,
  DEFAULT_ELEMENT_RADIUS,
} from '@utils/core/elementDefaults';

// 공통: zIndex 목록 수집 - 결과가 persist되는 z 계산에 쓰이므로 canonical 기준
function collectAllZIndexes(mode: string) {
  const keyPos = useKeyStore.getState().canonicalPositions[mode] || [];
  const keyZIndexes = keyPos.map((p, i) => p.zIndex ?? i);

  const statPos = useStatItemStore.getState().positions[mode] || [];
  const statZIndexes = statPos.map((p, i) => p.zIndex ?? i);

  const graphPos = useGraphItemStore.getState().positions[mode] || [];
  const graphZIndexes = graphPos.map((p, i) => p.zIndex ?? i);

  const knobPos = useKnobItemStore.getState().positions[mode] || [];
  const knobZIndexes = knobPos.map((p, i) => p.zIndex ?? i);

  const pluginEls = usePluginDisplayElementStore.getState().elements;
  const pluginZIndexes = pluginEls
    .filter((el) => !el.tabId || el.tabId === mode)
    .map((el) => el.zIndex ?? 0);

  return {
    keyZIndexes,
    statZIndexes,
    graphZIndexes,
    knobZIndexes,
    pluginZIndexes,
  };
}

function getMaxZIndex(mode: string): number {
  const {
    keyZIndexes,
    statZIndexes,
    graphZIndexes,
    knobZIndexes,
    pluginZIndexes,
  } = collectAllZIndexes(mode);
  return Math.max(
    0,
    ...keyZIndexes,
    ...statZIndexes,
    ...graphZIndexes,
    ...knobZIndexes,
    ...pluginZIndexes,
  );
}

function getMinZIndex(mode: string): number {
  const {
    keyZIndexes,
    statZIndexes,
    graphZIndexes,
    knobZIndexes,
    pluginZIndexes,
  } = collectAllZIndexes(mode);
  return Math.min(
    0,
    ...keyZIndexes,
    ...statZIndexes,
    ...graphZIndexes,
    ...knobZIndexes,
    ...pluginZIndexes,
  );
}

// Stat positions persist 헬퍼
async function persistStatPositions(
  nextPositions: StatItemPositions,
  errorMessage?: string,
): Promise<void> {
  const store = useStatItemStore.getState();
  store.setLocalUpdateInProgress(true);
  store.setPositions(nextPositions);
  try {
    await window.api.statItems.updatePositions(nextPositions);
  } catch (error) {
    console.error(errorMessage || 'Failed to update stat items', error);
  } finally {
    store.setLocalUpdateInProgress(false);
  }
}

// Graph positions persist 헬퍼
async function persistGraphPositions(
  nextPositions: GraphItemPositions,
  errorMessage?: string,
): Promise<void> {
  const store = useGraphItemStore.getState();
  store.setLocalUpdateInProgress(true);
  store.setPositions(nextPositions);
  try {
    await window.api.graphItems.updatePositions(nextPositions);
  } catch (error) {
    console.error(errorMessage || 'Failed to update graph items', error);
  } finally {
    store.setLocalUpdateInProgress(false);
  }
}

// Knob positions persist 헬퍼
async function persistKnobPositions(
  nextPositions: KnobItemPositions,
  errorMessage?: string,
): Promise<void> {
  const store = useKnobItemStore.getState();
  store.setLocalUpdateInProgress(true);
  store.setPositions(nextPositions);
  try {
    await window.api.knobItems.updatePositions(nextPositions);
  } catch (error) {
    console.error(errorMessage || 'Failed to update knob items', error);
  } finally {
    store.setLocalUpdateInProgress(false);
  }
}

export interface CanvasActions {
  // Stat 액션
  deleteStatAtIndex: (index: number) => void;
  moveStatToFront: (index: number) => void;
  moveStatToBack: (index: number) => void;
  moveStatForward: (index: number) => Promise<void>;
  moveStatBackward: (index: number) => Promise<void>;
  addStatAtPosition: (dx: number, dy: number) => void;
  beginDuplicateStat: (sourceIndex: number) => DuplicateState | null;
  placeDuplicateStat: (
    templatePosition: StatItemPosition,
    dx: number,
    dy: number,
  ) => void;
  // Graph 액션
  deleteGraphAtIndex: (index: number) => void;
  moveGraphToFront: (index: number) => void;
  moveGraphToBack: (index: number) => void;
  moveGraphForward: (index: number) => Promise<void>;
  moveGraphBackward: (index: number) => Promise<void>;
  addGraphAtPosition: (dx: number, dy: number) => void;
  beginDuplicateGraph: (sourceIndex: number) => DuplicateState | null;
  placeDuplicateGraph: (
    templatePosition: GraphItemPosition,
    dx: number,
    dy: number,
  ) => void;
  // Knob 액션
  deleteKnobAtIndex: (index: number) => void;
  moveKnobToFront: (index: number) => void;
  moveKnobToBack: (index: number) => void;
  moveKnobForward: (index: number) => Promise<void>;
  moveKnobBackward: (index: number) => Promise<void>;
  addKnobAtPosition: (dx: number, dy: number) => void;
  beginDuplicateKnob: (sourceIndex: number) => DuplicateState | null;
  placeDuplicateKnob: (
    templatePosition: KnobItemPosition,
    dx: number,
    dy: number,
  ) => void;
  // persist 헬퍼 (Grid에서 직접 사용)
  persistStatPositions: typeof persistStatPositions;
  persistGraphPositions: typeof persistGraphPositions;
  persistKnobPositions: typeof persistKnobPositions;
}

export interface DuplicateState {
  elementType: 'key' | 'stat' | 'graph' | 'knob';
  sourceIndex: number;
  keyName: string;
  position:
    | KeyPosition
    | StatItemPosition
    | GraphItemPosition
    | KnobItemPosition;
}

function getStatTypeLabel(type: string): string {
  if (type === 'kps') return 'KPS';
  if (type === 'kpsAvg') return 'AVG';
  if (type === 'kpsMax') return 'MAX';
  if (type === 'total') return 'Total';
  return String(type || '');
}

export function useGridCanvasActions(selectedKeyType: string): CanvasActions {
  const deleteStatAtIndex = (indexToDelete: number) => {
    const store = useStatItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[indexToDelete]) return;

    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.filter((_, idx) => idx !== indexToDelete),
    };
    persistStatPositions(nextPositions, 'Failed to delete stat item');
    reconcileSelectionAfterIndexedElementDeletion('stat', indexToDelete);
  };

  const moveStatToFront = (index: number) => {
    const store = useStatItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;

    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: maxZ + 1 } : p,
      ),
    };
    persistStatPositions(nextPositions, 'Failed to move stat item to front');
  };

  const moveStatForward = async (index: number) => {
    const store = useStatItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;

    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex + 1 } : p,
      ),
    };
    await persistStatPositions(
      updatedPositions,
      'Failed to move stat item forward',
    );
  };

  const moveStatBackward = async (index: number) => {
    const store = useStatItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;

    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex - 1 } : p,
      ),
    };
    await persistStatPositions(
      updatedPositions,
      'Failed to move stat item backward',
    );
  };

  const moveStatToBack = (index: number) => {
    const store = useStatItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;

    const minZ = getMinZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: minZ - 1 } : p,
      ),
    };
    persistStatPositions(nextPositions, 'Failed to move stat item to back');
  };

  const beginDuplicateStat = (sourceIndex: number): DuplicateState | null => {
    const current = useStatItemStore.getState().positions;
    const position = current?.[selectedKeyType]?.[sourceIndex] || null;
    if (!position) return null;

    const clonedNoteColor =
      position.noteColor &&
      typeof position.noteColor === 'object' &&
      position.noteColor !== null
        ? { ...position.noteColor }
        : position.noteColor;

    const clonedCounter: KeyCounterSettings | null = position.counter
      ? {
          ...position.counter,
          fill: { ...position.counter.fill },
          stroke: { ...position.counter.stroke },
          ...(position.counter.animation
            ? {
                animation: {
                  ...position.counter.animation,
                  bezier: [
                    ...position.counter.animation.bezier,
                  ] as CounterAnimationBezier,
                },
              }
            : {}),
        }
      : null;

    return {
      elementType: 'stat',
      sourceIndex,
      keyName: getStatTypeLabel(position.statType),
      position: {
        ...position,
        noteColor: clonedNoteColor,
        counter: clonedCounter ?? createDefaultCounterSettings(),
      },
    };
  };

  const placeDuplicateStat = (
    templatePosition: StatItemPosition,
    dx: number,
    dy: number,
  ) => {
    if (!templatePosition) return;
    const store = useStatItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];

    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: [
        ...tabPositions,
        { ...templatePosition, dx, dy, zIndex: maxZ + 1 },
      ],
    };
    persistStatPositions(nextPositions, 'Failed to duplicate stat item');
  };

  const deleteGraphAtIndex = (indexToDelete: number) => {
    const store = useGraphItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[indexToDelete]) return;

    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.filter((_, idx) => idx !== indexToDelete),
    };
    persistGraphPositions(nextPositions, 'Failed to delete graph item');
    reconcileSelectionAfterIndexedElementDeletion('graph', indexToDelete);
  };

  const moveGraphToFront = (index: number) => {
    const store = useGraphItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;

    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: maxZ + 1 } : p,
      ),
    };
    persistGraphPositions(nextPositions, 'Failed to move graph item to front');
  };

  const moveGraphForward = async (index: number) => {
    const store = useGraphItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;

    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex + 1 } : p,
      ),
    };
    await persistGraphPositions(
      updatedPositions,
      'Failed to move graph item forward',
    );
  };

  const moveGraphBackward = async (index: number) => {
    const store = useGraphItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;

    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex - 1 } : p,
      ),
    };
    await persistGraphPositions(
      updatedPositions,
      'Failed to move graph item backward',
    );
  };

  const moveGraphToBack = (index: number) => {
    const store = useGraphItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;

    const minZ = getMinZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: minZ - 1 } : p,
      ),
    };
    persistGraphPositions(nextPositions, 'Failed to move graph item to back');
  };

  const beginDuplicateGraph = (sourceIndex: number): DuplicateState | null => {
    const current = useGraphItemStore.getState().positions;
    const position = current?.[selectedKeyType]?.[sourceIndex] || null;
    if (!position) return null;

    return {
      elementType: 'graph',
      sourceIndex,
      keyName: getStatTypeLabel(position.statType),
      position: { ...position },
    };
  };

  const placeDuplicateGraph = (
    templatePosition: GraphItemPosition,
    dx: number,
    dy: number,
  ) => {
    if (!templatePosition) return;
    const store = useGraphItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];

    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: [
        ...tabPositions,
        { ...templatePosition, dx, dy, zIndex: maxZ + 1 },
      ],
    };
    persistGraphPositions(nextPositions, 'Failed to duplicate graph item');
  };

  const addStatAtPosition = (dx: number, dy: number) => {
    const current = useStatItemStore.getState().positions;

    const list = [...(current[selectedKeyType] || [])];
    list.push({
      statType: 'kps',
      dx,
      dy,
      width: 60,
      height: 60,
      hidden: false,
      activeImage: '',
      inactiveImage: '',
      soundPath: '',
      soundVolume: 100,
      activeTransparent: false,
      idleTransparent: false,
      count: 0,
      noteColor: '#FFFFFF',
      noteOpacity: 90,
      noteAlignment: 'center',
      noteEffectEnabled: true,
      noteGlowEnabled: false,
      noteGlowSize: 20,
      noteGlowOpacity: 70,
      noteGlowColor: '#FFFFFF',
      noteAutoYCorrection: true,
      className: '',
      counter: createDefaultCounterSettings(),
    });

    const nextPositions = { ...current, [selectedKeyType]: list };
    persistStatPositions(nextPositions, 'Failed to add stat item');
  };

  const addGraphAtPosition = (dx: number, dy: number) => {
    const current = useGraphItemStore.getState().positions;

    const list = [...(current[selectedKeyType] || [])];
    list.push({
      statType: 'kps',
      graphType: 'line',
      graphSpeed: 1000,
      graphColor: '#86EFAC',
      showAvgLine: true,
      graphAnimationEnabled: true,
      dx,
      dy,
      width: 120,
      height: 60,
      hidden: false,
      activeImage: '',
      inactiveImage: '',
      soundPath: '',
      soundVolume: 100,
      activeTransparent: false,
      idleTransparent: false,
      count: 0,
      noteColor: '#FFFFFF',
      noteOpacity: 90,
      noteAlignment: 'center',
      noteEffectEnabled: true,
      noteGlowEnabled: false,
      noteGlowSize: 20,
      noteGlowOpacity: 70,
      noteGlowColor: '#FFFFFF',
      noteAutoYCorrection: true,
      className: '',
      counter: createDefaultCounterSettings(),
      backgroundColor: DEFAULT_ELEMENT_BG,
      borderColor: DEFAULT_ELEMENT_HAIRLINE,
      borderWidth: 1,
      borderRadius: DEFAULT_ELEMENT_RADIUS,
      fontColor: DEFAULT_ELEMENT_FONT,
      activeFontColor: DEFAULT_ELEMENT_FONT,
      fontSize: 12,
      useInlineStyles: false,
      displayText: '',
    });

    const nextPositions = { ...current, [selectedKeyType]: list };
    persistGraphPositions(nextPositions, 'Failed to add graph item');
  };

  const deleteKnobAtIndex = (indexToDelete: number) => {
    const current = useKnobItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[indexToDelete]) return;
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.filter((_, idx) => idx !== indexToDelete),
    };
    persistKnobPositions(nextPositions, 'Failed to delete knob item');
    reconcileSelectionAfterIndexedElementDeletion('knob', indexToDelete);
  };

  const moveKnobToFront = (index: number) => {
    const current = useKnobItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;
    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: maxZ + 1 } : p,
      ),
    };
    persistKnobPositions(nextPositions, 'Failed to move knob item to front');
  };

  const moveKnobForward = async (index: number) => {
    const current = useKnobItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;
    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex + 1 } : p,
      ),
    };
    await persistKnobPositions(
      updatedPositions,
      'Failed to move knob item forward',
    );
  };

  const moveKnobBackward = async (index: number) => {
    const current = useKnobItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;
    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex - 1 } : p,
      ),
    };
    await persistKnobPositions(
      updatedPositions,
      'Failed to move knob item backward',
    );
  };

  const moveKnobToBack = (index: number) => {
    const current = useKnobItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;
    const minZ = getMinZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: minZ - 1 } : p,
      ),
    };
    persistKnobPositions(nextPositions, 'Failed to move knob item to back');
  };

  const beginDuplicateKnob = (sourceIndex: number): DuplicateState | null => {
    const current = useKnobItemStore.getState().positions;
    const position = current?.[selectedKeyType]?.[sourceIndex] || null;
    if (!position) return null;
    return {
      elementType: 'knob',
      sourceIndex,
      keyName: 'Knob',
      position: { ...position },
    };
  };

  const placeDuplicateKnob = (
    templatePosition: KnobItemPosition,
    dx: number,
    dy: number,
  ) => {
    if (!templatePosition) return;
    const current = useKnobItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: [
        ...tabPositions,
        { ...templatePosition, dx, dy, zIndex: maxZ + 1 },
      ],
    };
    persistKnobPositions(nextPositions, 'Failed to duplicate knob item');
  };

  const addKnobAtPosition = (dx: number, dy: number) => {
    const current = useKnobItemStore.getState().positions;
    const list = [...(current[selectedKeyType] || [])];
    list.push({
      axisId: '',
      sensitivity: 1,
      reverse: false,
      dx,
      dy,
      width: 60,
      height: 60,
      hidden: false,
      activeImage: '',
      inactiveImage: '',
      activeTransparent: false,
      idleTransparent: false,
      count: 0,
      noteColor: '#FFFFFF',
      noteOpacity: 90,
      noteAlignment: 'center',
      noteEffectEnabled: false,
      noteGlowEnabled: false,
      noteGlowSize: 20,
      noteGlowOpacity: 70,
      noteGlowColor: '#FFFFFF',
      noteAutoYCorrection: true,
      className: '',
      counter: createDefaultCounterSettings(),
      backgroundColor: DEFAULT_ELEMENT_BG,
      activeBackgroundColor: DEFAULT_ELEMENT_ACTIVE_BG,
      borderColor: DEFAULT_ELEMENT_FONT,
      activeBorderColor: DEFAULT_ELEMENT_ACTIVE_FONT,
      borderWidth: 0,
    });
    const nextPositions = { ...current, [selectedKeyType]: list };
    persistKnobPositions(nextPositions, 'Failed to add knob item');
  };

  return {
    deleteStatAtIndex,
    moveStatToFront,
    moveStatToBack,
    moveStatForward,
    moveStatBackward,
    addStatAtPosition,
    beginDuplicateStat,
    placeDuplicateStat,
    deleteGraphAtIndex,
    moveGraphToFront,
    moveGraphToBack,
    moveGraphForward,
    moveGraphBackward,
    addGraphAtPosition,
    beginDuplicateGraph,
    placeDuplicateGraph,
    deleteKnobAtIndex,
    moveKnobToFront,
    moveKnobToBack,
    moveKnobForward,
    moveKnobBackward,
    addKnobAtPosition,
    beginDuplicateKnob,
    placeDuplicateKnob,
    persistStatPositions,
    persistGraphPositions,
    persistKnobPositions,
  };
}
