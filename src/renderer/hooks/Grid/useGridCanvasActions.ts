/**
 * 캔버스 요소(stat/graph) CRUD 및 z-order 액션 훅
 * Grid.tsx에서 추출된 stat/graph 편집 로직
 */

import { newElementId } from '@src/renderer/editor/model/elementId';
import {
  addKeyAt,
  addGraphAt,
  addKnobAt,
  addStatAt,
  placeDuplicatedGraph,
  placeDuplicatedKey,
  placeDuplicatedKnob,
  placeDuplicatedStat,
} from '@src/renderer/editor/runtime/elementOps';
import type { FrozenKeyDuplicate } from '@src/renderer/editor/runtime/elementOps';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { KeySlot, KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
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

export interface CanvasActions {
  addKeyAtPosition: (dx: number, dy: number) => void;
  placeDuplicateKey: (
    frozen: FrozenKeyDuplicate,
    dx: number,
    dy: number,
  ) => void;
  // Stat 액션
  addStatAtPosition: (dx: number, dy: number) => void;
  beginDuplicateStat: (sourceIndex: number) => DuplicateState | null;
  placeDuplicateStat: (
    templatePosition: StatItemPosition,
    dx: number,
    dy: number,
  ) => void;
  // Graph 액션
  addGraphAtPosition: (dx: number, dy: number) => void;
  beginDuplicateGraph: (sourceIndex: number) => DuplicateState | null;
  placeDuplicateGraph: (
    templatePosition: GraphItemPosition,
    dx: number,
    dy: number,
  ) => void;
  // Knob 액션
  addKnobAtPosition: (dx: number, dy: number) => void;
  beginDuplicateKnob: (sourceIndex: number) => DuplicateState | null;
  placeDuplicateKnob: (
    templatePosition: KnobItemPosition,
    dx: number,
    dy: number,
  ) => void;
}

export interface DuplicateState {
  elementType: 'key' | 'stat' | 'graph' | 'knob';
  sourceIndex: number;
  // 키 복제의 시작 시점 동결 슬롯 - 배치 시 sourceIndex 재조회 금지
  slot?: KeySlot;
  keyName: string;
  position:
    | KeyPosition
    | StatItemPosition
    | GraphItemPosition
    | KnobItemPosition;
}

export type NativeCanvasElementType = 'key' | 'stat' | 'graph' | 'knob';

export const addCanvasElementAt = (
  actions: Pick<
    CanvasActions,
    | 'addKeyAtPosition'
    | 'addStatAtPosition'
    | 'addGraphAtPosition'
    | 'addKnobAtPosition'
  >,
  type: NativeCanvasElementType,
  dx: number,
  dy: number,
) => {
  if (type === 'key') actions.addKeyAtPosition(dx, dy);
  else if (type === 'stat') actions.addStatAtPosition(dx, dy);
  else if (type === 'graph') actions.addGraphAtPosition(dx, dy);
  else actions.addKnobAtPosition(dx, dy);
};

export const placeFrozenDuplicateAt = (
  actions: Pick<
    CanvasActions,
    | 'placeDuplicateKey'
    | 'placeDuplicateStat'
    | 'placeDuplicateGraph'
    | 'placeDuplicateKnob'
  >,
  duplicate: DuplicateState,
  dx: number,
  dy: number,
) => {
  if (duplicate.elementType === 'key') {
    if (typeof duplicate.slot === 'undefined') return false;
    actions.placeDuplicateKey(
      { slot: duplicate.slot, position: duplicate.position as KeyPosition },
      dx,
      dy,
    );
  } else if (duplicate.elementType === 'stat') {
    actions.placeDuplicateStat(duplicate.position as StatItemPosition, dx, dy);
  } else if (duplicate.elementType === 'graph') {
    actions.placeDuplicateGraph(
      duplicate.position as GraphItemPosition,
      dx,
      dy,
    );
  } else {
    actions.placeDuplicateKnob(duplicate.position as KnobItemPosition, dx, dy);
  }
  return true;
};

function getStatTypeLabel(type: string): string {
  if (type === 'kps') return 'KPS';
  if (type === 'kpsAvg') return 'AVG';
  if (type === 'kpsMax') return 'MAX';
  if (type === 'total') return 'Total';
  return String(type || '');
}

export function useGridCanvasActions(selectedKeyType: string): CanvasActions {
  const addKeyAtPosition = (dx: number, dy: number) => {
    void addKeyAt(selectedKeyType, dx, dy).catch(reportElementOpError);
  };

  const placeDuplicateKey = (
    frozen: FrozenKeyDuplicate,
    dx: number,
    dy: number,
  ) => {
    void placeDuplicatedKey(frozen, selectedKeyType, dx, dy).catch(
      reportElementOpError,
    );
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
    const maxZ = getMaxZIndex(selectedKeyType);
    void placeDuplicatedStat(
      selectedKeyType,
      templatePosition,
      dx,
      dy,
      maxZ + 1,
    ).catch(reportElementOpError);
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
    const maxZ = getMaxZIndex(selectedKeyType);
    void placeDuplicatedGraph(
      selectedKeyType,
      templatePosition,
      dx,
      dy,
      maxZ + 1,
    ).catch(reportElementOpError);
  };

  const addStatAtPosition = (dx: number, dy: number) => {
    const position: StatItemPosition & { id: string } = {
      id: newElementId(),
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
    };
    void addStatAt(selectedKeyType, position).catch(reportElementOpError);
  };

  const addGraphAtPosition = (dx: number, dy: number) => {
    const position: GraphItemPosition & { id: string } = {
      id: newElementId(),
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
    };
    void addGraphAt(selectedKeyType, position).catch(reportElementOpError);
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
    const maxZ = getMaxZIndex(selectedKeyType);
    void placeDuplicatedKnob(
      selectedKeyType,
      templatePosition,
      dx,
      dy,
      maxZ + 1,
    ).catch(reportElementOpError);
  };

  const addKnobAtPosition = (dx: number, dy: number) => {
    const position: KnobItemPosition & { id: string } = {
      id: newElementId(),
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
    };
    void addKnobAt(selectedKeyType, position).catch(reportElementOpError);
  };

  return {
    addKeyAtPosition,
    placeDuplicateKey,
    addStatAtPosition,
    beginDuplicateStat,
    placeDuplicateStat,
    addGraphAtPosition,
    beginDuplicateGraph,
    placeDuplicateGraph,
    addKnobAtPosition,
    beginDuplicateKnob,
    placeDuplicateKnob,
  };
}
