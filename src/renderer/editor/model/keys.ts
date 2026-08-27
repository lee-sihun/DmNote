/**
 * 키 CRUD 및 스타일 변환 순수 함수
 * Store/React 의존 없음 — 입력과 출력만으로 다음 상태를 결정
 */

import type {
  KeyMappings,
  KeyPositions,
  KeyPosition,
  KeySlot,
  NoteColor,
  KeyCounterSettings,
  CounterAnimationBezier,
} from '@src/types/key/keys';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/key/keys';
import { newElementId } from './elementId';
import { cloneSlot } from '@utils/keySlot';

// ----------------------------------------------------------------------------
// 기본 키 포지션 생성
// ----------------------------------------------------------------------------

export function createDefaultKeyPosition(
  dx = 0,
  dy = 0,
): KeyPosition & { id: string } {
  return {
    id: newElementId(),
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
    noteGlowSyncPaint: false,
    noteGlowSize: 20,
    noteGlowOpacity: 70,
    noteGlowColor: '#FFFFFF',
    noteAutoYCorrection: true,
    className: '',
    fontWeight: 400,
    fontBold: true,
    counter: createDefaultCounterSettings(),
  } as KeyPosition & { id: string };
}

// ----------------------------------------------------------------------------
// 키 추가
// ----------------------------------------------------------------------------

export interface AddKeyResult {
  mappings: KeyMappings;
  positions: KeyPositions;
}

/** 키 추가 후 새 mappings/positions 반환 */
export function addKey(
  mappings: KeyMappings,
  positions: KeyPositions,
  mode: string,
  dx = 0,
  dy = 0,
): AddKeyResult {
  const mapping = mappings[mode] || [];
  const pos = positions[mode] || [];

  return {
    mappings: {
      ...mappings,
      [mode]: [...mapping, ''],
    },
    positions: {
      ...positions,
      [mode]: [...pos, createDefaultKeyPosition(dx, dy)],
    },
  };
}

// ----------------------------------------------------------------------------
// 키 삭제
// ----------------------------------------------------------------------------

/** 키 삭제 후 새 mappings/positions 반환 */
export function removeKey(
  mappings: KeyMappings,
  positions: KeyPositions,
  mode: string,
  index: number,
): AddKeyResult {
  const mapping = mappings[mode] || [];
  const pos = positions[mode] || [];

  return {
    mappings: {
      ...mappings,
      [mode]: mapping.filter((_, i) => i !== index),
    },
    positions: {
      ...positions,
      [mode]: pos.filter((_, i) => i !== index),
    },
  };
}

// ----------------------------------------------------------------------------
// 키 복제
// ----------------------------------------------------------------------------

/** 복제용 위치 클론: 새 신원 발급 + 참조 분리 + 좌표 반올림 + 기본값 백필 */
export function cloneKeyPositionForDuplicate(
  sourcePosition: KeyPosition,
  targetDx: number,
  targetDy: number,
): KeyPosition & { id: string } {
  const clonedNoteColor =
    sourcePosition.noteColor &&
    typeof sourcePosition.noteColor === 'object' &&
    sourcePosition.noteColor !== null
      ? { ...sourcePosition.noteColor }
      : sourcePosition.noteColor;

  const sourceCounter = sourcePosition.counter
    ? normalizeCounterSettings(sourcePosition.counter)
    : createDefaultCounterSettings();

  const clonedCounter: KeyCounterSettings = {
    ...sourceCounter,
    fill: { ...sourceCounter.fill },
    animation: {
      ...sourceCounter.animation,
      presetId: sourceCounter.animation.presetId ?? null,
      bezier: [
        Number(sourceCounter.animation.bezier[0]),
        Number(sourceCounter.animation.bezier[1]),
        Number(sourceCounter.animation.bezier[2]),
        Number(sourceCounter.animation.bezier[3]),
      ] as CounterAnimationBezier,
    },
  };

  return {
    ...sourcePosition,
    // 복제본은 새 신원. source id를 물려받으면 후보 안 중복으로 커밋이 거절된다
    id: newElementId(),
    dx: targetDx,
    dy: targetDy,
    counter: clonedCounter,
    noteColor: clonedNoteColor,
    noteGlowEnabled: sourcePosition.noteGlowEnabled ?? true,
    noteGlowSize: sourcePosition.noteGlowSize ?? 20,
    noteGlowOpacity: sourcePosition.noteGlowOpacity ?? 70,
    noteGlowColor: clonedNoteColor,
    noteAutoYCorrection: sourcePosition.noteAutoYCorrection ?? true,
  };
}

