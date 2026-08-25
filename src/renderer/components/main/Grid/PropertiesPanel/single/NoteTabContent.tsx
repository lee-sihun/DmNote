/* eslint-disable react-hooks/set-state-in-effect */
// 피커 열림 게이트로 저장값을 로컬 상태에 동기화하는 패턴 (ColorPicker와 동일)
import React, { useEffect, useRef, useState } from 'react';
import type { NoteTabContentProps } from '../types';
import type { EditorElementPropertyPatchV1 } from '@src/types/editor';
import type { NoteColor } from '@src/types/key/keys';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  OptionalNumberInput,
} from '../PropertyInputs';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import {
  parseAlphaPercent,
  hexWithAlphaPercent,
} from '@utils/color/colorUtils';
import {
  gradientToCss,
  hexRepresentative,
  toCanonicalGradient,
  type ColorModeValue,
  type GradientSpec,
} from '@src/types/color';
import {
  DEFAULT_NOTE_COLOR,
  coerceStrictStops,
  toNoteStopColor,
  toNoteHexColor,
} from '../notePaintColorUtils';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { NOTE_SETTINGS_CONSTRAINTS } from '@src/types/settings/noteSettingsConstraints';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import { createNoteLiteralHandlers } from '../noteLiteralHandlers';
import NoteGlowPaintSourceDropdown from '../NoteGlowPaintSourceDropdown';
import {
  bodyInheritedGlowSpec,
  foldGradientOpacity,
  legacyNoteColorToSpec,
  notePaintShadowColor,
} from '@src/types/key/notePaint';
import { parseStrictStopColor } from '@src/types/color';

// 그라데이션 → 단색 전환: 첫 스톱 알파가 단색 투명도가 된다 (없으면 폴백)
const stopAlphaPercent = (color: string, fallback: number): number => {
  const strict = toNoteStopColor(color);
  const parsed = strict ? parseStrictStopColor(strict) : null;
  return parsed ? Math.round(parsed.a * 100) : fallback;
};

