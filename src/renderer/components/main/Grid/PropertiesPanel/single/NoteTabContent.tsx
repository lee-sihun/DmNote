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
  toRgbHexColor,
  parseAlphaPercent,
  hexWithAlphaPercent,
} from '@utils/color/colorUtils';
import {
  gradientToCss,
  hexRepresentative,
  toCanonicalGradient,
  toStrictStopColor,
  type ColorModeValue,
  type GradientSpec,
} from '@src/types/color';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { NOTE_SETTINGS_CONSTRAINTS } from '@src/types/settings/noteSettingsConstraints';
import { useSettingsStore } from '@stores/useSettingsStore';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import { createNoteLiteralHandlers } from '../noteLiteralHandlers';
import {
  legacyNoteColorToSpec,
  notePaintShadowColor,
} from '@src/types/key/notePaint';

const DEFAULT_NOTE_COLOR = '#FFFFFF';

// 팔레트는 표면 공용이라 §2A 밖 스톱이 들어올 수 있다 — 가능한 색은
// compact rgba로 강제하고, 변환 불가면 실패 예정 커밋을 만들지 않는다
const coerceStrictStops = (
  rawStops: GradientSpec['stops'],
  logTag: string,
): GradientSpec['stops'] | null => {
  const stops: GradientSpec['stops'] = [];
  for (const stop of rawStops) {
    const color = toStrictStopColor(stop.color);
    if (color === null) {
      console.error(
        `[${logTag}] unsupported gradient stop color: ${stop.color}`,
      );
      return null;
    }
    stops.push({ ...stop, color });
  }
  return stops;
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

  // 단색 로컬 상태 — 그라데이션 세션 상태는 useGradientColorState가 관리
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

  const storedBorderGradient = keyPosition.noteBorderGradient ?? null;

  // 테두리 그라데이션 커밋 — 대표색은 hex 전용 계약(api-contract v2 §2)
  const handleBorderPaintCommit = (value: ColorModeValue) => {
    if (value.mode === 'solid') {
      const hex = hexRepresentative(value.color) ?? toRgbHexColor(value.color);
      setBorderColor(hex);
      const patch = {
        property: 'noteBorderPaint',
        value: { color: hex, opacity: localBorderOpacity },
      } as const;
      onNotePaintPreview?.(patch);
      onNotePaintCommit?.(patch);
      return;
    }
    const stops = coerceStrictStops(value.spec.stops, 'note-border');
    if (stops === null) return;
    // 테두리는 온캔버스 핸들로 각도 유지 - exact-keys 검증이 앱에서 가장
    // 엄격한 경로라 커밋 직전 canonical 강제
    const spec = toCanonicalGradient({ ...value.spec, stops });
    const hex =
      hexRepresentative(spec.stops[0]?.color ?? '#FFFFFF') ?? '#FFFFFF';
    setBorderColor(hex);
    const patch = {
      property: 'noteBorderPaint',
      value: {
        color: hex,
        opacity: localBorderOpacity,
        gradient: spec,
      },
    } as const;
    onNotePaintPreview?.(patch);
    onNotePaintCommit?.(patch);
  };

  const borderGradientState = useGradientColorState({
    pair:
      pickerFor === 'border'
        ? { color: borderColor, gradient: storedBorderGradient }
        : {},
    fallbackColor: '#FFFFFF',
    contextKey: `key:${keyPosition.id}:noteBorder`,
    canvasAnchor:
      pickerFor === 'border' &&
      keyPosition.id &&
      isNativeElementId(keyPosition.id)
        ? { kind: 'key', id: keyPosition.id }
        : undefined,
    canvasSurface: 'noteBorder',
    // 드래그 중 중간값은 흘리지 않는다 — 기존 보더 픽커처럼 커밋(드래그 완료·
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
  const legacyGlowSpec = legacyNoteColorToSpec(
    keyPosition.noteGlowColor ?? keyPosition.noteColor,
    keyPosition.noteGlowOpacityTop ?? keyPosition.noteGlowOpacity ?? 70,
    keyPosition.noteGlowOpacityBottom ?? keyPosition.noteGlowOpacity ?? 70,
  );
  const storedNoteSpec = keyPosition.noteGradient ?? legacyNoteSpec;
  const storedGlowSpec = keyPosition.noteGlowGradient ?? legacyGlowSpec;

  // 구형 제시 상태의 배율 기준선 정렬 (§9-6): 프로파일은 스톱 알파에 이관되므로
  // 슬라이더는 100에서 시작해야 커밋 시 이중 곱 점프가 없다
  useEffect(() => {
    if (
      pickerFor === 'note' &&
      keyPosition.noteGradient == null &&
      legacyNoteSpec !== null
    ) {
      setLocalNoteOpacity(100);
    }
    if (
      pickerFor === 'glow' &&
      keyPosition.noteGlowGradient == null &&
      legacyGlowSpec !== null
    ) {
      setLocalGlowOpacity(100);
    }
    // 제시 spec은 pickerFor가 열리는 시점 값만 기준으로 삼는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerFor]);

  // 본체·글로우 커밋 (계약 §9-5) — 전환·배율·shadow를 한 op으로
  const makePaintCommit =
    (surface: 'note' | 'glow') => (value: ColorModeValue) => {
      const property = surface === 'note' ? 'notePaint' : 'noteGlowPaint';
      // 구형 제시 spec은 제외 - 신형 필드가 실제로 저장된 경우만 원자 op 대상.
      // 구형 상태의 단색 전환까지 원자 op로 보내면 기준선 100이 저장돼
      // 기존 투명도 프로파일이 소실된다
      const hadSpec =
        surface === 'note'
          ? keyPosition.noteGradient != null
          : keyPosition.noteGlowGradient != null;
      const setSolid =
        surface === 'note' ? setNoteSolidColor : setGlowSolidColor;
      const localOpacity =
        surface === 'note' ? localNoteOpacity : localGlowOpacity;

      if (value.mode === 'solid') {
        // 노트 단색은 hex 관례 유지 - 알파는 투명도 필드 소관
        const solidHex = toRgbHexColor(value.color);
        setSolid(solidHex);
        if (!hadSpec) {
          // 단색·구형 → 단색: 구형 색 변경 (프로파일 보존, sibling 제거는 무해)
          // 구형 그라데이션 제시가 기준선(100)으로 올려 둔 배율은 저장값으로 복귀
          if (surface === 'note') {
            setLocalNoteOpacity(
              typeof keyPosition.noteOpacity === 'number'
                ? keyPosition.noteOpacity
                : 80,
            );
          } else {
            setLocalGlowOpacity(
              typeof keyPosition.noteGlowOpacity === 'number'
                ? keyPosition.noteGlowOpacity
                : 70,
            );
          }
          const patch = { property, value: { color: solidHex } } as const;
          onNotePaintPreview?.(patch);
          onNotePaintCommit?.(patch);
          return;
        }
        // 그라데이션 → 단색 확정 원자 op: 투명도 3필드가 배율 동일값으로
        const patch = {
          property,
          value: { color: solidHex, opacity: localOpacity, gradient: null },
        } as const;
        onNotePaintPreview?.(patch);
        onNotePaintCommit?.(patch);
        return;
      }

      // 배율은 로컬 값 단일 규칙: 구형 그라데이션 제시는 기준선 effect가 100으로
      // 정렬해 두고(§9-6), 단색 시드는 기존 투명도를 그대로 승계한다
      commitGradientPaint(surface, value.spec, localOpacity);
    };

  // 그라데이션 커밋 공통부 — 배율 슬라이더(형식 전환 겸용)와 색 커밋이 공유
  const commitGradientPaint = (
    surface: 'note' | 'glow',
    rawSpec: GradientSpec,
    multiplier: number,
  ) => {
    const property = surface === 'note' ? 'notePaint' : 'noteGlowPaint';
    const stops = coerceStrictStops(rawSpec.stops, 'note-paint');
    if (stops === null) return;
    // 각도는 온캔버스 축 핸들이 편집한 값을 보존 (테두리와 동일 방식)
    const spec = toCanonicalGradient({ ...rawSpec, stops });
    const shadow = notePaintShadowColor(spec);
    if (shadow === null) {
      // 강제 변환 뒤라 도달 불가 방어 - 무음이 되지 않게 위 경로와 로그 대칭
      console.error('[note-paint] shadow color derivation failed', spec);
      return;
    }
    if (surface === 'note') {
      setLocalNoteOpacity(multiplier);
      setNoteSolidColor(shadow.top);
    } else {
      setLocalGlowOpacity(multiplier);
      setGlowSolidColor(shadow.top);
    }
    const patch = {
      property,
      value: { color: shadow, opacity: multiplier, gradient: spec },
    } as const;
    onNotePaintPreview?.(patch);
    onNotePaintCommit?.(patch);
  };

  const noteGradientState = useGradientColorState({
    pair:
      pickerFor === 'note'
        ? {
            // 임의 문자열 색(플러그인 기록 등)이 그라데이션 시드를 죽이지 않게 §2A로 정화
            color: toStrictStopColor(noteSolidColor) ?? DEFAULT_NOTE_COLOR,
            gradient: storedNoteSpec,
          }
        : {},
    fallbackColor: DEFAULT_NOTE_COLOR,
    contextKey: `key:${keyPosition.id}:noteBody`,
    canvasAnchor:
      pickerFor === 'note' &&
      keyPosition.id &&
      isNativeElementId(keyPosition.id)
        ? { kind: 'key', id: keyPosition.id }
        : undefined,
    canvasSurface: 'noteBody',
    onPreview: (value) => {
      if (value.mode === 'solid') setNoteSolidColor(value.color);
    },
    onCommit: makePaintCommit('note'),
  });

  const glowGradientState = useGradientColorState({
    pair:
      pickerFor === 'glow'
        ? {
            color: toStrictStopColor(glowSolidColor) ?? DEFAULT_NOTE_COLOR,
            gradient: storedGlowSpec,
          }
        : {},
    fallbackColor: DEFAULT_NOTE_COLOR,
    contextKey: `key:${keyPosition.id}:noteGlow`,
    canvasAnchor:
      pickerFor === 'glow' &&
      keyPosition.id &&
      isNativeElementId(keyPosition.id)
        ? { kind: 'key', id: keyPosition.id }
        : undefined,
    canvasSurface: 'noteGlow',
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

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = (target: 'note' | 'glow' | 'border') => {
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
            opacity={
              // 신형이면 배율을 곱해 표시, 구형 제시는 알파가 이미 이미지에 실림
              storedNoteSpec
                ? keyPosition.noteGradient != null
                  ? localNoteOpacity / 100
                  : undefined
                : localNoteOpacity / 100
            }
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
              opacity={localBorderOpacity / 100}
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
          <ColorSwatchButton
            ref={glowColorButtonRef}
            type="button"
            onClick={() => handlePickerToggle('glow')}
            open={pickerFor === 'glow'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={storedGlowSpec ? undefined : glowSolidColor}
            image={storedGlowSpec ? gradientToCss(storedGlowSpec) : undefined}
            opacity={
              storedGlowSpec
                ? keyPosition.noteGlowGradient != null
                  ? localGlowOpacity / 100
                  : undefined
                : localGlowOpacity / 100
            }
          />
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
                setBorderColor(toRgbHexColor(c));
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
                const hex = toRgbHexColor(c);
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
            {...(pickerFor !== 'border' && {
              // 그라데이션 형식에선 단일 슬라이더가 전역 배율(§9-2),
              // 단색 형식에선 기존 3필드 동일값 커밋을 유지
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
                const state =
                  surface === 'note' ? noteGradientState : glowGradientState;
                if (state.format === 'gradient') {
                  // 배율 커밋 - 구형 제시 상태면 이 커밋이 전환을 물질화
                  const spec = state.paletteGradientSpec;
                  if (spec) commitGradientPaint(surface, spec, value);
                  return;
                }
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
            })}
          />
        ) : null}
      </PopupExit>
    </>
  );
};

export default NoteTabContent;
