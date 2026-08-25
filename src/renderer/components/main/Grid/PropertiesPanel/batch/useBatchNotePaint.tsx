/* eslint-disable react-hooks/set-state-in-effect */
// 피커 열림 게이트로 첫 대상 저장값을 로컬 상태에 동기화하는 패턴 (NoteTabContent와 동일)
import { useEffect, useRef, useState } from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import type { EditorNotePaintPropertyPatchV1 } from '@src/types/editor';
import {
  gradientToCss,
  hexRepresentative,
  toCanonicalGradient,
  type ColorModeValue,
  type GradientSpec,
} from '@src/types/color';
import {
  bodyInheritedGlowSpec,
  foldGradientOpacity,
  legacyNoteColorToSpec,
  notePaintShadowColor,
} from '@src/types/key/notePaint';
import { parseStrictStopColor } from '@src/types/color';
import { parseAlphaPercent } from '@utils/color/colorUtils';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  DEFAULT_NOTE_COLOR,
  coerceStrictStops,
  toNoteStopColor,
  toNoteHexColor,
} from '../notePaintColorUtils';

export type BatchNoteSurface = 'note' | 'glow' | 'border';

export interface BatchNoteSwatchDisplay {
  color?: string;
  image?: string;
  opacity?: number | { top: number; bottom: number };
  label: string;
  isMixed: boolean;
}

// 표시용 spec: 신형은 남은 저장 배율을 스톱 알파에 접어 제시하고(커밋 시 100으로
// 수렴), 구형 그라데이션은 §9-6 매핑으로 제시한다 (저장 불변). 접힌 spec을
// 비교하므로 legacy·신형의 실제 출력 차이도 Mixed로 잡힌다
const presentedBodySpec = (pos: KeyPosition): GradientSpec | null =>
  pos.noteGradient
    ? foldGradientOpacity(
        pos.noteGradient,
        typeof pos.noteOpacity === 'number' ? pos.noteOpacity : 100,
      )
    : legacyNoteColorToSpec(
        pos.noteColor,
        pos.noteOpacityTop ?? pos.noteOpacity ?? 80,
        pos.noteOpacityBottom ?? pos.noteOpacity ?? 80,
      );

const presentedGlowSpec = (pos: KeyPosition): GradientSpec | null => {
  if (pos.noteGlowGradient) {
    return foldGradientOpacity(
      pos.noteGlowGradient,
      typeof pos.noteGlowOpacity === 'number' ? pos.noteGlowOpacity : 100,
    );
  }
  const top = pos.noteGlowOpacityTop ?? pos.noteGlowOpacity ?? 70;
  const bottom = pos.noteGlowOpacityBottom ?? pos.noteGlowOpacity ?? 70;
  // 글로우 색이 없으면 렌더는 본체를 상속 - 신형 본체는 스톱·각도를 그대로 빌린다(§9-4)
  if (pos.noteGlowColor == null && pos.noteGradient) {
    return bodyInheritedGlowSpec(pos.noteGradient, top, bottom);
  }
  return legacyNoteColorToSpec(pos.noteGlowColor ?? pos.noteColor, top, bottom);
};

const presentedBorderSpec = (pos: KeyPosition): GradientSpec | null =>
  pos.noteBorderGradient
    ? foldGradientOpacity(pos.noteBorderGradient, pos.noteBorderOpacity ?? 100)
    : null;

// 그라데이션 → 단색 전환: 첫 스톱 알파가 단색 투명도가 된다 (없으면 폴백)
const stopAlphaPercent = (color: string, fallback: number): number => {
  const strict = toNoteStopColor(color);
  const parsed = strict ? parseStrictStopColor(strict) : null;
  return parsed ? Math.round(parsed.a * 100) : fallback;
};

