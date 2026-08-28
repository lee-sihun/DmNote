import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { StyleTabContentProps } from '../types';
import type { EditorElementPropertyPatchV1 } from '@src/types/editor';
import type { ImageFit, KeyPosition } from '@src/types/key/keys';
import {
  applyImageTransformLeaf,
  type ImageMode,
  type ImageTransformLeaf,
} from '@src/types/key/imageLayer';
import {
  slotMembers,
  slotUiMode,
  slotCanonical,
  buildSlot,
  slotCompactParts,
  MAX_SLOT_KEYS,
} from '@utils/keySlot';
import type { KeySlotUiMode } from '@utils/keySlot';
import { useKeySlotCapture } from '@hooks/useKeySlotCapture';
import KeySlotPicker from '@components/main/common/KeySlotPicker';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  TextInput,
  FontStyleToggle,
} from '../PropertyInputs';
import { createFontStyleToggleHandlers } from '../fontStyleToggleHandlers';
import { usePanelNav } from '../PanelNavContext';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useFontStore } from '@stores/useFontStore';
import ImagePicker from '../../../Modal/content/pickers/ImagePicker';
import ColorPicker from '../../../Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import FontPicker from '../../../Modal/content/pickers/FontPicker';
import FontPickerOpenButton from '../../../Modal/content/pickers/FontPickerOpenButton';
import FontWeightDropdown from '../FontWeightDropdown';
import SoundPicker from '../../../Modal/content/pickers/SoundPicker';
import Checkbox from '../../../common/Checkbox';
import { ColorSwatchButton } from '../../../Modal/content/pickers/ColorSwatch';
import ShadowControls from '../ShadowControls';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import {
  paintDescriptor,
  gradientToCss,
  type ColorModeValue,
  type GradientSpec,
} from '@src/types/color';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_ACTIVE_BORDER,
  DEFAULT_ELEMENT_BORDER_WIDTH,
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
  DEFAULT_ELEMENT_FONT_BOLD,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import {
  elementImageReplacesSurface,
  resolveElementBorder,
} from '@utils/core/elementBorder';
import { resolveSupportedFontWeight } from '@utils/core/fontWeights';
import {
  elementShadowLeafFromPartial,
  resolveElementShadowForPosition,
} from '@src/types/key/shadows';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const FONT_PAGE_KEY = 'single-style:font';
const SOUND_PAGE_KEY = 'single-style:sound';

// 피커 타겟 타입
type PickerTarget = 'backgroundColor' | 'borderColor' | 'fontColor' | null;

type ColorState = 'idle' | 'active';
type StyleColorTarget = 'backgroundColor' | 'borderColor' | 'fontColor';
type GradientColorTarget = StyleColorTarget;
type ActiveStyleColorProperty =
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';
type StyleColorProperty = StyleColorTarget | ActiveStyleColorProperty;

interface StyleTabContentInternalProps extends StyleTabContentProps {
  // 로컬 상태 (단일 선택 시에만 사용, 개별 편집 모드에서는 사용하지 않음)
  localDx?: number;
  localDy?: number;
  localWidth?: number;
  localHeight?: number;
  onLocalDxChange?: (value: number) => void;
  onLocalDyChange?: (value: number) => void;
  onLocalWidthChange?: (value: number) => void;
  onLocalHeightChange?: (value: number) => void;
}

