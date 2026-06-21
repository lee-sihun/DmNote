/**
 * 캔버스 요소(stat/graph) CRUD 및 z-order 액션 훅
 * Grid.tsx에서 추출된 stat/graph 편집 로직
 */

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useDialItemStore } from '@stores/data/useDialItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import type { KeyPosition } from '@src/types/key/keys';
import type {
  StatItemPosition,
  StatItemPositions,
} from '@src/types/key/statItems';
import type {
  GraphItemPosition,
  GraphItemPositions,
} from '@src/types/key/graphItems';
import type { DialItemPosition, DialItemPositions } from '@src/types/key/dials';
import type {
  KeyCounterSettings,
  CounterAnimationBezier,
} from '@src/types/key/keys';
import { createDefaultCounterSettings } from '@src/types/key/keys';

// 공통: zIndex 목록 수집
function collectAllZIndexes(mode: string) {
  const keyPos = useKeyStore.getState().positions[mode] || [];
  const keyZIndexes = keyPos.map((p, i) => p.zIndex ?? i);

  const statPos = useStatItemStore.getState().positions[mode] || [];
  const statZIndexes = statPos.map((p, i) => p.zIndex ?? i);

  const graphPos = useGraphItemStore.getState().positions[mode] || [];
  const graphZIndexes = graphPos.map((p, i) => p.zIndex ?? i);

  const dialPos = useDialItemStore.getState().positions[mode] || [];
  const dialZIndexes = dialPos.map((p, i) => p.zIndex ?? i);

  const pluginEls = usePluginDisplayElementStore.getState().elements;
  const pluginZIndexes = pluginEls
    .filter((el) => !el.tabId || el.tabId === mode)
    .map((el) => el.zIndex ?? 0);

  return {
    keyZIndexes,
    statZIndexes,
    graphZIndexes,
    dialZIndexes,
    pluginZIndexes,
  };
}

function getMaxZIndex(mode: string): number {
  const {
    keyZIndexes,
    statZIndexes,
    graphZIndexes,
    dialZIndexes,
    pluginZIndexes,
  } = collectAllZIndexes(mode);
  return Math.max(
    0,
    ...keyZIndexes,
    ...statZIndexes,
    ...graphZIndexes,
    ...dialZIndexes,
    ...pluginZIndexes,
  );
}

function getMinZIndex(mode: string): number {
  const {
    keyZIndexes,
    statZIndexes,
    graphZIndexes,
    dialZIndexes,
    pluginZIndexes,
  } = collectAllZIndexes(mode);
  return Math.min(
    0,
    ...keyZIndexes,
    ...statZIndexes,
    ...graphZIndexes,
    ...dialZIndexes,
    ...pluginZIndexes,
  );
}