/** 키 복제 후 새 mappings/positions 반환 */
export function duplicateKey(
  mappings: KeyMappings,
  positions: KeyPositions,
  mode: string,
  sourceIndex: number,
  targetDx: number,
  targetDy: number,
): AddKeyResult | null {
  const mapping = mappings[mode] || [];
  const pos = positions[mode] || [];
  const sourceKey = mapping[sourceIndex];
  const sourcePosition = pos[sourceIndex];

  if (typeof sourceKey === 'undefined' || !sourcePosition) {
    return null;
  }

  const clonedPosition = cloneKeyPositionForDuplicate(
    sourcePosition,
    targetDx,
    targetDy,
  );

  return {
    mappings: {
      ...mappings,
      [mode]: [...mapping, cloneSlot(sourceKey)],
    },
    positions: {
      ...positions,
      [mode]: [...pos, clonedPosition],
    },
  };
}

// ----------------------------------------------------------------------------
// 위치 변경
// ----------------------------------------------------------------------------

/** 키 위치 변경 후 새 positions 반환 */
export function updateKeyPosition(
  positions: KeyPositions,
  mode: string,
  index: number,
  dx: number,
  dy: number,
): KeyPositions {
  const current = positions[mode] || [];
  return {
    ...positions,
    [mode]: current.map((pos, i) => (i === index ? { ...pos, dx, dy } : pos)),
  };
}

// ----------------------------------------------------------------------------
// 스타일 업데이트
// ----------------------------------------------------------------------------

/** 단일 키 스타일 업데이트 후 새 positions 반환 */
export function updateKeyStyle(
  positions: KeyPositions,
  mode: string,
  index: number,
  updates: Partial<KeyPosition>,
): KeyPositions {
  const current = positions[mode] || [];
  if (!current[index]) return positions;

  return {
    ...positions,
    [mode]: current.map((pos, i) =>
      i === index ? { ...pos, ...updates } : pos,
    ),
  };
}

// ----------------------------------------------------------------------------
// 노트 색상 업데이트
// ----------------------------------------------------------------------------

export interface NoteColorUpdates {
  noteColor: NoteColor;
  noteOpacity: number;
  noteGlowEnabled: boolean;
  noteGlowSize: number;
  noteGlowOpacity: number;
  noteGlowColor?: NoteColor;
  noteAutoYCorrection?: boolean;
  noteEffectEnabled?: boolean;
}

/** 노트 색상 업데이트 후 새 positions 반환 */
export function updateNoteColor(
  positions: KeyPositions,
  mode: string,
  index: number,
  updates: NoteColorUpdates,
): KeyPositions {
  const current = positions[mode] || [];
  if (!current[index]) return positions;

  return {
    ...positions,
    [mode]: current.map((pos, i) =>
      i === index
        ? {
            ...pos,
            noteColor: updates.noteColor,
            noteOpacity: updates.noteOpacity,
            noteGlowEnabled: updates.noteGlowEnabled,
            noteGlowSize: updates.noteGlowSize,
            noteGlowOpacity: updates.noteGlowOpacity,
            noteGlowColor: updates.noteGlowColor ?? updates.noteColor,
            ...(updates.noteAutoYCorrection !== undefined && {
              noteAutoYCorrection: updates.noteAutoYCorrection,
            }),
            ...(updates.noteEffectEnabled !== undefined && {
              noteEffectEnabled: updates.noteEffectEnabled,
            }),
          }
        : pos,
    ),
  };
}

// ----------------------------------------------------------------------------
// 카운터 설정 업데이트
// ----------------------------------------------------------------------------

/** 카운터 설정 업데이트 후 새 positions 반환 */
export function updateCounterSettings(
  positions: KeyPositions,
  mode: string,
  index: number,
  counter: KeyCounterSettings,
): KeyPositions {
  const current = positions[mode] || [];
  if (!current[index]) return positions;

  const normalized = normalizeCounterSettings(counter);
  return {
    ...positions,
    [mode]: current.map((pos, i) =>
      i === index ? { ...pos, counter: normalized } : pos,
    ),
  };
}

// ----------------------------------------------------------------------------
// 키 매핑 변경
// ----------------------------------------------------------------------------

/** 키 매핑 변경 후 새 mappings 반환 */
export function updateKeyMapping(
  mappings: KeyMappings,
  mode: string,
  index: number,
  newSlot: KeySlot,
): KeyMappings {
  const mapping = mappings[mode] || [];
  return {
    ...mappings,
    [mode]: mapping.map((key, i) => (i === index ? newSlot : key)),
  };
}