const surfaceTable = {
  note: {
    presentedSpec: presentedBodySpec,
    storedSpec: (pos: KeyPosition) => pos.noteGradient ?? null,
    solid: (pos: KeyPosition) =>
      typeof pos.noteColor === 'string' ? pos.noteColor : DEFAULT_NOTE_COLOR,
    opacity: (pos: KeyPosition) =>
      typeof pos.noteOpacity === 'number' ? pos.noteOpacity : 80,
  },
  glow: {
    presentedSpec: presentedGlowSpec,
    storedSpec: (pos: KeyPosition) => pos.noteGlowGradient ?? null,
    solid: (pos: KeyPosition) => {
      const color = pos.noteGlowColor ?? pos.noteColor;
      return typeof color === 'string' ? color : DEFAULT_NOTE_COLOR;
    },
    opacity: (pos: KeyPosition) =>
      typeof pos.noteGlowOpacity === 'number' ? pos.noteGlowOpacity : 70,
  },
  border: {
    presentedSpec: presentedBorderSpec,
    storedSpec: (pos: KeyPosition) => pos.noteBorderGradient ?? null,
    solid: (pos: KeyPosition) => pos.noteBorderColor ?? '#FFFFFF',
    opacity: (pos: KeyPosition) => pos.noteBorderOpacity ?? 100,
  },
} as const;

interface UseBatchNotePaintOptions {
  /** 집계·편집 대상 (선택된 키 요소의 position, 선택 순서 유지) */
  positions: KeyPosition[];
  /** 현재 열린 노트 피커 표면 */
  open: BatchNoteSurface | null;
  /** 선택 구성 시그니처 - 형식 왕복 기억·세션 소유 키 */
  selectionKey: string;
  commitNotePaint?: (patch: EditorNotePaintPropertyPatchV1) => void;
  previewNotePaint?: (patch: EditorNotePaintPropertyPatchV1) => void;
}

/**
 * 배치 노트 본체·글로우·테두리의 GradientSpec 집계·편집 상태 (계획 §UI 배치 전환).
 * 단일 NoteTabContent와 같은 제시·커밋 규칙을 다중 id notePaint op로 흘린다.
 * 편집 시드는 기존 배치 규약대로 첫 대상 기준
 */