// 히스토리 push 헬퍼
function pushHistorySnapshot(
  currentStatPositions: StatItemPositions,
  currentGraphPositions: GraphItemPositions,
) {
  const currentKeyPositions = useKeyStore.getState().positions;
  const currentPluginElements =
    usePluginDisplayElementStore.getState().elements;
  const { keyMappings: km } = useKeyStore.getState();
  useHistoryStore.getState().pushState({
    keyMappings: km,
    positions: currentKeyPositions,
    statPositions: currentStatPositions,
    graphPositions: currentGraphPositions,
    pluginElements: currentPluginElements,
  });
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
  try {
    window.api.bridge.sendTo('overlay', 'statPositions:sync', {
      positions: nextPositions,
    });
  } catch {
    /* 무시 */
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
  try {
    window.api.bridge.sendTo('overlay', 'graphPositions:sync', {
      positions: nextPositions,
    });
  } catch {
    /* 무시 */
  }
}

// Dial positions persist 헬퍼
async function persistDialPositions(
  nextPositions: DialItemPositions,
  errorMessage?: string,
): Promise<void> {
  const store = useDialItemStore.getState();
  store.setLocalUpdateInProgress(true);
  store.setPositions(nextPositions);
  try {
    await window.api.dialItems.updatePositions(nextPositions);
  } catch (error) {
    console.error(errorMessage || 'Failed to update dial items', error);
  } finally {
    store.setLocalUpdateInProgress(false);
  }
  try {
    window.api.bridge.sendTo('overlay', 'dialPositions:sync', {
      positions: nextPositions,
    });
  } catch {
    /* 무시 */
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
  // Dial 액션
  deleteDialAtIndex: (index: number) => void;
  moveDialToFront: (index: number) => void;
  moveDialToBack: (index: number) => void;
  moveDialForward: (index: number) => Promise<void>;
  moveDialBackward: (index: number) => Promise<void>;
  addDialAtPosition: (dx: number, dy: number) => void;
  beginDuplicateDial: (sourceIndex: number) => DuplicateState | null;
  placeDuplicateDial: (
    templatePosition: DialItemPosition,
    dx: number,
    dy: number,
  ) => void;
  // persist 헬퍼 (Grid에서 직접 사용)
  persistStatPositions: typeof persistStatPositions;
  persistGraphPositions: typeof persistGraphPositions;
  persistDialPositions: typeof persistDialPositions;
  pushHistorySnapshot: typeof pushHistorySnapshot;
}

export interface DuplicateState {
  elementType: 'key' | 'stat' | 'graph' | 'dial';
  sourceIndex: number;
  keyName: string;
  position:
    | KeyPosition
    | StatItemPosition
    | GraphItemPosition
    | DialItemPosition;
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

    pushHistorySnapshot(current, useGraphItemStore.getState().positions);

    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.filter((_, idx) => idx !== indexToDelete),
    };
    persistStatPositions(nextPositions, 'Failed to delete stat item');
  };

  const moveStatToFront = (index: number) => {
    const store = useStatItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;

    pushHistorySnapshot(current, useGraphItemStore.getState().positions);
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

    pushHistorySnapshot(current, useGraphItemStore.getState().positions);
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

    pushHistorySnapshot(current, useGraphItemStore.getState().positions);
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

    pushHistorySnapshot(current, useGraphItemStore.getState().positions);
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

    pushHistorySnapshot(current, useGraphItemStore.getState().positions);
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

    pushHistorySnapshot(useStatItemStore.getState().positions, current);

    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.filter((_, idx) => idx !== indexToDelete),
    };
    persistGraphPositions(nextPositions, 'Failed to delete graph item');
  };

  const moveGraphToFront = (index: number) => {
    const store = useGraphItemStore.getState();
    const current = store.positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;

    pushHistorySnapshot(useStatItemStore.getState().positions, current);
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

    pushHistorySnapshot(useStatItemStore.getState().positions, current);
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

    pushHistorySnapshot(useStatItemStore.getState().positions, current);
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

    pushHistorySnapshot(useStatItemStore.getState().positions, current);
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

    pushHistorySnapshot(useStatItemStore.getState().positions, current);
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
    pushHistorySnapshot(current, useGraphItemStore.getState().positions);

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
      noteOpacity: 80,
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
    pushHistorySnapshot(useStatItemStore.getState().positions, current);

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
      noteOpacity: 80,
      noteAlignment: 'center',
      noteEffectEnabled: true,
      noteGlowEnabled: false,
      noteGlowSize: 20,
      noteGlowOpacity: 70,
      noteGlowColor: '#FFFFFF',
      noteAutoYCorrection: true,
      className: '',
      counter: createDefaultCounterSettings(),
      backgroundColor: 'rgba(46, 46, 47, 0.9)',
      borderColor: 'rgba(113, 113, 113, 0.9)',
      borderWidth: 3,
      borderRadius: 10,
      fontColor: '#FFFFFF',
      activeFontColor: '#FFFFFF',
      fontSize: 12,
      useInlineStyles: false,
      displayText: '',
    });

    const nextPositions = { ...current, [selectedKeyType]: list };
    persistGraphPositions(nextPositions, 'Failed to add graph item');
  };

  // 다이얼 히스토리 스냅샷 (현재 stat/graph 캡처)
  const pushDialHistory = () =>
    pushHistorySnapshot(
      useStatItemStore.getState().positions,
      useGraphItemStore.getState().positions,
    );

  const deleteDialAtIndex = (indexToDelete: number) => {
    const current = useDialItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[indexToDelete]) return;
    pushDialHistory();
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.filter((_, idx) => idx !== indexToDelete),
    };
    persistDialPositions(nextPositions, 'Failed to delete dial item');
  };

  const moveDialToFront = (index: number) => {
    const current = useDialItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;
    pushDialHistory();
    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: maxZ + 1 } : p,
      ),
    };
    persistDialPositions(nextPositions, 'Failed to move dial item to front');
  };

  const moveDialForward = async (index: number) => {
    const current = useDialItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;
    pushDialHistory();
    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex + 1 } : p,
      ),
    };
    await persistDialPositions(
      updatedPositions,
      'Failed to move dial item forward',
    );
  };

  const moveDialBackward = async (index: number) => {
    const current = useDialItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    const target = tabPositions[index];
    if (!target) return;
    pushDialHistory();
    const currentZIndex = target.zIndex ?? index;
    const updatedPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: currentZIndex - 1 } : p,
      ),
    };
    await persistDialPositions(
      updatedPositions,
      'Failed to move dial item backward',
    );
  };

  const moveDialToBack = (index: number) => {
    const current = useDialItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    if (!tabPositions[index]) return;
    pushDialHistory();
    const minZ = getMinZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: tabPositions.map((p, i) =>
        i === index ? { ...p, zIndex: minZ - 1 } : p,
      ),
    };
    persistDialPositions(nextPositions, 'Failed to move dial item to back');
  };

  const beginDuplicateDial = (sourceIndex: number): DuplicateState | null => {
    const current = useDialItemStore.getState().positions;
    const position = current?.[selectedKeyType]?.[sourceIndex] || null;
    if (!position) return null;
    return {
      elementType: 'dial',
      sourceIndex,
      keyName: 'Dial',
      position: { ...position },
    };
  };

  const placeDuplicateDial = (
    templatePosition: DialItemPosition,
    dx: number,
    dy: number,
  ) => {
    if (!templatePosition) return;
    const current = useDialItemStore.getState().positions;
    const tabPositions = current[selectedKeyType] || [];
    pushDialHistory();
    const maxZ = getMaxZIndex(selectedKeyType);
    const nextPositions = {
      ...current,
      [selectedKeyType]: [
        ...tabPositions,
        { ...templatePosition, dx, dy, zIndex: maxZ + 1 },
      ],
    };
    persistDialPositions(nextPositions, 'Failed to duplicate dial item');
  };

  const addDialAtPosition = (dx: number, dy: number) => {
    const current = useDialItemStore.getState().positions;
    pushDialHistory();
    const list = [...(current[selectedKeyType] || [])];
    list.push({
      axisId: '',
      sensitivity: 1.40625,
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
      noteOpacity: 80,
      noteAlignment: 'center',
      noteEffectEnabled: false,
      noteGlowEnabled: false,
      noteGlowSize: 20,
      noteGlowOpacity: 70,
      noteGlowColor: '#FFFFFF',
      noteAutoYCorrection: true,
      className: '',
      counter: createDefaultCounterSettings(),
      backgroundColor: 'rgba(46, 46, 47, 0.9)',
      borderColor: 'rgba(113, 113, 113, 0.9)',
      borderWidth: 3,
    });
    const nextPositions = { ...current, [selectedKeyType]: list };
    persistDialPositions(nextPositions, 'Failed to add dial item');
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
    deleteDialAtIndex,
    moveDialToFront,
    moveDialToBack,
    moveDialForward,
    moveDialBackward,
    addDialAtPosition,
    beginDuplicateDial,
    placeDuplicateDial,
    persistStatPositions,
    persistGraphPositions,
    persistDialPositions,
    pushHistorySnapshot,
  };
}
