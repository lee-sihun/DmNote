import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SizeCommit, StyleTabContentProps } from '../types';
import type { ImageFit, KeyPosition } from '@src/types/key/keys';
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
import {
  isSyntheticElementId,
  resolveElementByIdAcross,
} from '@src/renderer/editor/model/elementIdMap';
import { applyElementPatchById } from '@src/renderer/editor/runtime/elementPatch';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import ImagePicker from '../../../Modal/content/pickers/ImagePicker';
import ColorPicker from '../../../Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import FontPicker from '../../../Modal/content/pickers/FontPicker';
import SoundPicker from '../../../Modal/content/pickers/SoundPicker';
import Checkbox from '../../../common/Checkbox';
import { ColorSwatchButton } from '../../../Modal/content/pickers/ColorSwatch';
import ShadowControls from '../ShadowControls';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import {
  getActivePairPreservation,
  gradientPairPatch,
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
  DEFAULT_ELEMENT_FONT_WEIGHT,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import { resolveElementShadowForPosition } from '@src/types/key/shadows';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import type { GeometryField } from '@src/renderer/editor/runtime/elementOps';
import type { EditorShadowPropertyPatchV1 } from '@src/types/editor';

// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const FONT_PAGE_KEY = 'single-style:font';
const SOUND_PAGE_KEY = 'single-style:sound';

// 피커 타겟 타입
type PickerTarget =
  | 'backgroundColor'
  | 'borderColor'
  | 'fontColor'
  | 'image'
  | null;

type ColorState = 'idle' | 'active';
type StyleColorTarget = 'backgroundColor' | 'borderColor' | 'fontColor';
type GradientColorTarget = 'backgroundColor' | 'borderColor';
type ActiveStyleColorProperty =
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';
type StyleColorProperty =
  | StyleColorTarget
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';

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
  onSizeBlur?: (committed?: SizeCommit) => void;
  onGeometryCommit?: (field: GeometryField, value: number) => void;
}