const StyleTabContent: React.FC<StyleTabContentInternalProps> = ({
  keyIndex,
  keyPosition,
  keyCode: _keyCode,
  keyInfo,
  onGeometryPreview,
  onGeometryCommit,
  onElementPropertyCommit,
  onKeyMappingChange,
  keySlot,
  mappingControl,
  mappingControlLayout,
  mappingLabel,
  hideDisplayText = false,
  showSoundControls = true,
  shadowActiveState = true,
  showImagePicker = false,
  onToggleImagePicker,
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onPaintPreview,
  onPaintCommit,
  onShadowCommit,
  imageButtonRef,
  panelElement,
  useCustomCSS = false,
  canvasAnchor,
  t,
  // 로컬 상태
  localDx,
  localDy,
  localWidth,
  localHeight,
  onLocalDxChange,
  onLocalDyChange,
  onLocalWidthChange,
  onLocalHeightChange,
}) => {
  const DEFAULT_KEY_BACKGROUND_COLOR = DEFAULT_ELEMENT_BG;
  const DEFAULT_KEY_BORDER_COLOR = DEFAULT_ELEMENT_BORDER;
  const DEFAULT_KEY_FONT_COLOR = DEFAULT_ELEMENT_FONT;
  const DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR = DEFAULT_ELEMENT_ACTIVE_BG;
  const DEFAULT_KEY_ACTIVE_BORDER_COLOR = DEFAULT_ELEMENT_ACTIVE_BORDER;
  const DEFAULT_KEY_ACTIVE_FONT_COLOR = DEFAULT_ELEMENT_ACTIVE_FONT;

  // 개별 편집 모드인지 확인 (로컬 상태 핸들러가 없으면 개별 편집 모드)
  const isIndividualMode = !onLocalDxChange;

  // 키 슬롯 칩 에디터 (keySlot 제공 시에만 활성)
  const slotEditable = keySlot != null && Boolean(onKeyMappingChange);
  const members = keySlot != null ? slotMembers(keySlot) : [];
  const slotIdentityKey = `${keyIndex}:${
    keySlot != null ? slotCanonical(keySlot) : ''
  }`;

  // 입력 방식 - 멤버 1개에서 개별/동시를 고른 상태를 유지해야 하므로 로컬 소유,
  // 선택 전환·undo 등 외부 변경 시에만 슬롯에서 재동기화
  const [slotMode, setSlotMode] = useState<KeySlotUiMode>(() =>
    keySlot != null ? slotUiMode(keySlot) : 'single',
  );
  useEffect(() => {
    setSlotMode(keySlot != null ? slotUiMode(keySlot) : 'single');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotIdentityKey]);

  const commitMembers = (
    nextMembers: string[],
    mode: KeySlotUiMode = slotMode,
  ) => {
    const sliced = mode === 'single' ? nextMembers.slice(0, 1) : nextMembers;
    onKeyMappingChange?.(
      keyIndex,
      buildSlot(sliced, mode === 'all' ? 'all' : 'any'),
    );
  };

  // 입력 방식 변경 - 단일은 첫 키만 유지, 멤버 1개의 개별/동시는 로컬만
  const handleSlotModeChange = (mode: KeySlotUiMode) => {
    setSlotMode(mode);
    if (mode === 'single') {
      if (members.length > 1) commitMembers(members, 'single');
    } else if (members.length >= 2) {
      commitMembers(members, mode);
    }
  };

  // 멀티 키 편집 팝업
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const slotEditButtonRef = useRef<HTMLButtonElement>(null);
  const slotParts = slotCompactParts(
    buildSlot(members, slotMode === 'all' ? 'all' : 'any'),
  );

  const {
    isListening: slotListening,
    listenIndex: slotListenIndex,
    startListen: startSlotListen,
    stopListen: stopSlotListen,
  } = useKeySlotCapture({
    escapeCancels: true,
    onCapture: (captured, target) => {
      const duplicateAt = members.indexOf(captured);
      if (target !== null) {
        // 리스닝 중 제거로 인덱스가 밀린 경우 방어
        if (target >= members.length) return;
        // 멤버 교체, 다른 자리에 이미 있는 키는 무시
        if (duplicateAt !== -1 && duplicateAt !== target) return;
        const next = [...members];
        next[target] = captured;
        commitMembers(next);
      } else {
        // 멤버 추가, 중복·상한 초과는 무시
        if (duplicateAt !== -1 || members.length >= MAX_SLOT_KEYS) return;
        // 단일 상태에서 키가 늘면 개별 판정으로 승격
        const nextMode = slotMode === 'single' ? 'any' : slotMode;
        if (nextMode !== slotMode) setSlotMode(nextMode);
        commitMembers([...members, captured], nextMode);
      }
    },
  });
  const shadowElementType = shadowActiveState ? 'key' : 'stat';
  const idleShadow = resolveElementShadowForPosition({
    position: keyPosition,
    elementType: shadowElementType,
    active: false,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  });
  const activeShadow = resolveElementShadowForPosition({
    position: keyPosition,
    elementType: shadowElementType,
    active: true,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  });

  // 통합 피커 상태
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const [colorState, setColorState] = useState<ColorState>('idle');
  const effectiveColorState = shadowActiveState ? colorState : 'idle';
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  useEffect(() => {
    if (!shadowActiveState) {
      setColorState('idle');
      setPickerFor(null);
    }
  }, [shadowActiveState]);

  // 컬러 버튼 refs
  const bgColorBtnRef = useRef<HTMLButtonElement>(null);
  // 폰트 버튼 ref
  const borderColorBtnRef = useRef<HTMLButtonElement>(null);
  const fontColorBtnRef = useRef<HTMLButtonElement>(null);

  // 인-패널 내비게이션 (사운드/폰트 서브 페이지)
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();

  // 로컬 색상 상태 (드래그 중 UI 업데이트용)
  const [localColors, setLocalColors] = useState<
    Record<StyleColorProperty, string>
  >({
    backgroundColor:
      keyPosition.backgroundColor || DEFAULT_KEY_BACKGROUND_COLOR,
    activeBackgroundColor:
      keyPosition.activeBackgroundColor ||
      keyPosition.backgroundColor ||
      DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR,
    borderColor: keyPosition.borderColor || DEFAULT_KEY_BORDER_COLOR,
    activeBorderColor:
      keyPosition.activeBorderColor ||
      keyPosition.borderColor ||
      DEFAULT_KEY_ACTIVE_BORDER_COLOR,
    fontColor: keyPosition.fontColor || DEFAULT_KEY_FONT_COLOR,
    activeFontColor:
      keyPosition.activeFontColor ||
      keyPosition.fontColor ||
      DEFAULT_KEY_ACTIVE_FONT_COLOR,
  });

  // 피커가 닫혀있을 때만 외부 prop과 동기화
  useEffect(() => {
    if (
      !pickerFor ||
      (pickerFor !== 'backgroundColor' &&
        pickerFor !== 'borderColor' &&
        pickerFor !== 'fontColor')
    ) {
      setLocalColors({
        backgroundColor:
          keyPosition.backgroundColor || DEFAULT_KEY_BACKGROUND_COLOR,
        activeBackgroundColor:
          keyPosition.activeBackgroundColor ||
          keyPosition.backgroundColor ||
          DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR,
        borderColor: keyPosition.borderColor || DEFAULT_KEY_BORDER_COLOR,
        activeBorderColor:
          keyPosition.activeBorderColor ||
          keyPosition.borderColor ||
          DEFAULT_KEY_ACTIVE_BORDER_COLOR,
        fontColor: keyPosition.fontColor || DEFAULT_KEY_FONT_COLOR,
        activeFontColor:
          keyPosition.activeFontColor ||
          keyPosition.fontColor ||
          DEFAULT_KEY_ACTIVE_FONT_COLOR,
      });
    }
  }, [
    pickerFor,
    keyPosition.backgroundColor,
    keyPosition.activeBackgroundColor,
    keyPosition.borderColor,
    keyPosition.activeBorderColor,
    keyPosition.fontColor,
    keyPosition.activeFontColor,
    DEFAULT_KEY_BACKGROUND_COLOR,
    DEFAULT_KEY_ACTIVE_BACKGROUND_COLOR,
    DEFAULT_KEY_BORDER_COLOR,
    DEFAULT_KEY_ACTIVE_BORDER_COLOR,
    DEFAULT_KEY_FONT_COLOR,
    DEFAULT_KEY_ACTIVE_FONT_COLOR,
  ]);

  // interactiveRefs
  const colorPickerInteractiveRefs = [
    bgColorBtnRef,
    borderColorBtnRef,
    fontColorBtnRef,
  ];

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = (target: PickerTarget) => {
    setPickerFor((prev) => (prev === target ? null : target));
    // 새로 열 때는 항상 대기 탭에서 시작 - 열림과 같은 배치로 리셋해
    // 첫 렌더부터 이전 "입력" 선택이 새지 않는다
    if (pickerFor !== target) setColorState('idle');
  };

  const resolveColorProperty = (
    target: StyleColorTarget,
  ): StyleColorProperty => {
    if (effectiveColorState !== 'active') return target;
    switch (target) {
      case 'backgroundColor':
        return 'activeBackgroundColor';
      case 'borderColor':
        return 'activeBorderColor';
      case 'fontColor':
        return 'activeFontColor';
      default:
        return target;
    }
  };

  const activeColorPropertyFor = (
    target: StyleColorTarget,
  ): ActiveStyleColorProperty => {
    switch (target) {
      case 'backgroundColor':
        return 'activeBackgroundColor';
      case 'borderColor':
        return 'activeBorderColor';
      case 'fontColor':
        return 'activeFontColor';
    }
  };

  // 상태별 저장된 gradient 형제 값
  const storedGradientOf = (prop: StyleColorProperty): GradientSpec | null => {
    switch (prop) {
      case 'backgroundColor':
        return keyPosition.backgroundGradient ?? null;
      case 'activeBackgroundColor':
        return keyPosition.activeBackgroundGradient ?? null;
      case 'borderColor':
        return keyPosition.borderGradient ?? null;
      case 'activeBorderColor':
        return keyPosition.activeBorderGradient ?? null;
      case 'fontColor':
        return keyPosition.fontGradient ?? null;
      case 'activeFontColor':
        return keyPosition.activeFontGradient ?? null;
      default:
        return null;
    }
  };

  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

  // 현재 피커 색상값 가져오기
  const colorValueFor = (target: StyleColorTarget): string => {
    return localColors[resolveColorProperty(target)];
  };

  // 드래그 중 로컬 상태만 갱신 - preview는 그라데이션 상태(handleGradientPreview)가 담당
  const handleColorChange = (target: StyleColorTarget, color: string) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  // 드래그 완료 시 로컬 반영 - 커밋은 그라데이션 상태(handleGradientCommit)가 담당
  const handleColorChangeComplete = (
    target: StyleColorTarget,
    color: string,
  ) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  // ── 그라데이션 배선 (배경·테두리·글꼴 공통) ──

  const gradientTarget: GradientColorTarget | null =
    pickerFor === 'backgroundColor' ||
    pickerFor === 'borderColor' ||
    pickerFor === 'fontColor'
      ? pickerFor
      : null;

  const gradientSpecFor = (
    target: GradientColorTarget,
  ): GradientSpec | null => {
    // 테두리는 상태별 이미지 억제까지 렌더와 같은 해석기 결과를 그대로 쓴다.
    // 활성 이미지로 억제된 null이 대기 기본 립으로 되돌아가면 안 된다
    if (target === 'borderColor') {
      const active = effectiveColorState === 'active';
      return resolveElementBorder(keyPosition, active, {
        suppressDefault: elementImageReplacesSurface(keyPosition, active),
      }).gradient;
    }
    const idleGradient = storedGradientOf(target);
    if (effectiveColorState !== 'active') return idleGradient;
    const activeProp = activeColorPropertyFor(target);
    const activeGradient = storedGradientOf(activeProp);
    const activeHasValue =
      isNonEmptyString(keyPosition[activeProp]) || activeGradient != null;
    return activeHasValue ? activeGradient : idleGradient;
  };

  // 배경·테두리·글꼴 표면과 상태 조합을 paint 필드로
  const paintFieldFor = (target: GradientColorTarget) =>
    target === 'backgroundColor'
      ? effectiveColorState === 'active'
        ? 'activeBackgroundPaint'
        : 'backgroundPaint'
      : target === 'borderColor'
      ? effectiveColorState === 'active'
        ? 'activeBorderPaint'
        : 'borderPaint'
      : effectiveColorState === 'active'
      ? 'activeFontPaint'
      : 'fontPaint';

  // 드래그와 텍스트 입력은 같은 preview patch를 사용
  const handleGradientPreview = (value: ColorModeValue) => {
    if (!gradientTarget) return;
    const prop = resolveColorProperty(gradientTarget);
    const descriptor = paintDescriptor(value);
    setLocalColors((prev) => ({ ...prev, [prop]: descriptor.color }));
    onPaintPreview?.({
      property: paintFieldFor(gradientTarget),
      value: descriptor,
    });
  };

  const handleGradientCommit = (value: ColorModeValue) => {
    if (!gradientTarget) return;
    const prop = resolveColorProperty(gradientTarget);
    const descriptor = paintDescriptor(value);
    setLocalColors((prev) => ({ ...prev, [prop]: descriptor.color }));
    onPaintCommit?.({
      property: paintFieldFor(gradientTarget),
      value: descriptor,
    });
  };

  const gradientState = useGradientColorState({
    pair: gradientTarget
      ? {
          color: colorValueFor(gradientTarget),
          gradient: gradientSpecFor(gradientTarget),
        }
      : {},
    fallbackColor: '#ffffff',
    // 요소 종류·키 모드 포함 — 형식 왕복 기억이 다른 대상과 교차하지 않게
    contextKey: `${canvasAnchor?.kind ?? 'key'}:${selectedKeyType}:${
      canvasAnchor?.kind === 'batch' ? 'batch' : canvasAnchor?.id
    }:${pickerFor ?? 'none'}:${effectiveColorState}`,
    canvasAnchor: gradientTarget ? canvasAnchor : undefined,
    canvasSurface:
      gradientTarget === 'borderColor'
        ? 'border'
        : gradientTarget === 'fontColor'
        ? 'font'
        : 'background',
    canvasState: effectiveColorState,
    onPreview: handleGradientPreview,
    onCancel: () => editGestureController.cancel(),
    onCommit: handleGradientCommit,
  });

  // 위치 변경 핸들러
  const handlePositionXChange = (value: number) => {
    if (onLocalDxChange) {
      onLocalDxChange(value);
    }
    onGeometryCommit?.('dx', value);
  };

  const handlePositionYChange = (value: number) => {
    if (onLocalDyChange) {
      onLocalDyChange(value);
    }
    onGeometryCommit?.('dy', value);
  };

  // 크기 변경 핸들러
  const handleWidthChange = (value: number) => {
    onLocalWidthChange?.(value);
    onGeometryCommit?.('width', value);
  };

  const handleHeightChange = (value: number) => {
    onLocalHeightChange?.(value);
    onGeometryCommit?.('height', value);
  };

  // 타이핑 중 스타일 프리뷰
  const handleStylePreview = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    if (
      onStylePropertyPreview &&
      (property === 'borderWidth' ||
        property === 'borderRadius' ||
        property === 'fontSize') &&
      typeof value === 'number'
    ) {
      onStylePropertyPreview(
        property === 'borderWidth'
          ? { property: 'borderWidth', value }
          : property === 'borderRadius'
          ? { property: 'borderRadius', value }
          : { property: 'fontSize', value },
      );
      return;
    }
    if (
      (property === 'dx' ||
        property === 'dy' ||
        property === 'width' ||
        property === 'height') &&
      typeof value === 'number'
    ) {
      onGeometryPreview?.(property, value);
    }
  };

  const handleStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
    options?: { gestureId?: string },
  ) => {
    if (
      onStylePropertyCommit &&
      (property === 'borderWidth' ||
        property === 'borderRadius' ||
        property === 'fontSize') &&
      typeof value === 'number'
    ) {
      onStylePropertyCommit(
        property === 'borderWidth'
          ? { property: 'borderWidth', value }
          : property === 'borderRadius'
          ? { property: 'borderRadius', value }
          : { property: 'fontSize', value },
      );
      return;
    }
    // property와 value의 상관은 TS가 못 잡아 캐스트가 남는다. 모양은 wire 계약과
    // 같고 값 유효성은 하류 검증이 잡는다. 단일 키 객체를 보내면 조용히 폐기된다
    onElementPropertyCommit?.(
      {
        property,
        value,
      } as EditorElementPropertyPatchV1,
      options,
    );
  };

  // 이미지 변경 핸들러
  const handleIdleImageChange = (imageUrl: string) => {
    onInactiveImageCommit?.(imageUrl);
  };

  const handleActiveImageChange = (imageUrl: string) => {
    onActiveImageCommit?.(imageUrl);
  };

  const handleIdleTransparentChange = (checked: boolean) => {
    onIdleTransparentCommit?.(checked);
  };

  const handleActiveTransparentChange = (checked: boolean) => {
    onActiveTransparentCommit?.(checked);
  };

  const handleIdleImageReset = () => {
    onInactiveImageCommit?.('');
  };

  const handleActiveImageReset = () => {
    onActiveImageCommit?.('');
  };

  const handleIdleImageFitChange = (fit: ImageFit) => {
    onIdleImageFitCommit?.(fit);
  };

  const handleActiveImageFitChange = (fit: ImageFit) => {
    onActiveImageFitCommit?.(fit);
  };

  // 이미지 레이어 모드·변환은 키 전용 - 범용 property 커밋으로 흘린다
  const handleImageModeChange = (mode: ImageMode) => {
    onElementPropertyCommit?.({ property: 'imageMode', value: mode });
  };
  const handleImageTransformChange = (
    state: 'idle' | 'active',
    leaf: ImageTransformLeaf,
    value: number,
  ) => {
    onElementPropertyCommit?.(
      state === 'idle'
        ? { property: 'idleImageTransform', value: { leaf, value } }
        : { property: 'activeImageTransform', value: { leaf, value } },
    );
  };
  // 프리뷰는 leaf가 아니라 전체 변환을 보낸다. 오버레이는 patch를 얕게 합치므로
  // leaf만 보내면 나머지 축이 사라진다
  const handleImageTransformPreview = (
    state: 'idle' | 'active',
    leaf: ImageTransformLeaf,
    value: number,
  ) => {
    const property =
      state === 'idle' ? 'idleImageTransform' : 'activeImageTransform';
    onStylePropertyPreview?.({
      property,
      value: applyImageTransformLeaf(keyPosition[property], { leaf, value }),
    });
  };
  const handleImageTransformCancel = () => editGestureController.cancel();

  // 표시 텍스트 핸들러
  const handleDisplayTextChange = (value: string) => {
    onStylePropertyPreview?.({ property: 'displayText', value: value });
  };

  const handleDisplayTextBlur = (value: string) => {
    onStylePropertyCommit?.({ property: 'displayText', value: value });
  };

  // 클래스명 핸들러
  const handleClassNameChange = (value: string) => {
    onStylePropertyPreview?.({ property: 'className', value: value });
  };

  const handleClassNameBlur = (value: string) => {
    onStylePropertyCommit?.({ property: 'className', value: value });
  };

  // 색상 표시용 헬퍼 함수
  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  return (
    <>
      {/* 키 매핑(또는 통계 종류 등 대체 컨트롤) - 단일 선택 모드에서만 표시 */}
      {mappingControlLayout ? (
        <PropertySection>{mappingControlLayout}</PropertySection>
      ) : mappingControl ? (
        <PropertySection>
          <PropertyRow
            label={mappingLabel || t('propertiesPanel.keyMapping') || '키 매핑'}
          >
            {mappingControl}
          </PropertyRow>
        </PropertySection>
      ) : slotEditable ? (
        <PropertySection>
          <PropertyRow label={t('propertiesPanel.keyMapping') || '키 매핑'}>
            <button
              onClick={() =>
                // 기존처럼 즉시 캡처 (멀티 슬롯이면 첫 키 교체)
                startSlotListen(members.length === 0 ? null : 0)
              }
              className={`flex items-center justify-center h-[23px] min-w-[0px] max-w-[120px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
                slotListening && !slotPickerOpen ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
            >
              <span className="truncate">
                {slotListening && !slotPickerOpen
                  ? t('propertiesPanel.pressAnyKey') || 'Press any key'
                  : slotParts.label ||
                    t('propertiesPanel.clickToSet') ||
                    'Click to set'}
              </span>
              {!(slotListening && !slotPickerOpen) && slotParts.extra && (
                // case 피처: +를 숫자 중심에 맞춘 글리프로 치환.
                // tracking은 +와 숫자 사이 0.25px 확보용, 끝 글자 뒤 여분은 -mr로 상쇄 (배지는 한 자리 전제)
                <span className="pl-[3px] tracking-[0.25px] -mr-[0.25px] text-fg-caption [font-feature-settings:'case']">
                  {slotParts.extra}
                </span>
              )}
            </button>
          </PropertyRow>

          {/* 다중 키·판정 방식 편집 - 그림자 행과 같은 설정하기 패턴 */}
          <PropertyRow
            label={t('propertiesPanel.multiKey') || 'Mapping details'}
          >
            <button
              ref={slotEditButtonRef}
              onClick={() => setSlotPickerOpen((prev) => !prev)}
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                slotPickerOpen ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>

          <KeySlotPicker
            open={slotPickerOpen}
            referenceRef={slotEditButtonRef}
            panelElement={panelElement}
            onClose={() => {
              setSlotPickerOpen(false);
              stopSlotListen();
            }}
            members={members}
            mode={slotMode}
            isListening={slotListening}
            listenIndex={slotListenIndex}
            onChipClick={(index) => startSlotListen(index)}
            onAddClick={() => startSlotListen(null)}
            onRemove={(index) => {
              // 진행 중 리스닝 취소 후 제거 (인덱스 밀림 방어)
              stopSlotListen();
              commitMembers(members.filter((_, i) => i !== index));
            }}
            onModeChange={handleSlotModeChange}
            labels={{
              title: t('propertiesPanel.multiKeyEdit') || 'Multi-key',
              modeAny: t('propertiesPanel.matchAny') || 'Individual',
              modeAll: t('propertiesPanel.matchAll') || 'Combined',
              pressAnyKey: t('propertiesPanel.pressAnyKey') || 'Press any key',
              addKey: t('propertiesPanel.addKey') || 'Add key',
              removeKey: t('propertiesPanel.removeKey') || 'Remove key',
            }}
          />
        </PropertySection>
      ) : null}

      {/* 위치·크기 */}
      <PropertySection>
        <PropertyRow label={t('propertiesPanel.position') || '위치'}>
          <NumberInput
            value={
              isIndividualMode ? keyPosition.dx : localDx ?? keyPosition.dx
            }
            onChange={handlePositionXChange}
            onPreview={(value) => handleStylePreview('dx', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="X"
            width={AXIS_FIELD_WIDTH}
            min={-9999}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={
              isIndividualMode ? keyPosition.dy : localDy ?? keyPosition.dy
            }
            onChange={handlePositionYChange}
            onPreview={(value) => handleStylePreview('dy', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="Y"
            width={AXIS_FIELD_WIDTH}
            min={-9999}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 크기 */}
        <PropertyRow label={t('propertiesPanel.size') || '크기'}>
          <NumberInput
            value={
              isIndividualMode
                ? keyPosition.width ?? 60
                : localWidth ?? keyPosition.width ?? 60
            }
            onChange={handleWidthChange}
            onPreview={(width) => {
              onLocalWidthChange?.(width);
              onGeometryPreview?.('width', width);
            }}
            onCancel={() => editGestureController.cancel()}
            prefix="W"
            width={AXIS_FIELD_WIDTH}
            min={1}
            max={999}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={
              isIndividualMode
                ? keyPosition.height ?? 60
                : localHeight ?? keyPosition.height ?? 60
            }
            onChange={handleHeightChange}
            onPreview={(height) => {
              onLocalHeightChange?.(height);
              onGeometryPreview?.('height', height);
            }}
            onCancel={() => editGestureController.cancel()}
            prefix="H"
            width={AXIS_FIELD_WIDTH}
            min={1}
            max={999}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>
      </PropertySection>

      {/* 외형 */}
      <PropertySection>
        {/* 배경색 */}
        <PropertyRow label={t('propertiesPanel.backgroundColor') || '배경색'}>
          <ColorSwatchButton
            ref={bgColorBtnRef}
            type="button"
            onClick={() => handlePickerToggle('backgroundColor')}
            open={pickerFor === 'backgroundColor'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(colorValueFor('backgroundColor'))}
            image={(() => {
              const spec = gradientSpecFor('backgroundColor');
              return spec ? gradientToCss(spec) : undefined;
            })()}
          />
        </PropertyRow>

        {/* 테두리 색상 */}
        <PropertyRow label={t('propertiesPanel.borderColor') || '테두리 색상'}>
          <ColorSwatchButton
            ref={borderColorBtnRef}
            type="button"
            onClick={() => handlePickerToggle('borderColor')}
            open={pickerFor === 'borderColor'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(colorValueFor('borderColor'))}
            image={(() => {
              const spec = gradientSpecFor('borderColor');
              return spec ? gradientToCss(spec) : undefined;
            })()}
          />
        </PropertyRow>

        {/* 테두리 두께 */}
        <PropertyRow label={t('propertiesPanel.borderWidth') || '테두리 두께'}>
          <NumberInput
            value={keyPosition.borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH}
            onChange={(value) =>
              handleStyleChangeComplete('borderWidth', value)
            }
            onPreview={(value) => handleStylePreview('borderWidth', value)}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={20}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 모서리 반경 */}
        <PropertyRow label={t('propertiesPanel.borderRadius') || '모서리 반경'}>
          <NumberInput
            value={keyPosition.borderRadius ?? DEFAULT_ELEMENT_RADIUS}
            onChange={(value) =>
              handleStyleChangeComplete('borderRadius', value)
            }
            onPreview={(value) => handleStylePreview('borderRadius', value)}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={100}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 커스텀 이미지 - 단일 선택 모드에서만 표시 */}
        {onToggleImagePicker && imageButtonRef && (
          <PropertyRow
            label={t('propertiesPanel.customImage') || '커스텀 이미지'}
          >
            <button
              ref={imageButtonRef}
              type="button"
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                showImagePicker ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
              onClick={onToggleImagePicker}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>
        )}
      </PropertySection>

      <ShadowControls
        idleShadow={idleShadow}
        activeShadow={activeShadow}
        showActiveState={shadowActiveState}
        previewAnchor={canvasAnchor ?? null}
        onChange={(state, _shadow, patch) => {
          const leaf = elementShadowLeafFromPartial(patch);
          if (!leaf) return;
          onShadowCommit?.(
            state === 'active'
              ? { property: 'activeShadow', value: leaf }
              : { property: 'shadow', value: leaf },
          );
        }}
        onPreview={(state, leaf) =>
          onStylePropertyPreview?.({
            property: state === 'active' ? 'activeShadow' : 'shadow',
            value: leaf,
          })
        }
        onPreviewCancel={() => editGestureController.cancel()}
        onEnabledChange={(enabled) => {
          onShadowCommit?.({ property: 'shadowEnabled', value: enabled });
        }}
        panelElement={panelElement}
        t={t}
      />

      {/* 텍스트·폰트 */}
      <PropertySection>
        {/* 표시 텍스트 */}
        {!hideDisplayText && (
          <PropertyRow
            label={t('propertiesPanel.displayText') || '표시 텍스트'}
          >
            <TextInput
              value={keyPosition.displayText || ''}
              onChange={handleDisplayTextChange}
              onBlur={handleDisplayTextBlur}
              onCancel={() => editGestureController.cancel()}
              placeholder={keyInfo?.displayName || ''}
              width="54px"
            />
          </PropertyRow>
        )}

        {/* 폰트 */}
        <PropertyRow label={t('propertiesPanel.font') || '폰트'}>
          <FontPickerOpenButton
            activePageKey={activePageKey}
            pageKey={FONT_PAGE_KEY}
            onBeforeOpen={() => setPickerFor(null)}
            onOpen={() => openPage(FONT_PAGE_KEY)}
            onClose={closePage}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </FontPickerOpenButton>
        </PropertyRow>

        {/* 글꼴 크기 */}
        <PropertyRow label={t('propertiesPanel.fontSize') || '글꼴 크기'}>
          <NumberInput
            value={keyPosition.fontSize ?? 14}
            onChange={(value) => handleStyleChangeComplete('fontSize', value)}
            onPreview={(value) => handleStylePreview('fontSize', value)}
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={8}
            max={72}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 글꼴 굵기 */}
        <PropertyRow label={t('propertiesPanel.fontWeight') || '글꼴 굵기'}>
          <FontWeightDropdown
            fontFamilies={[keyPosition.fontFamily]}
            value={keyPosition.fontWeight ?? DEFAULT_ELEMENT_BASE_FONT_WEIGHT}
            onChange={(value) => handleStyleChangeComplete('fontWeight', value)}
          />
        </PropertyRow>

        {/* 글꼴 색상 */}
        <PropertyRow label={t('propertiesPanel.fontColor') || '글꼴 색상'}>
          <ColorSwatchButton
            ref={fontColorBtnRef}
            type="button"
            onClick={() => handlePickerToggle('fontColor')}
            open={pickerFor === 'fontColor'}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(colorValueFor('fontColor'))}
          />
        </PropertyRow>

        {/* 글꼴 스타일 */}
        <PropertyRow label={t('propertiesPanel.fontStyle') || '글꼴 스타일'}>
          <FontStyleToggle
            isBold={
              keyPosition.fontBold ??
              (keyPosition.fontWeight == null
                ? DEFAULT_ELEMENT_FONT_BOLD
                : keyPosition.fontWeight === 700)
            }
            isItalic={keyPosition.fontItalic ?? false}
            isUnderline={keyPosition.fontUnderline ?? false}
            isStrikethrough={keyPosition.fontStrikethrough ?? false}
            {...createFontStyleToggleHandlers(handleStyleChangeComplete)}
          />
        </PropertyRow>
      </PropertySection>

      {/* 커스텀 CSS 활성화 시에만 클래스명 및 CSS 우선순위 표시 */}
      {useCustomCSS && (
        <PropertySection>
          {/* CSS 우선순위 토글 */}
          <div className="flex justify-between items-center w-full min-h-[32px]">
            <p className="text-fg-muted text-label">
              {t('propertiesPanel.useInlineStyles') || '인라인 스타일 우선'}
            </p>
            <Checkbox
              commitStrategy="after-paint"
              checked={keyPosition.useInlineStyles ?? false}
              onChange={() =>
                handleStyleChangeComplete(
                  'useInlineStyles',
                  !(keyPosition.useInlineStyles ?? false),
                )
              }
            />
          </div>

          {/* 클래스명 */}
          <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
            <TextInput
              value={keyPosition.className || ''}
              onChange={handleClassNameChange}
              onBlur={handleClassNameBlur}
              onCancel={() => editGestureController.cancel()}
              placeholder="className"
              width="90px"
            />
          </PropertyRow>
        </PropertySection>
      )}

      {showSoundControls && (
        <PropertySection>
          <PropertyRow
            label={t('propertiesPanel.keySoundEnabled') || '키 사운드 활성화'}
          >
            <Checkbox
              commitStrategy="after-paint"
              checked={keyPosition.soundEnabled ?? false}
              onChange={() => {
                const nextEnabled = !(keyPosition.soundEnabled ?? false);
                onSoundEnabledCommit?.(nextEnabled);
              }}
            />
          </PropertyRow>

          <PropertyRow label={t('propertiesPanel.keySound') || '키 사운드'}>
            <button
              type="button"
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                activePageKey === SOUND_PAGE_KEY ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
              onClick={() => {
                setPickerFor(null);
                if (activePageKey === SOUND_PAGE_KEY) closePage();
                else openPage(SOUND_PAGE_KEY);
              }}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>

          <PropertyRow
            label={t('propertiesPanel.soundVolume') || '사운드 볼륨'}
          >
            <NumberInput
              value={keyPosition.soundVolume ?? 100}
              onChange={(value) => {
                const soundVolume = Math.max(0, Math.min(200, value));
                if (onSoundVolumeCommit) {
                  onSoundVolumeCommit(soundVolume);
                } else {
                  handleStyleChangeComplete('soundVolume', soundVolume);
                }
              }}
              onPreview={(value) =>
                handleStylePreview(
                  'soundVolume',
                  Math.max(0, Math.min(200, value)),
                )
              }
              onCancel={() => editGestureController.cancel()}
              suffix="%"
              min={0}
              max={200}
            />
          </PropertyRow>
        </PropertySection>
      )}

      {/* 이미지 픽커 팝업 - 단일 선택 모드에서만 */}
      <PopupExit open={showImagePicker}>
        {showImagePicker && onToggleImagePicker && imageButtonRef ? (
          <ImagePicker
            open={showImagePicker}
            previewAnchor={canvasAnchor ?? null}
            referenceRef={imageButtonRef}
            panelElement={panelElement}
            completionBinding="element-id"
            idleImage={keyPosition.inactiveImage || ''}
            activeImage={keyPosition.activeImage || ''}
            idleTransparent={keyPosition.idleTransparent ?? false}
            activeTransparent={keyPosition.activeTransparent ?? false}
            idleImageFit={
              keyPosition.idleImageFit ?? keyPosition.imageFit ?? 'cover'
            }
            activeImageFit={
              keyPosition.activeImageFit ?? keyPosition.imageFit ?? 'cover'
            }
            onIdleImageChange={handleIdleImageChange}
            onActiveImageChange={handleActiveImageChange}
            onIdleTransparentChange={handleIdleTransparentChange}
            onActiveTransparentChange={handleActiveTransparentChange}
            onIdleImageFitChange={handleIdleImageFitChange}
            onActiveImageFitChange={handleActiveImageFitChange}
            onIdleImageReset={handleIdleImageReset}
            onActiveImageReset={handleActiveImageReset}
            {...(shadowActiveState
              ? {
                  imageMode: keyPosition.imageMode,
                  idleImageTransform: keyPosition.idleImageTransform,
                  activeImageTransform: keyPosition.activeImageTransform,
                  onImageModeChange: handleImageModeChange,
                  onImageTransformChange: handleImageTransformChange,
                  onImageTransformPreview: handleImageTransformPreview,
                  onImageTransformCancel: handleImageTransformCancel,
                }
              : {})}
            onClose={() => onToggleImagePicker()}
            showActiveState={shadowActiveState}
          />
        ) : null}
      </PopupExit>

      {/* 통합 ColorPicker - 단일 인스턴스로 깜빡임 없이 전환 */}
      <PopupExit open={Boolean(pickerFor)}>
        {pickerFor ? (
          <ColorPicker
            open={!!pickerFor}
            referenceRef={
              pickerFor === 'backgroundColor'
                ? bgColorBtnRef
                : pickerFor === 'borderColor'
                ? borderColorBtnRef
                : fontColorBtnRef
            }
            panelElement={panelElement}
            color={
              gradientTarget
                ? gradientState.pickerColor
                : colorValueFor(pickerFor as StyleColorTarget)
            }
            onColorChange={(c: string) =>
              gradientTarget
                ? gradientState.handlePickerColorChange(c, false)
                : handleColorChange(pickerFor as StyleColorTarget, c)
            }
            onColorChangeComplete={(c: string) =>
              gradientTarget
                ? gradientState.handlePickerColorChange(c, true)
                : handleColorChangeComplete(pickerFor as StyleColorTarget, c)
            }
            onInputCancel={(_target, restoredColor) => {
              gradientState.cancelPreview();
              if (typeof restoredColor === 'string') {
                const prop = resolveColorProperty(
                  pickerFor as StyleColorTarget,
                );
                setLocalColors((prev) => ({
                  ...prev,
                  [prop]: restoredColor,
                }));
              }
              editGestureController.cancel();
            }}
            onClose={() => setPickerFor(null)}
            solidOnly={true}
            stateMode={shadowActiveState ? effectiveColorState : undefined}
            onStateModeChange={shadowActiveState ? setColorState : undefined}
            interactiveRefs={colorPickerInteractiveRefs}
            headerSlot={gradientTarget ? gradientState.headerSlot : undefined}
            footerSlot={gradientTarget ? gradientState.footerSlot : undefined}
            gradientSpec={
              gradientTarget ? gradientState.paletteGradientSpec : undefined
            }
            onGradientSpecSelect={
              gradientTarget
                ? gradientState.handleGradientSpecSelect
                : undefined
            }
          />
        ) : null}
      </PopupExit>

      {/* FontPicker — 패널 서브 페이지 */}
      {renderPageKey === FONT_PAGE_KEY &&
        pageHost &&
        createPortal(
          <FontPicker
            open
            selectedFont={keyPosition.fontFamily || null}
            onFontSelect={(fontName) => {
              if (fontName === null) return;
              const currentWeight =
                keyPosition.fontWeight ?? DEFAULT_ELEMENT_BASE_FONT_WEIGHT;
              const nextWeight = resolveSupportedFontWeight(
                fontName,
                useFontStore.getState().getAllFonts(),
              );
              // 굵기 재선택은 폰트 변경과 한 undo 단계 - 따로 되돌리면 새 폰트에
              // 지원하지 않는 굵기가 남는다
              const gestureId = crypto.randomUUID();
              handleStyleChangeComplete('fontFamily', fontName, { gestureId });
              if (nextWeight !== currentWeight) {
                handleStyleChangeComplete('fontWeight', nextWeight, {
                  gestureId,
                });
              }
            }}
            pageTitle={t('propertiesPanel.font') || '폰트'}
            onBack={closePage}
          />,
          pageHost,
        )}

      {/* SoundPicker — 패널 서브 페이지 */}
      {showSoundControls &&
        renderPageKey === SOUND_PAGE_KEY &&
        pageHost &&
        createPortal(
          <SoundPicker
            open
            completionBinding="element-id"
            selectedSound={keyPosition.soundPath || null}
            onSoundSelect={(soundPath) => {
              const nextPath = soundPath || '';
              onSoundPathCommit?.(nextPath);
            }}
            previewVolume={keyPosition.soundVolume ?? 100}
            pageTitle={t('propertiesPanel.keySound') || '키 사운드'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default StyleTabContent;