const NoteTabContent: React.FC<NoteTabContentProps> = ({
  keyPosition,
  onElementPropertyCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onNotePaintPreview,
  onNotePaintCommit,
  panelElement,
  t,
}) => {
  const { noteEffect: _noteEffect } = useSettingsStore();

  // 통합 피커 상태 (카운터 탭 패턴)
  type PickerTarget = 'note' | 'glow' | 'border' | null;
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const pickerOpen = !!pickerFor;

  // 컬러 버튼 refs
  const noteColorButtonRef = useRef<HTMLButtonElement>(null);
  const glowColorButtonRef = useRef<HTMLButtonElement>(null);
  const borderColorButtonRef = useRef<HTMLButtonElement>(null);

  // 단색 로컬 상태 - 그라데이션 세션 상태는 useGradientColorState가 관리
  const [noteSolidColor, setNoteSolidColor] = useState<string>(() => {
    const noteColor = keyPosition.noteColor;
    return typeof noteColor === 'string' ? noteColor : DEFAULT_NOTE_COLOR;
  });
  const [glowSolidColor, setGlowSolidColor] = useState<string>(() => {
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    return typeof glowColor === 'string' ? glowColor : DEFAULT_NOTE_COLOR;
  });

  const [localNoteOpacity, setLocalNoteOpacity] = useState<number>(() =>
    typeof keyPosition.noteOpacity === 'number' ? keyPosition.noteOpacity : 80,
  );
  const [localGlowOpacity, setLocalGlowOpacity] = useState<number>(() =>
    typeof keyPosition.noteGlowOpacity === 'number'
      ? keyPosition.noteGlowOpacity
      : 70,
  );

  // keyPosition 변경 시 내부 상태 동기화 (피커가 닫혀있을 때만)
  useEffect(() => {
    // 피커가 열려있으면 외부 변경을 무시 (드래그 중 충돌 방지)
    if (pickerFor === 'note') return;
    const noteColor = keyPosition.noteColor;
    setNoteSolidColor(
      typeof noteColor === 'string' ? noteColor : DEFAULT_NOTE_COLOR,
    );
  }, [keyPosition.noteColor, pickerFor]);

  useEffect(() => {
    if (pickerFor === 'glow') return;
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    setGlowSolidColor(
      typeof glowColor === 'string' ? glowColor : DEFAULT_NOTE_COLOR,
    );
  }, [keyPosition.noteGlowColor, keyPosition.noteColor, pickerFor]);

  useEffect(() => {
    if (pickerFor === 'note') return;
    const base =
      typeof keyPosition.noteOpacity === 'number'
        ? keyPosition.noteOpacity
        : 80;
    setLocalNoteOpacity(base);
  }, [keyPosition.noteOpacity, pickerFor]);

  useEffect(() => {
    if (pickerFor === 'glow') return;
    const base =
      typeof keyPosition.noteGlowOpacity === 'number'
        ? keyPosition.noteGlowOpacity
        : 70;
    setLocalGlowOpacity(base);
  }, [keyPosition.noteGlowOpacity, pickerFor]);

  // 테두리 색상 상태
  const [borderColor, setBorderColor] = useState<string>(
    () => keyPosition.noteBorderColor ?? '#FFFFFF',
  );
  // 테두리 투명도(0~100). 노트 배경 투명도와 독립
  const [localBorderOpacity, setLocalBorderOpacity] = useState<number>(
    () => keyPosition.noteBorderOpacity ?? 100,
  );

  useEffect(() => {
    if (pickerFor === 'border') return;
    setBorderColor(keyPosition.noteBorderColor ?? '#FFFFFF');
    setLocalBorderOpacity(keyPosition.noteBorderOpacity ?? 100);
  }, [keyPosition.noteBorderColor, keyPosition.noteBorderOpacity, pickerFor]);

  // 제시 spec: 그라데이션 형식은 배율 UI가 없어 저장 배율을 스톱 알파에 접어 보인다
  const storedBorderGradient = keyPosition.noteBorderGradient
    ? foldGradientOpacity(
        keyPosition.noteBorderGradient,
        keyPosition.noteBorderOpacity ?? 100,
      )
    : null;

  // 테두리 그라데이션 커밋 - 배율은 항상 100으로 기록 (알파는 스톱이 전담)
  const commitBorderGradientPaint = (rawSpec: GradientSpec) => {
    const stops = coerceStrictStops(rawSpec.stops, 'note-border');
    if (stops === null) return;
    // 노트는 각도 편집 UI가 없다 - 시드(180)나 저장값을 그대로 보존.
    // exact-keys 검증이 앱에서 가장 엄격한 경로라 커밋 직전 canonical 강제
    const spec = toCanonicalGradient({ ...rawSpec, stops });
    const hex =
      hexRepresentative(spec.stops[0]?.color ?? '#FFFFFF') ?? '#FFFFFF';
    setBorderColor(hex);
    setLocalBorderOpacity(100);
    const patch = {
      property: 'noteBorderPaint',
      value: {
        color: hex,
        opacity: 100,
        gradient: spec,
      },
    } as const;
    onNotePaintPreview?.(patch);
    onNotePaintCommit?.(patch);
  };

  // 테두리 커밋 - 대표색은 hex 전용 계약(api-contract v2 §2)
  const handleBorderPaintCommit = (value: ColorModeValue) => {
    if (value.mode === 'solid') {
      const hex = toNoteHexColor(value.color);
      // 그라데이션에서 돌아오면 첫 스톱 알파가 단색 투명도
      const opacity = storedBorderGradient
        ? stopAlphaPercent(value.color, localBorderOpacity)
        : localBorderOpacity;
      setBorderColor(hex);
      setLocalBorderOpacity(opacity);
      const patch = {
        property: 'noteBorderPaint',
        value: { color: hex, opacity },
      } as const;
      onNotePaintPreview?.(patch);
      onNotePaintCommit?.(patch);
      return;
    }
    // 단색에서 넘어오는 첫 커밋은 단색 투명도를 스톱 알파에 접는다
    commitBorderGradientPaint(
      storedBorderGradient
        ? value.spec
        : foldGradientOpacity(value.spec, localBorderOpacity),
    );
  };

  const borderGradientState = useGradientColorState({
    pair:
      pickerFor === 'border'
        ? { color: borderColor, gradient: storedBorderGradient }
        : {},
    fallbackColor: '#FFFFFF',
    contextKey: `key:${keyPosition.id}:noteBorder`,
    // 노트는 그리드에 그려지지 않으므로 온캔버스 앵커(각도 핸들)를 두지 않는다
    // 드래그 중 중간값은 흘리지 않는다 - 기존 보더 픽커처럼 커밋(드래그 완료·
    // 형식 전환·팔레트 선택) 시점에 preview+commit 쌍으로 오버레이에 반영
    onCommit: handleBorderPaintCommit,
  });

  const interactiveRefs = [
    noteColorButtonRef,
    glowColorButtonRef,
    borderColorButtonRef,
  ];

  // 표시용 spec: 신형 우선, 구형 그라데이션은 §9-6 매핑으로 제시 (저장 불변)
  const legacyNoteSpec = legacyNoteColorToSpec(
    keyPosition.noteColor,
    keyPosition.noteOpacityTop ?? keyPosition.noteOpacity ?? 80,
    keyPosition.noteOpacityBottom ?? keyPosition.noteOpacity ?? 80,
  );
  const glowOpacityTop =
    keyPosition.noteGlowOpacityTop ?? keyPosition.noteGlowOpacity ?? 70;
  const glowOpacityBottom =
    keyPosition.noteGlowOpacityBottom ?? keyPosition.noteGlowOpacity ?? 70;
  // 글로우 색이 없으면 렌더는 본체를 상속한다 - 신형 본체는 스톱·각도를 그대로
  // 빌리므로(§9-4) 축약된 shadow가 아니라 본체 spec으로 제시
  const legacyGlowSpec =
    keyPosition.noteGlowColor == null && keyPosition.noteGradient
      ? bodyInheritedGlowSpec(
          keyPosition.noteGradient,
          glowOpacityTop,
          glowOpacityBottom,
        )
      : legacyNoteColorToSpec(
          keyPosition.noteGlowColor ?? keyPosition.noteColor,
          glowOpacityTop,
          glowOpacityBottom,
        );
  // 신형 spec은 남은 저장 배율을 스톱 알파에 접어 제시 (커밋 시 100으로 수렴)
  const storedNoteSpec = keyPosition.noteGradient
    ? foldGradientOpacity(
        keyPosition.noteGradient,
        typeof keyPosition.noteOpacity === 'number'
          ? keyPosition.noteOpacity
          : 100,
      )
    : legacyNoteSpec;
  const storedGlowSpec = keyPosition.noteGlowGradient
    ? foldGradientOpacity(
        keyPosition.noteGlowGradient,
        typeof keyPosition.noteGlowOpacity === 'number'
          ? keyPosition.noteGlowOpacity
          : 100,
      )
    : legacyGlowSpec;

  // canonical 반영 직후에는 열린 피커의 로컬 상태도 저장값으로 재동기화 -
  // 열림 게이트가 지킨 낡은 값이 다음 커밋에 재저장되는 회귀 방지 (undo/redo,
  // 플러그인·다른 창 커밋 포함). 닫힌 표면은 위의 게이트 effect들이 추종한다
  const commitTick = useCommittedApplyStore((state) => state.commitTick);
  const commitTickRef = useRef(commitTick);
  useEffect(() => {
    if (commitTickRef.current === commitTick) return;
    commitTickRef.current = commitTick;
    if (pickerFor === 'note') {
      const noteColor = keyPosition.noteColor;
      setNoteSolidColor(
        typeof noteColor === 'string' ? noteColor : DEFAULT_NOTE_COLOR,
      );
      setLocalNoteOpacity(
        typeof keyPosition.noteOpacity === 'number'
          ? keyPosition.noteOpacity
          : 80,
      );
      return;
    }
    if (pickerFor === 'glow') {
      const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
      setGlowSolidColor(
        typeof glowColor === 'string' ? glowColor : DEFAULT_NOTE_COLOR,
      );
      setLocalGlowOpacity(
        typeof keyPosition.noteGlowOpacity === 'number'
          ? keyPosition.noteGlowOpacity
          : 70,
      );
      return;
    }
    if (pickerFor === 'border') {
      setBorderColor(keyPosition.noteBorderColor ?? '#FFFFFF');
      setLocalBorderOpacity(keyPosition.noteBorderOpacity ?? 100);
    }
  }, [commitTick, pickerFor, keyPosition]);

  // 따라가기 켜짐 = 글로우 페인트가 본체 미러라 편집 잠금
  const glowPaintLocked = keyPosition.noteGlowSyncPaint ?? false;

  // 본체·글로우 커밋 (계약 §9-5) - 전환·배율·shadow를 한 op으로
  const makePaintCommit =
    (surface: 'note' | 'glow') => (value: ColorModeValue) => {
      // 잠긴 뒤 늦게 도착한 피커 완료는 버린다 (백엔드가 거부하는 op)
      if (surface === 'glow' && glowPaintLocked) return;
      const property = surface === 'note' ? 'notePaint' : 'noteGlowPaint';
      // 그라데이션(신형·구형·상속 제시)에서 단색으로 가는 전환만 원자 op 대상.
      // 단색 → 단색은 구형 {color}로 투명도 필드를 건드리지 않는다
      const hadPresented =
        surface === 'note' ? storedNoteSpec !== null : storedGlowSpec !== null;
      const setSolid =
        surface === 'note' ? setNoteSolidColor : setGlowSolidColor;
      const localOpacity =
        surface === 'note' ? localNoteOpacity : localGlowOpacity;

      if (value.mode === 'solid') {
        // 노트 단색은 hex 관례 유지 - 알파는 투명도 필드 소관
        const solidHex = toNoteHexColor(value.color);
        setSolid(solidHex);
        if (!hadPresented) {
          const patch = { property, value: { color: solidHex } } as const;
          onNotePaintPreview?.(patch);
          onNotePaintCommit?.(patch);
          return;
        }
        // 그라데이션 → 단색 확정 원자 op: 첫 스톱 알파가 단색 투명도(3필드 동일값)
        const opacity = stopAlphaPercent(value.color, localOpacity);
        if (surface === 'note') setLocalNoteOpacity(opacity);
        else setLocalGlowOpacity(opacity);
        const patch = {
          property,
          value: { color: solidHex, opacity, gradient: null },
        } as const;
        onNotePaintPreview?.(patch);
        onNotePaintCommit?.(patch);
        return;
      }

      // 단색에서 넘어오는 첫 커밋만 단색 투명도를 스톱 알파에 접는다.
      // 신형·구형·상속 제시 spec은 알파가 이미 스톱에 실려 있다
      commitGradientPaint(
        surface,
        hadPresented
          ? value.spec
          : foldGradientOpacity(value.spec, localOpacity),
      );
    };

  // 그라데이션 커밋 공통부 - 배율은 항상 100으로 기록 (알파는 스톱이 전담)
  const commitGradientPaint = (
    surface: 'note' | 'glow',
    rawSpec: GradientSpec,
  ) => {
    const property = surface === 'note' ? 'notePaint' : 'noteGlowPaint';
    const stops = coerceStrictStops(rawSpec.stops, 'note-paint');
    if (stops === null) return;
    // 각도는 편집 UI 없이 시드(180)나 저장값을 보존 (테두리와 동일 방식)
    const spec = toCanonicalGradient({ ...rawSpec, stops });
    const shadow = notePaintShadowColor(spec);
    if (shadow === null) {
      // 강제 변환 뒤라 도달 불가 방어 - 무음이 되지 않게 위 경로와 로그 대칭
      console.error('[note-paint] shadow color derivation failed', spec);
      return;
    }
    if (surface === 'note') {
      setLocalNoteOpacity(100);
      setNoteSolidColor(shadow.top);
    } else {
      setLocalGlowOpacity(100);
      setGlowSolidColor(shadow.top);
    }
    const patch = {
      property,
      value: { color: shadow, opacity: 100, gradient: spec },
    } as const;
    onNotePaintPreview?.(patch);
    onNotePaintCommit?.(patch);
  };

  const noteGradientState = useGradientColorState({
    pair:
      pickerFor === 'note'
        ? {
            // 임의 문자열 색(플러그인 기록 등)이 그라데이션 시드를 죽이지 않게 §2A로 정화
            color: toNoteStopColor(noteSolidColor) ?? DEFAULT_NOTE_COLOR,
            gradient: storedNoteSpec,
          }
        : {},
    fallbackColor: DEFAULT_NOTE_COLOR,
    contextKey: `key:${keyPosition.id}:noteBody`,
    onPreview: (value) => {
      if (value.mode === 'solid') setNoteSolidColor(value.color);
    },
    onCommit: makePaintCommit('note'),
  });

  const glowGradientState = useGradientColorState({
    pair:
      pickerFor === 'glow'
        ? {
            color: toNoteStopColor(glowSolidColor) ?? DEFAULT_NOTE_COLOR,
            gradient: storedGlowSpec,
          }
        : {},
    fallbackColor: DEFAULT_NOTE_COLOR,
    contextKey: `key:${keyPosition.id}:noteGlow`,
    onPreview: (value) => {
      if (value.mode === 'solid') setGlowSolidColor(value.color);
    },
    onCommit: makePaintCommit('glow'),
  });

  const activePaintState =
    pickerFor === 'note'
      ? noteGradientState
      : pickerFor === 'glow'
      ? glowGradientState
      : borderGradientState;

  // 다른 창·외부 커밋으로 따라가기가 켜지면 열려 있던 글로우 피커를 닫는다
  useEffect(() => {
    if (glowPaintLocked && pickerFor === 'glow') setPickerFor(null);
  }, [glowPaintLocked, pickerFor]);

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = (target: 'note' | 'glow' | 'border') => {
    if (target === 'glow' && glowPaintLocked) return;
    setPickerFor((prev) => (prev === target ? null : target));
  };

  // 스타일 변경 완료 핸들러
  const handleStyleChangeComplete = (property: string, value: unknown) => {
    // property와 value의 상관은 TS가 못 잡아 캐스트가 남는다. 모양은 wire 계약과
    // 같고 값 유효성은 하류 검증이 잡는다. 단일 키 객체를 보내면 조용히 폐기된다
    onElementPropertyCommit?.({
      property,
      value,
    } as EditorElementPropertyPatchV1);
  };
  const noteLiteralHandlers = createNoteLiteralHandlers(
    {
      noteEffectEnabled: keyPosition.noteEffectEnabled ?? true,
      noteAutoYCorrection: keyPosition.noteAutoYCorrection ?? true,
      noteGlowEnabled: keyPosition.noteGlowEnabled ?? false,
    },
    handleStyleChangeComplete,
  );
  // 따라가기로 바꾸는 순간 열려 있던 글로우 피커는 닫는다 (저장 경로가 글로우 편집을 거부)
  const setGlowPaintFollow = (follow: boolean) => {
    if (follow && pickerFor === 'glow') setPickerFor(null);
    noteLiteralHandlers.setGlowPaintFollow(follow);
  };

  return (
    <>
      <PropertySection>
        {/* 노트 효과 표시 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteEffectEnabled') || '노트 효과 표시'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={keyPosition.noteEffectEnabled ?? true}
            onChange={noteLiteralHandlers.toggleEffect}
          />
        </div>

        {/* Y축 자동 보정 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteAutoYCorrection') || 'Y축 자동 보정'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={keyPosition.noteAutoYCorrection ?? true}
            onChange={noteLiteralHandlers.toggleAutoYCorrection}
          />
        </div>
      </PropertySection>

      <PropertySection>
        {/* 오프셋 */}
        <PropertyRow label={t('keySetting.noteOffset') || '오프셋'}>
          <OptionalNumberInput
            value={keyPosition.noteOffsetX || undefined}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteOffsetX',
                value: value ?? null,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteOffsetX',
                value: value ?? null,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            prefix="X"
            width={AXIS_FIELD_WIDTH}
            allowNegative
            allowDecimal
            decimalScale={1}
            min={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.max}
            placeholder="0"
          />
          <OptionalNumberInput
            value={keyPosition.noteOffsetY || undefined}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteOffsetY',
                value: value ?? null,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteOffsetY',
                value: value ?? null,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            prefix="Y"
            width={AXIS_FIELD_WIDTH}
            allowNegative
            allowDecimal
            decimalScale={1}
            min={NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.max}
            placeholder="0"
          />
        </PropertyRow>

        {/* 노트 넓이 */}
        <PropertyRow label={t('keySetting.noteWidth') || '노트 넓이'}>
          <OptionalNumberInput
            value={keyPosition.noteWidth}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteWidth',
                value: value ?? null,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteWidth',
                value: value ?? null,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={1}
            allowDecimal
            decimalScale={1}
            placeholder={`${keyPosition.width}px`}
          />
        </PropertyRow>

        {/* 노트 정렬 */}
        <PropertyRow label={t('keySetting.noteAlignment') || '노트 정렬'}>
          <Dropdown
            commitStrategy="after-paint"
            options={[
              {
                label: t('keySetting.noteAlignLeft') || '좌측',
                value: 'left',
              },
              {
                label: t('keySetting.noteAlignCenter') || '중앙',
                value: 'center',
              },
              {
                label: t('keySetting.noteAlignRight') || '우측',
                value: 'right',
              },
            ]}
            value={keyPosition.noteAlignment ?? 'center'}
            onChange={(value) =>
              noteLiteralHandlers.setAlignment(
                value as 'left' | 'center' | 'right',
              )
            }
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 노트 색상 */}
        <PropertyRow label={t('keySetting.noteColor') || '노트 색상'}>
          <ColorSwatchButton
            ref={noteColorButtonRef}
            type="button"
            onClick={() => handlePickerToggle('note')}
            open={pickerFor === 'note'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={storedNoteSpec ? undefined : noteSolidColor}
            image={storedNoteSpec ? gradientToCss(storedNoteSpec) : undefined}
            // 그라데이션은 알파가 이미지에 실려 있어 배율을 곱하지 않는다
            opacity={storedNoteSpec ? undefined : localNoteOpacity / 100}
          />
        </PropertyRow>

        {/* 노트 테두리 색상 + 방향 */}
        <PropertyRow label={t('keySetting.noteBorderColor') || '테두리 색상'}>
          <div className="flex items-center gap-[4px]">
            <ColorSwatchButton
              ref={borderColorButtonRef}
              type="button"
              onClick={() => handlePickerToggle('border')}
              open={pickerFor === 'border'}
              className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
              surfaceClassName="rounded-md"
              color={borderColor}
              image={
                storedBorderGradient
                  ? gradientToCss(storedBorderGradient)
                  : undefined
              }
              opacity={
                storedBorderGradient ? undefined : localBorderOpacity / 100
              }
            />
            <Dropdown
              commitStrategy="after-paint"
              iconTrigger={
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  {(keyPosition.noteBorderSide ?? 'all') === 'all' && (
                    <rect
                      x="1.5"
                      y="1.5"
                      width="10"
                      height="10"
                      rx="1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  )}
                  {(keyPosition.noteBorderSide ?? 'all') === 'vertical' && (
                    <>
                      <line
                        x1="1.5"
                        y1="1"
                        x2="1.5"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <line
                        x1="11.5"
                        y1="1"
                        x2="11.5"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                  {(keyPosition.noteBorderSide ?? 'all') === 'horizontal' && (
                    <>
                      <line
                        x1="1"
                        y1="1.5"
                        x2="12"
                        y2="1.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <line
                        x1="1"
                        y1="11.5"
                        x2="12"
                        y2="11.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </svg>
              }
              align="right"
              options={[
                {
                  label: t('keySetting.borderSideAll') || '전체',
                  value: 'all',
                },
                {
                  label: t('keySetting.borderSideVertical') || '수직',
                  value: 'vertical',
                },
                {
                  label: t('keySetting.borderSideHorizontal') || '수평',
                  value: 'horizontal',
                },
              ]}
              value={keyPosition.noteBorderSide ?? 'all'}
              onChange={(value) =>
                noteLiteralHandlers.setBorderSide(
                  value as 'all' | 'vertical' | 'horizontal',
                )
              }
            />
          </div>
        </PropertyRow>

        {/* 노트 테두리 두께 */}
        <PropertyRow label={t('keySetting.noteBorderWidth') || '테두리 두께'}>
          <NumberInput
            value={
              keyPosition.noteBorderWidth ??
              NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.default
            }
            onChange={(value) =>
              onStylePropertyCommit?.({
                property: 'noteBorderWidth',
                value: value,
              })
            }
            onPreview={(value) =>
              onStylePropertyPreview?.({
                property: 'noteBorderWidth',
                value: value,
              })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.min}
            max={NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.max}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 노트 라운딩 */}
        <PropertyRow label={t('keySetting.noteBorderRadius') || '노트 라운딩'}>
          <NumberInput
            value={
              keyPosition.noteBorderRadius ??
              NOTE_SETTINGS_CONSTRAINTS.borderRadius.default
            }
            onChange={(value) =>
              onStylePropertyCommit?.({
                property: 'noteBorderRadius',
                value: value,
              })
            }
            onPreview={(value) =>
              onStylePropertyPreview?.({
                property: 'noteBorderRadius',
                value: value,
              })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={NOTE_SETTINGS_CONSTRAINTS.borderRadius.min}
            max={NOTE_SETTINGS_CONSTRAINTS.borderRadius.max}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 글로우 효과 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteGlow') || '글로우 효과'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={keyPosition.noteGlowEnabled ?? false}
            onChange={noteLiteralHandlers.toggleGlow}
          />
        </div>

        {/* 글로우 색상/크기/투명도 */}
        <PropertyRow label={t('keySetting.noteGlowColor') || '글로우 색상'}>
          <div className="flex items-center gap-[4px]">
            <ColorSwatchButton
              ref={glowColorButtonRef}
              type="button"
              onClick={() => handlePickerToggle('glow')}
              open={pickerFor === 'glow'}
              disabled={glowPaintLocked}
              className={`w-[23px] h-[23px] rounded-md transition-shadow flex-shrink-0 ${
                glowPaintLocked
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer'
              }`}
              surfaceClassName="rounded-md"
              color={storedGlowSpec ? undefined : glowSolidColor}
              image={storedGlowSpec ? gradientToCss(storedGlowSpec) : undefined}
              opacity={storedGlowSpec ? undefined : localGlowOpacity / 100}
            />
            <NoteGlowPaintSourceDropdown
              follow={glowPaintLocked}
              onChange={setGlowPaintFollow}
              t={t}
            />
          </div>
        </PropertyRow>

        <PropertyRow label={t('keySetting.noteGlowSize') || '글로우 크기'}>
          <NumberInput
            value={keyPosition.noteGlowSize ?? 20}
            onChange={(value) => {
              onStylePropertyCommit?.({
                property: 'noteGlowSize',
                value: value,
              });
            }}
            onPreview={(value) => {
              onStylePropertyPreview?.({
                property: 'noteGlowSize',
                value: value,
              });
            }}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={50}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>
      </PropertySection>

      {/* 통합 ColorPicker - 단일 인스턴스로 깜빡임 없이 전환 */}
      <PopupExit open={pickerOpen}>
        {pickerFor ? (
          <ColorPicker
            open={pickerOpen}
            referenceRef={
              pickerFor === 'note'
                ? noteColorButtonRef
                : pickerFor === 'glow'
                ? glowColorButtonRef
                : borderColorButtonRef
            }
            panelElement={panelElement}
            color={
              pickerFor === 'border' &&
              borderGradientState.format !== 'gradient'
                ? hexWithAlphaPercent(borderColor, localBorderOpacity)
                : activePaintState.pickerColor
            }
            onColorChange={(c: NoteColor) => {
              if (typeof c !== 'string') return;
              if (
                pickerFor === 'border' &&
                borderGradientState.format !== 'gradient'
              ) {
                // 보더 단색은 색 알파가 투명도를 겸하는 기존 규약 유지
                setBorderColor(toNoteHexColor(c));
                setLocalBorderOpacity(parseAlphaPercent(c, localBorderOpacity));
                return;
              }
              activePaintState.handlePickerColorChange(c, false);
            }}
            onColorChangeComplete={(c: NoteColor) => {
              if (typeof c !== 'string') return;
              if (
                pickerFor === 'border' &&
                borderGradientState.format !== 'gradient'
              ) {
                const hex = toNoteHexColor(c);
                const opacity = parseAlphaPercent(c, localBorderOpacity);
                setBorderColor(hex);
                setLocalBorderOpacity(opacity);
                const patch = {
                  property: 'noteBorderPaint',
                  value: { color: hex, opacity },
                } as const;
                onNotePaintPreview?.(patch);
                onNotePaintCommit?.(patch);
                return;
              }
              activePaintState.handlePickerColorChange(c, true);
            }}
            onClose={() => setPickerFor(null)}
            interactiveRefs={interactiveRefs}
            solidOnly={true}
            headerSlot={activePaintState.headerSlot}
            footerSlot={activePaintState.footerSlot}
            gradientSpec={activePaintState.paletteGradientSpec}
            onGradientSpecSelect={activePaintState.handleGradientSpecSelect}
            {...(pickerFor !== 'border' &&
            activePaintState.format !== 'gradient'
              ? {
                  // 단색 형식: 투명도 조절기가 알파를 대신하고 기존 3필드 동일값
                  // 커밋을 유지한다. 색 알파는 저장 시 hex 변환으로 버려지므로 숨긴다.
                  // 그라데이션 형식은 스톱 알파만 편집하므로 조절기를 두지 않는다
                  hideColorAlpha: true,
                  opacityPercent:
                    pickerFor === 'note' ? localNoteOpacity : localGlowOpacity,
                  onOpacityPercentChange: (value: number) => {
                    if (pickerFor === 'note') {
                      setLocalNoteOpacity(value);
                      return;
                    }
                    setLocalGlowOpacity(value);
                  },
                  onOpacityPercentChangeComplete: (value: number) => {
                    const surface = pickerFor === 'note' ? 'note' : 'glow';
                    if (surface === 'glow' && glowPaintLocked) return;
                    const property =
                      surface === 'note' ? 'notePaint' : 'noteGlowPaint';
                    if (surface === 'note') {
                      setLocalNoteOpacity(value);
                    } else {
                      setLocalGlowOpacity(value);
                    }
                    const patch = {
                      property,
                      value: {
                        opacity: value,
                        opacityTop: value,
                        opacityBottom: value,
                      },
                    } as const;
                    onNotePaintPreview?.(patch);
                    onNotePaintCommit?.(patch);
                  },
                  opacityPercentLabel:
                    pickerFor === 'note'
                      ? t('keySetting.noteOpacity') || '노트 투명도'
                      : t('keySetting.noteGlowOpacity') || '글로우 투명도',
                }
              : {})}
          />
        ) : null}
      </PopupExit>
    </>
  );
};

export default NoteTabContent;