const StyleTabContent: React.FC<StyleTabContentInternalProps> = ({
  keyIndex,
  keyPosition,
  keyCode: _keyCode,
  keyInfo,
  onPositionChange,
  onKeyUpdate,
  onKeyPreview,
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
  onSizeBlur,
  onGeometryCommit,
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
  const internalImageButtonRef = useRef<HTMLButtonElement>(null);

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

  // 실제 사용할 이미지 버튼 ref (외부에서 제공되면 외부 것 사용)
  const _actualImageButtonRef = imageButtonRef || internalImageButtonRef;

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = (target: PickerTarget) => {
    setPickerFor((prev) => (prev === target ? null : target));
  };

  // 이미지 피커 토글 (외부 핸들러가 있으면 사용, 없으면 내부 상태 사용)
  const _handleImagePickerToggle = () => {
    if (onToggleImagePicker) {
      onToggleImagePicker();
      setPickerFor(null); // 다른 피커 닫기
    } else {
      handlePickerToggle('image');
    }
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

  // 드래그 중 로컬 상태만 업데이트
  const handleColorChange = (target: StyleColorTarget, color: string) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));
  };

  // 드래그 완료 시 부모에게 전달
  const handleColorChangeComplete = (
    target: StyleColorTarget,
    color: string,
  ) => {
    const prop = resolveColorProperty(target);
    setLocalColors((prev) => ({ ...prev, [prop]: color }));

    const updates: Partial<KeyPosition> = {
      [prop]: color,
    } as Partial<KeyPosition>;

    // idle 편집 전 사용자 저장값 기준 active 모습 보존
    if (shadowActiveState && effectiveColorState !== 'active') {
      const activeProp = activeColorPropertyFor(target);
      const preservation = getActivePairPreservation(
        {
          color: keyPosition[target],
          gradient: storedGradientOf(target),
        },
        {
          color: keyPosition[activeProp],
          gradient: storedGradientOf(activeProp),
        },
      );
      if (preservation?.color !== undefined) {
        updates[activeProp] = preservation.color;
      }
      if (target !== 'fontColor' && preservation?.gradient !== undefined) {
        const activeSibling =
          target === 'backgroundColor'
            ? 'activeBackgroundGradient'
            : 'activeBorderGradient';
        updates[activeSibling] = preservation.gradient;
      }
    }

    onKeyUpdate({ index: keyIndex, ...updates });
  };

  // ── 그라데이션 배선 (배경·테두리 전용, 글꼴 색상은 단색 유지) ──

  const gradientTarget: GradientColorTarget | null =
    pickerFor === 'backgroundColor' || pickerFor === 'borderColor'
      ? pickerFor
      : null;

  const gradientSpecFor = (
    target: GradientColorTarget,
  ): GradientSpec | null => {
    const idleGradient = storedGradientOf(target);
    if (effectiveColorState !== 'active') return idleGradient;
    const activeProp = activeColorPropertyFor(target);
    const activeGradient = storedGradientOf(activeProp);
    const activeHasValue =
      isNonEmptyString(keyPosition[activeProp]) || activeGradient != null;
    return activeHasValue ? activeGradient : idleGradient;
  };

  const handleGradientPreview = (value: ColorModeValue) => {
    if (!gradientTarget) return;
    if (value.mode === 'solid') handleColorChange(gradientTarget, value.color);
  };

  const handleGradientCommit = (value: ColorModeValue) => {
    if (!gradientTarget) return;
    const prop = resolveColorProperty(gradientTarget);
    if (onPaintCommit) {
      const descriptor = paintDescriptor(value);
      const paintField =
        effectiveColorState === 'active'
          ? gradientTarget === 'backgroundColor'
            ? 'activeBackgroundPaint'
            : 'activeBorderPaint'
          : gradientTarget === 'backgroundColor'
          ? 'backgroundPaint'
          : 'borderPaint';
      setLocalColors((prev) => ({ ...prev, [prop]: descriptor.color }));
      onPaintCommit({ [paintField]: descriptor } as never);
      return;
    }
    const patch = gradientPairPatch(
      prop as Parameters<typeof gradientPairPatch>[0],
      value,
    ) as Partial<KeyPosition>;

    const baseColor = patch[prop];
    if (typeof baseColor === 'string') {
      setLocalColors((prev) => ({ ...prev, [prop]: baseColor }));
    }

    const updates: Partial<KeyPosition> = { ...patch };

    // idle 편집 전 사용자 저장값 기준 active 쌍 보존
    if (shadowActiveState && effectiveColorState !== 'active') {
      const activeProp = activeColorPropertyFor(gradientTarget);
      const preservation = getActivePairPreservation(
        {
          color: keyPosition[gradientTarget],
          gradient: storedGradientOf(gradientTarget),
        },
        {
          color: keyPosition[activeProp],
          gradient: storedGradientOf(activeProp),
        },
      );
      if (preservation?.color !== undefined) {
        updates[activeProp] = preservation.color;
      }
      if (preservation?.gradient !== undefined) {
        const activeSibling =
          gradientTarget === 'backgroundColor'
            ? 'activeBackgroundGradient'
            : 'activeBorderGradient';
        updates[activeSibling] = preservation.gradient;
      }
    }

    onKeyUpdate({ index: keyIndex, ...updates });
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
    contextKey: `${
      canvasAnchor?.kind ?? 'key'
    }:${selectedKeyType}:${keyIndex}:${
      pickerFor ?? 'none'
    }:${effectiveColorState}`,
    canvasAnchor: gradientTarget ? canvasAnchor : undefined,
    canvasSurface: gradientTarget === 'borderColor' ? 'border' : 'background',
    canvasState: effectiveColorState,
    onPreview: handleGradientPreview,
    onCommit: handleGradientCommit,
  });

  // 위치 변경 핸들러
  const handlePositionXChange = (value: number) => {
    if (onLocalDxChange) {
      onLocalDxChange(value);
    }
    if (onGeometryCommit) {
      onGeometryCommit('dx', value);
    } else {
      onPositionChange(keyIndex, value, localDy ?? keyPosition.dy);
    }
  };

  const handlePositionYChange = (value: number) => {
    if (onLocalDyChange) {
      onLocalDyChange(value);
    }
    if (onGeometryCommit) {
      onGeometryCommit('dy', value);
    } else {
      onPositionChange(keyIndex, localDx ?? keyPosition.dx, value);
    }
  };

  // 크기 변경 핸들러
  const handleWidthChange = (value: number) => {
    if (onLocalWidthChange) {
      onLocalWidthChange(value);
      onKeyPreview?.(keyIndex, { width: value });
    } else {
      onKeyUpdate({ index: keyIndex, width: value });
    }
  };

  const handleHeightChange = (value: number) => {
    if (onLocalHeightChange) {
      onLocalHeightChange(value);
      onKeyPreview?.(keyIndex, { height: value });
    } else {
      onKeyUpdate({ index: keyIndex, height: value });
    }
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
          ? { borderWidth: value }
          : property === 'borderRadius'
          ? { borderRadius: value }
          : { fontSize: value },
      );
      return;
    }
    onKeyPreview?.(keyIndex, { [property]: value });
  };

  const handleStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
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
          ? { borderWidth: value }
          : property === 'borderRadius'
          ? { borderRadius: value }
          : { fontSize: value },
      );
      return;
    }
    onKeyUpdate({ index: keyIndex, [property]: value });
  };

  // 작업 시작(=이 렌더) 시점의 소속 컬렉션. in-flight 클로저에 함께 캡처된다.
  // 이 패널은 writer가 key/stat 어느 쪽인지 모르므로 시작 시점 소속으로 고정한다
  const boundElementType = keyPosition.id
    ? resolveElementByIdAcross(['key', 'stat'], keyPosition.id)?.type ?? null
    : null;

  // 비동기 완료 전용 적용자. 파일 대화상자·모달을 기다리는 사이 배열 재정렬이나
  // 모드 전환이 일어나도 id로 현재 (mode, index)를 다시 찾아 그 요소에 적용한다.
  // 삭제됐거나 type이 옮겨졌으면 자산만 남기고 연결은 조용히 중단한다
  const applyToBoundElement = (patch: Omit<Partial<KeyPosition>, 'id'>) => {
    const id = keyPosition.id;
    if (!id || isSyntheticElementId(id)) {
      // id 없는 구형 데이터는 기존 index 경로 유지
      onKeyPreview?.(keyIndex, patch);
      onKeyUpdate({ index: keyIndex, ...patch });
      return;
    }
    // id가 있는데 시작 시점 조회가 실패했으면 옛 index 폴백 대신 중단
    if (!boundElementType) return;
    applyElementPatchById(boundElementType, id, () => patch).catch(
      reportElementOpError,
    );
  };

  // 이미지 변경 핸들러
  const handleIdleImageChange = (imageUrl: string) => {
    if (onInactiveImageCommit) {
      onInactiveImageCommit(imageUrl);
      return;
    }
    applyToBoundElement({ inactiveImage: imageUrl });
  };

  const handleActiveImageChange = (imageUrl: string) => {
    if (onActiveImageCommit) {
      onActiveImageCommit(imageUrl);
      return;
    }
    applyToBoundElement({ activeImage: imageUrl });
  };

  const handleIdleTransparentChange = (checked: boolean) => {
    if (onIdleTransparentCommit) {
      onIdleTransparentCommit(checked);
      return;
    }
    onKeyPreview?.(keyIndex, { idleTransparent: checked });
    onKeyUpdate({ index: keyIndex, idleTransparent: checked });
  };

  const handleActiveTransparentChange = (checked: boolean) => {
    if (onActiveTransparentCommit) {
      onActiveTransparentCommit(checked);
      return;
    }
    onKeyPreview?.(keyIndex, { activeTransparent: checked });
    onKeyUpdate({ index: keyIndex, activeTransparent: checked });
  };

  const handleIdleImageReset = () => {
    if (onInactiveImageCommit) {
      onInactiveImageCommit('');
      return;
    }
    onKeyPreview?.(keyIndex, { inactiveImage: '' });
    onKeyUpdate({ index: keyIndex, inactiveImage: '' });
  };

  const handleActiveImageReset = () => {
    if (onActiveImageCommit) {
      onActiveImageCommit('');
      return;
    }
    onKeyPreview?.(keyIndex, { activeImage: '' });
    onKeyUpdate({ index: keyIndex, activeImage: '' });
  };

  const handleIdleImageFitChange = (fit: ImageFit) => {
    if (onIdleImageFitCommit) {
      onIdleImageFitCommit(fit);
      return;
    }
    onKeyPreview?.(keyIndex, { idleImageFit: fit });
    onKeyUpdate({ index: keyIndex, idleImageFit: fit });
  };

  const handleActiveImageFitChange = (fit: ImageFit) => {
    if (onActiveImageFitCommit) {
      onActiveImageFitCommit(fit);
      return;
    }
    onKeyPreview?.(keyIndex, { activeImageFit: fit });
    onKeyUpdate({ index: keyIndex, activeImageFit: fit });
  };

  // 표시 텍스트 핸들러
  const handleDisplayTextChange = (value: string) => {
    if (onStylePropertyPreview) {
      onStylePropertyPreview({ displayText: value });
      return;
    }
    onKeyPreview?.(keyIndex, { displayText: value });
  };

  const handleDisplayTextBlur = (value: string) => {
    if (onStylePropertyCommit) {
      onStylePropertyCommit({ displayText: value });
      return;
    }
    onKeyUpdate({
      index: keyIndex,
      displayText: value,
    });
  };

  // 클래스명 핸들러
  const handleClassNameChange = (value: string) => {
    if (onStylePropertyPreview) {
      onStylePropertyPreview({ className: value });
      return;
    }
    onKeyPreview?.(keyIndex, { className: value });
  };

  const handleClassNameBlur = (value: string) => {
    if (onStylePropertyCommit) {
      onStylePropertyCommit({ className: value });
      return;
    }
    onKeyUpdate({ index: keyIndex, className: value });
  };

  // 이미지 피커 열림 상태 (외부 또는 내부)
  const _isImagePickerOpen = onToggleImagePicker
    ? showImagePicker
    : pickerFor === 'image';

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
              } text-fg text-label`}
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
                <span className="pl-[3px] tracking-[0.25px] -mr-[0.25px] text-fg-faint [font-feature-settings:'case']">
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
            onBlur={(width) => {
              if (onGeometryCommit) {
                if (width !== undefined) onGeometryCommit('width', width);
                return;
              }
              onSizeBlur?.({ width });
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
            onBlur={(height) => {
              if (onGeometryCommit) {
                if (height !== undefined) onGeometryCommit('height', height);
                return;
              }
              onSizeBlur?.({ height });
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
        onChange={(state, shadow, patch) => {
          if (onShadowCommit) {
            onShadowCommit({
              [state === 'active' ? 'activeShadow' : 'shadow']: patch,
            } as EditorShadowPropertyPatchV1);
            return;
          }
          onKeyUpdate({
            index: keyIndex,
            [state === 'active' ? 'activeShadow' : 'shadow']: shadow,
          });
        }}
        onEnabledChange={(enabled) => {
          if (onShadowCommit) {
            onShadowCommit({ shadowEnabled: enabled });
            return;
          }
          onKeyUpdate({
            index: keyIndex,
            shadow: { ...idleShadow, enabled },
            // 눌림 상태가 없는 요소는 activeShadow를 기록하지 않음
            ...(shadowActiveState
              ? { activeShadow: { ...activeShadow, enabled } }
              : {}),
          });
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
          <button
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              activePageKey === FONT_PAGE_KEY ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={() => {
              setPickerFor(null);
              if (activePageKey === FONT_PAGE_KEY) closePage();
              else openPage(FONT_PAGE_KEY);
            }}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
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
              (keyPosition.fontWeight ?? DEFAULT_ELEMENT_FONT_WEIGHT) >= 700
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
                if (onSoundEnabledCommit) {
                  onSoundEnabledCommit(nextEnabled);
                } else {
                  onKeyPreview?.(keyIndex, { soundEnabled: nextEnabled });
                  onKeyUpdate({ index: keyIndex, soundEnabled: nextEnabled });
                }
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
            referenceRef={imageButtonRef}
            panelElement={panelElement}
            completionBinding={
              onInactiveImageCommit ||
              onActiveImageCommit ||
              (isIndividualMode &&
                keyPosition.id &&
                !isSyntheticElementId(keyPosition.id))
                ? 'element-id'
                : 'session-mode'
            }
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
            onClose={() => onToggleImagePicker()}
            showActiveState={shadowActiveState}
          />
        ) : null}
      </PopupExit>

      {/* 통합 ColorPicker - 단일 인스턴스로 깜빡임 없이 전환 */}
      <PopupExit open={Boolean(pickerFor && pickerFor !== 'image')}>
        {pickerFor && pickerFor !== 'image' ? (
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
              handleStyleChangeComplete('fontFamily', fontName);
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
            completionBinding={
              onSoundPathCommit ||
              (keyPosition.id && !isSyntheticElementId(keyPosition.id))
                ? 'element-id'
                : 'session-mode'
            }
            selectedSound={keyPosition.soundPath || null}
            onSoundSelect={(soundPath) => {
              const nextPath = soundPath || '';
              if (onSoundPathCommit) {
                onSoundPathCommit(nextPath);
                return;
              }
              applyToBoundElement({ soundPath: nextPath });
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