export const useBatchNotePaint = ({
  positions,
  open,
  selectionKey,
  commitNotePaint,
  previewNotePaint,
}: UseBatchNotePaintOptions) => {
  const first: KeyPosition | undefined = positions[0];

  const [noteSolid, setNoteSolid] = useState<string>(() =>
    first ? surfaceTable.note.solid(first) : DEFAULT_NOTE_COLOR,
  );
  const [glowSolid, setGlowSolid] = useState<string>(() =>
    first ? surfaceTable.glow.solid(first) : DEFAULT_NOTE_COLOR,
  );
  const [borderSolid, setBorderSolid] = useState<string>(() =>
    first ? surfaceTable.border.solid(first) : '#FFFFFF',
  );
  const [noteOpacity, setNoteOpacity] = useState<number>(() =>
    first ? surfaceTable.note.opacity(first) : 80,
  );
  const [glowOpacity, setGlowOpacity] = useState<number>(() =>
    first ? surfaceTable.glow.opacity(first) : 70,
  );
  const [borderOpacity, setBorderOpacity] = useState<number>(() =>
    first ? surfaceTable.border.opacity(first) : 100,
  );

  // 첫 대상 저장값 동기화 (피커가 닫혀있을 때만 - 드래그 중 충돌 방지)
  const firstNoteSolid = first ? surfaceTable.note.solid(first) : null;
  const firstGlowSolid = first ? surfaceTable.glow.solid(first) : null;
  const firstBorderSolid = first ? surfaceTable.border.solid(first) : null;
  const firstNoteOpacity = first ? surfaceTable.note.opacity(first) : null;
  const firstGlowOpacity = first ? surfaceTable.glow.opacity(first) : null;
  const firstBorderOpacity = first ? surfaceTable.border.opacity(first) : null;

  useEffect(() => {
    if (open === 'note' || firstNoteSolid === null) return;
    setNoteSolid(firstNoteSolid);
    setNoteOpacity(firstNoteOpacity ?? 80);
  }, [open, firstNoteSolid, firstNoteOpacity]);

  useEffect(() => {
    if (open === 'glow' || firstGlowSolid === null) return;
    setGlowSolid(firstGlowSolid);
    setGlowOpacity(firstGlowOpacity ?? 70);
  }, [open, firstGlowSolid, firstGlowOpacity]);

  useEffect(() => {
    if (open === 'border' || firstBorderSolid === null) return;
    setBorderSolid(firstBorderSolid);
    setBorderOpacity(firstBorderOpacity ?? 100);
  }, [open, firstBorderSolid, firstBorderOpacity]);

  // canonical 반영 직후에는 열린 피커의 로컬 상태도 저장값으로 재동기화 -
  // 열림 게이트가 지킨 낡은 값이 다음 커밋에 재저장되는 회귀 방지
  const commitTick = useCommittedApplyStore((state) => state.commitTick);
  const commitTickRef = useRef(commitTick);
  useEffect(() => {
    if (commitTickRef.current === commitTick) return;
    commitTickRef.current = commitTick;
    if (!first) return;
    if (open === 'note') {
      setNoteSolid(surfaceTable.note.solid(first));
      setNoteOpacity(surfaceTable.note.opacity(first));
      return;
    }
    if (open === 'glow') {
      setGlowSolid(surfaceTable.glow.solid(first));
      setGlowOpacity(surfaceTable.glow.opacity(first));
      return;
    }
    if (open === 'border') {
      setBorderSolid(surfaceTable.border.solid(first));
      setBorderOpacity(surfaceTable.border.opacity(first));
    }
  }, [commitTick, open, first]);

  // 그라데이션 커밋 공통부 - 배율은 항상 100으로 기록 (알파는 스톱이 전담)
  const commitGradientPaint = (
    surface: 'note' | 'glow',
    rawSpec: GradientSpec,
  ) => {
    if (!commitNotePaint) return;
    const property = surface === 'note' ? 'notePaint' : 'noteGlowPaint';
    const stops = coerceStrictStops(rawSpec.stops, 'note-paint');
    if (stops === null) return;
    const spec = toCanonicalGradient({ ...rawSpec, stops });
    const shadow = notePaintShadowColor(spec);
    if (shadow === null) {
      // 강제 변환 뒤라 도달 불가 방어 - 무음이 되지 않게 위 경로와 로그 대칭
      console.error('[note-paint] shadow color derivation failed', spec);
      return;
    }
    if (surface === 'note') {
      setNoteOpacity(100);
      setNoteSolid(shadow.top);
    } else {
      setGlowOpacity(100);
      setGlowSolid(shadow.top);
    }
    const patch = {
      property,
      value: { color: shadow, opacity: 100, gradient: spec },
    } as const;
    previewNotePaint?.(patch);
    commitNotePaint(patch);
  };

  // 본체·글로우 커밋 (계약 §9-5) - 전환·배율·shadow를 한 op으로
  const makePaintCommit =
    (surface: 'note' | 'glow') => (value: ColorModeValue) => {
      if (!commitNotePaint) return;
      const property = surface === 'note' ? 'notePaint' : 'noteGlowPaint';
      // 그라데이션(신형·구형·상속 제시)이 하나라도 있는 선택만 원자 op 대상.
      // 전부 단색이면 구형 {color}로 투명도 필드를 건드리지 않는다
      const anyPresented = positions.some(
        (pos) => surfaceTable[surface].presentedSpec(pos) !== null,
      );
      const setSolid = surface === 'note' ? setNoteSolid : setGlowSolid;
      const localOpacity = surface === 'note' ? noteOpacity : glowOpacity;
      // 첫 대상이 그라데이션(신형·구형 제시)이면 알파는 이미 스톱에 실려 있다
      const firstPresented = first
        ? surfaceTable[surface].presentedSpec(first)
        : null;

      if (value.mode === 'solid') {
        const solidHex = toNoteHexColor(value.color);
        setSolid(solidHex);
        if (!anyPresented) {
          const patch = { property, value: { color: solidHex } } as const;
          previewNotePaint?.(patch);
          commitNotePaint(patch);
          return;
        }
        // 그라데이션 → 단색 확정 원자 op: 첫 스톱 알파가 단색 투명도(3필드 동일값)
        const opacity = firstPresented
          ? stopAlphaPercent(value.color, localOpacity)
          : localOpacity;
        if (surface === 'note') setNoteOpacity(opacity);
        else setGlowOpacity(opacity);
        const patch = {
          property,
          value: { color: solidHex, opacity, gradient: null },
        } as const;
        previewNotePaint?.(patch);
        commitNotePaint(patch);
        return;
      }
      // 단색에서 넘어오는 첫 커밋만 단색 투명도를 스톱 알파에 접는다
      commitGradientPaint(
        surface,
        firstPresented
          ? value.spec
          : foldGradientOpacity(value.spec, localOpacity),
      );
    };

  // 테두리 그라데이션 커밋 - 대표색은 hex 전용 계약(api-contract v2 §2),
  // 배율은 항상 100으로 기록 (알파는 스톱이 전담)
  const commitBorderGradientPaint = (rawSpec: GradientSpec) => {
    if (!commitNotePaint) return;
    const stops = coerceStrictStops(rawSpec.stops, 'note-border');
    if (stops === null) return;
    const spec = toCanonicalGradient({ ...rawSpec, stops });
    const hex =
      hexRepresentative(spec.stops[0]?.color ?? '#FFFFFF') ?? '#FFFFFF';
    setBorderSolid(hex);
    setBorderOpacity(100);
    const patch = {
      property: 'noteBorderPaint',
      value: { color: hex, opacity: 100, gradient: spec },
    } as const;
    previewNotePaint?.(patch);
    commitNotePaint(patch);
  };

  const handleBorderPaintCommit = (value: ColorModeValue) => {
    const firstPresented = first ? presentedBorderSpec(first) : null;
    if (value.mode === 'solid') {
      if (!commitNotePaint) return;
      const hex = toNoteHexColor(value.color);
      // 그라데이션에서 돌아오면 첫 스톱 알파가 단색 투명도
      const opacity = firstPresented
        ? stopAlphaPercent(value.color, borderOpacity)
        : borderOpacity;
      setBorderSolid(hex);
      setBorderOpacity(opacity);
      const patch = {
        property: 'noteBorderPaint',
        value: { color: hex, opacity },
      } as const;
      previewNotePaint?.(patch);
      commitNotePaint(patch);
      return;
    }
    // 단색에서 넘어오는 첫 커밋은 단색 투명도를 스톱 알파에 접는다
    commitBorderGradientPaint(
      firstPresented
        ? value.spec
        : foldGradientOpacity(value.spec, borderOpacity),
    );
  };

  // 보더 단색은 색 알파가 투명도를 겸하는 기존 규약 유지
  const previewBorderSolid = (color: string) => {
    setBorderSolid(toNoteHexColor(color));
    setBorderOpacity(parseAlphaPercent(color, borderOpacity));
  };
  const commitBorderSolid = (color: string) => {
    if (!commitNotePaint) return;
    const hex = toNoteHexColor(color);
    const opacity = parseAlphaPercent(color, borderOpacity);
    setBorderSolid(hex);
    setBorderOpacity(opacity);
    const patch = {
      property: 'noteBorderPaint',
      value: { color: hex, opacity },
    } as const;
    previewNotePaint?.(patch);
    commitNotePaint(patch);
  };

  const noteState = useGradientColorState({
    pair:
      open === 'note' && first
        ? {
            // 임의 문자열 색(플러그인 기록 등)이 그라데이션 시드를 죽이지 않게 §2A로 정화
            color: toNoteStopColor(noteSolid) ?? DEFAULT_NOTE_COLOR,
            gradient: presentedBodySpec(first),
          }
        : {},
    fallbackColor: DEFAULT_NOTE_COLOR,
    contextKey: `batch:${selectionKey}:noteBody`,
    // 노트는 그리드에 그려지지 않으므로 온캔버스 앵커(각도 핸들)를 두지 않는다
    onPreview: (value) => {
      if (value.mode === 'solid') setNoteSolid(value.color);
    },
    onCommit: makePaintCommit('note'),
  });

  const glowState = useGradientColorState({
    pair:
      open === 'glow' && first
        ? {
            color: toNoteStopColor(glowSolid) ?? DEFAULT_NOTE_COLOR,
            gradient: presentedGlowSpec(first),
          }
        : {},
    fallbackColor: DEFAULT_NOTE_COLOR,
    contextKey: `batch:${selectionKey}:noteGlow`,
    onPreview: (value) => {
      if (value.mode === 'solid') setGlowSolid(value.color);
    },
    onCommit: makePaintCommit('glow'),
  });

  const borderState = useGradientColorState({
    pair:
      open === 'border' && first
        ? { color: borderSolid, gradient: presentedBorderSpec(first) }
        : {},
    fallbackColor: '#FFFFFF',
    contextKey: `batch:${selectionKey}:noteBorder`,
    // 드래그 중 중간값은 흘리지 않는다 - 커밋 시점에 preview+commit 쌍으로 반영
    onCommit: handleBorderPaintCommit,
  });

  const states = { note: noteState, glow: glowState, border: borderState };
  const activeState = open ? states[open] : borderState;
  // 선택에 그라데이션(제시 포함) 대상이 하나라도 있으면 단색 투명도 조절기를
  // 두지 않는다 - {opacity} 단독 patch가 그라데이션 대상에 숨은 배율을 되살린다
  const anyPresented = {
    note: positions.some((pos) => presentedBodySpec(pos) !== null),
    glow: positions.some((pos) => presentedGlowSpec(pos) !== null),
    border: positions.some((pos) => presentedBorderSpec(pos) !== null),
  };

  const buildDisplay = (surface: BatchNoteSurface): BatchNoteSwatchDisplay => {
    const table = surfaceTable[surface];
    if (!first) {
      return { color: '#FFFFFF', opacity: 1, label: '', isMixed: false };
    }

    if (open === surface) {
      // 열림 중에는 첫 대상 기준 편집 세션 값을 표시 (기존 배치 규약)
      const spec = table.presentedSpec(first);
      const localOpacity =
        surface === 'note'
          ? noteOpacity
          : surface === 'glow'
          ? glowOpacity
          : borderOpacity;
      if (spec) {
        // 그라데이션은 알파가 이미지에 실려 있어 배율을 곱하지 않는다
        return {
          image: gradientToCss(spec),
          label: 'Gradient',
          isMixed: false,
        };
      }
      const localSolid =
        surface === 'note'
          ? noteSolid
          : surface === 'glow'
          ? glowSolid
          : borderSolid;
      return {
        color: localSolid,
        opacity: localOpacity / 100,
        label: localSolid.replace(/^#/, ''),
        isMixed: false,
      };
    }

    // 닫힘: 제시 spec·단색을 구조째 깊은 비교 - GradientSpec 차이도 Mixed로 노출
    const firstSpec = table.presentedSpec(first);
    const firstPaint = firstSpec
      ? JSON.stringify({ spec: firstSpec })
      : JSON.stringify({ solid: table.solid(first) });
    const paintMixed = positions.some((pos, index) => {
      if (index === 0) return false;
      const spec = table.presentedSpec(pos);
      const paint = spec
        ? JSON.stringify({ spec })
        : JSON.stringify({ solid: table.solid(pos) });
      return paint !== firstPaint;
    });
    if (paintMixed) {
      return {
        color: 'var(--ui-fg-disabled)',
        opacity: 1,
        label: 'Mixed',
        isMixed: true,
      };
    }
    if (firstSpec) {
      // 접힌 spec이라 배율은 이미 이미지에 포함
      return {
        image: gradientToCss(firstSpec),
        label: 'Gradient',
        isMixed: false,
      };
    }
    const opacityMixed = positions.some(
      (pos, index) => index > 0 && table.opacity(pos) !== table.opacity(first),
    );
    // opacity가 mixed면 첫 항목 값을 공통값처럼 단언하지 않고 원색으로 표시
    const commonOpacity = opacityMixed ? 1 : table.opacity(first) / 100;
    const solid = table.solid(first);
    return {
      color: solid,
      opacity: commonOpacity,
      label: solid.replace(/^#/, ''),
      isMixed: false,
    };
  };

  return {
    displays: {
      note: buildDisplay('note'),
      glow: buildDisplay('glow'),
      border: buildDisplay('border'),
    },
    states,
    activeState,
    anyPresented,
    noteSolid,
    glowSolid,
    borderSolid,
    noteOpacity,
    glowOpacity,
    borderOpacity,
    setNoteOpacity,
    setGlowOpacity,
    setBorderOpacity,
    previewBorderSolid,
    commitBorderSolid,
  };
};
