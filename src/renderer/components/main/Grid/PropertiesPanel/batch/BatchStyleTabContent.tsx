import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { KeyPosition } from '@src/types/key/keys';
import { resolveStatePair, type ColorModeValue } from '@src/types/color';
import {
  PropertyRow,
  NumberInput,
  ColorInput,
  TextInput,
  PropertySection,
  FontStyleToggle,
  createFontStyleToggleHandlers,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
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
import FontPicker from '@components/main/Modal/content/pickers/FontPicker';
import SoundPicker from '@components/main/Modal/content/pickers/SoundPicker';
import {
  LEGACY_BATCH_ELEMENT_BINDING,
  type BatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import { usePanelNav } from '../PanelNavContext';
import ShadowControls from '../ShadowControls';
import {
  resolveElementShadow,
  type ElementShadowSpec,
} from '@src/types/key/shadows';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import type { EditorPreviewStylePropertyPatchV1 } from '@src/types/editor';

// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const FONT_PAGE_KEY = 'batch-style:font';
// 결합 캡처 소유자(리마운트 경계 밖)가 open 판정에 쓰도록 export
export const BATCH_STYLE_SOUND_PAGE_KEY = 'batch-style:sound';
const SOUND_PAGE_KEY = BATCH_STYLE_SOUND_PAGE_KEY;

const SPACING_COMMIT_DEBOUNCE_MS = 80;
const SPACING_COMMIT_EPSILON = 0.0001;

interface KeyData {
  index: number;
  position: KeyPosition | undefined;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
}

interface BatchStyleTabContentProps {
  // 다중 선택 정보
  selectedCount: number;
  // 사운드 완료의 시작 시점 결합. 소유자는 EditSessionBoundary 밖 부모다 -
  // 이 컴포넌트는 선택 변경 시 리마운트되어 open 중 재캡처가 일어난다
  soundBinding?: BatchElementBinding;
  onSoundPathCommit?: (soundPath: string) => void;
  onSoundEnabledCommit?: (soundEnabled: boolean) => void;
  onSoundVolumeCommit?: (soundVolume: number) => void;
  onStylePropertyPreview?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  hideDisplayText?: boolean;
  hideFontControls?: boolean;
  showSoundControls?: boolean;
  showShadowControls?: boolean;
  // 선택에 키·노브가 없으면(통계뿐) 그림자 대기만 편집
  shadowActiveState?: boolean;
  shadowKind?: 'key' | 'knob';
  afterSizeContent?: React.ReactNode;
  // getMixedValue 함수
  getMixedValue: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  // getSelectedKeysData 함수 (displayText Mixed 판단용)
  getSelectedKeysData: () => KeyData[];
  // 핸들러
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string },
  ) => void;
  handleBatchSpacingPreview?: (spacing: number) => void;
  handleBatchSpacingCommit?: (
    spacing: number,
    options?: { gestureId?: string },
  ) => void;
  batchSpacing: { isMixed: boolean; value: number };
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  handleBatchShadowChangeComplete?: (
    state: 'idle' | 'active',
    patch: Partial<ElementShadowSpec>,
  ) => void;
  handleBatchShadowEnabledChange?: (enabled: boolean) => void;
  handleBatchGradientCommit?: (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
  ) => void;
  // 키 전용 (사운드 등)
  getKeyOnlyMixedValue?: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  handleKeyOnlyStyleChangeComplete?: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  // 눌림 가능(키·노브) — active 상태 집계·쓰기가 통계만 제외
  getActiveCapableMixedValue?: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  handleActiveCapableStyleChangeComplete?: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  // 이미지 피커
  showBatchImagePicker: boolean;
  onToggleBatchImagePicker: () => void;
  batchImageButtonRef: React.RefObject<HTMLButtonElement>;
  // 기타
  panelElement: HTMLElement | null;
  useCustomCSS: boolean;
  t: (key: string) => string;
}

const BatchStyleTabContent: React.FC<BatchStyleTabContentProps> = ({
  selectedCount,
  hideDisplayText = false,
  hideFontControls = false,
  soundBinding = LEGACY_BATCH_ELEMENT_BINDING,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  showSoundControls = false,
  showShadowControls = true,
  shadowActiveState = true,
  shadowKind = 'key',
  afterSizeContent,
  getMixedValue,
  getSelectedKeysData,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingCommit,
  batchSpacing,
  handleBatchResize,
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  handleBatchShadowChangeComplete,
  handleBatchShadowEnabledChange,
  handleBatchGradientCommit,
  getKeyOnlyMixedValue,
  handleKeyOnlyStyleChangeComplete,
  getActiveCapableMixedValue,
  handleActiveCapableStyleChangeComplete,
  showBatchImagePicker,
  onToggleBatchImagePicker,
  batchImageButtonRef,
  panelElement,
  useCustomCSS,
  t,
}) => {
  const [colorState, setColorState] = useState<'idle' | 'active'>('idle');
  const effectiveColorState = shadowActiveState ? colorState : 'idle';
  const activeMixedValue =
    getActiveCapableMixedValue ?? getKeyOnlyMixedValue ?? getMixedValue;
  const handleActiveStyleChangeComplete =
    handleActiveCapableStyleChangeComplete ??
    handleKeyOnlyStyleChangeComplete ??
    handleBatchStyleChangeComplete;
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  // 선택 구성 시그니처 — 형식 왕복 기억·드래그 소유권이 다른 배치 선택과
  // 교차하지 않게 keyType + 정렬된 대상 목록을 키에 포함
  const batchSelectionKey = useMemo(
    () =>
      `${selectedKeyType}:${selectedElements
        .map((el) => el.id)
        .sort()
        .join(',')}`,
    [selectedKeyType, selectedElements],
  );
  // 인-패널 내비게이션 (폰트/사운드 서브 페이지)
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();

  useEffect(() => {
    if (!shadowActiveState) setColorState('idle');
  }, [shadowActiveState]);

  const colorPairFor = (
    position: KeyPosition,
    target: 'backgroundColor' | 'borderColor',
    active: boolean,
  ) => {
    if (target === 'backgroundColor') {
      return resolveStatePair(
        active,
        {
          color: position.backgroundColor,
          gradient: position.backgroundGradient,
        },
        {
          color: position.activeBackgroundColor,
          gradient: position.activeBackgroundGradient,
        },
      );
    }
    return resolveStatePair(
      active,
      { color: position.borderColor, gradient: position.borderGradient },
      {
        color: position.activeBorderColor,
        gradient: position.activeBorderGradient,
      },
    );
  };

  const fontColorFor = (position: KeyPosition, active: boolean) => {
    const idle = position.fontColor?.trim() ? position.fontColor : undefined;
    const activeColor = position.activeFontColor?.trim()
      ? position.activeFontColor
      : undefined;
    return active ? activeColor ?? idle : idle;
  };

  const resolvedShadowFor = (position: KeyPosition, active: boolean) => {
    const hasImage = Boolean(
      active
        ? position.activeImage?.trim() || position.inactiveImage?.trim()
        : position.inactiveImage?.trim(),
    );
    const suppressDefault =
      hasImage ||
      (shadowKind === 'knob' &&
        ((active
          ? position.activeTransparent === true
          : position.idleTransparent === true) ||
          (position.borderWidth ?? 0) > 0));
    return resolveElementShadow({
      active,
      shadow: position.shadow,
      activeShadow: position.activeShadow,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
      suppressDefault,
    });
  };

  const getBatchShadow = (active: boolean) => {
    const fallback = active
      ? DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC
      : DEFAULT_ELEMENT_SHADOW_SPEC;
    const mixedValue = active ? activeMixedValue : getMixedValue;
    const enabled = mixedValue(
      (position) => resolvedShadowFor(position, active).enabled,
      fallback.enabled,
    );
    const color = mixedValue(
      (position) => resolvedShadowFor(position, active).color,
      fallback.color,
    );
    const offsetX = mixedValue(
      (position) => resolvedShadowFor(position, active).offsetX,
      fallback.offsetX,
    );
    const offsetY = mixedValue(
      (position) => resolvedShadowFor(position, active).offsetY,
      fallback.offsetY,
    );
    const blur = mixedValue(
      (position) => resolvedShadowFor(position, active).blur,
      fallback.blur,
    );

    return {
      value: {
        enabled: enabled.value,
        color: color.value,
        offsetX: offsetX.value,
        offsetY: offsetY.value,
        blur: blur.value,
      },
      // 대표값은 첫 요소 기준 — 토글 표시용 "하나라도 켜짐"은 별도 계산
      enabledAny: enabled.value || enabled.isMixed,
      isMixed:
        enabled.isMixed ||
        color.isMixed ||
        offsetX.isMixed ||
        offsetY.isMixed ||
        blur.isMixed,
    };
  };

  const batchIdleShadow = getBatchShadow(false);
  const batchActiveShadow = getBatchShadow(true);

  const handleShadowChange = (
    state: 'idle' | 'active',
    _shadow: ElementShadowSpec,
    patch: Partial<ElementShadowSpec>,
  ) => {
    handleBatchShadowChangeComplete?.(state, patch);
  };

  const handleShadowEnabledChange = (enabled: boolean) => {
    handleBatchShadowEnabledChange?.(enabled);
  };

  // 간격 입력 세션의 debounce 커밋들을 같은 gestureId로 묶어 백엔드가 한 entry로 병합
  const lastSpacingRef = useRef<number | null>(null);
  const lastCommittedSpacingRef = useRef<number | null>(null);
  const spacingDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const spacingGestureIdRef = useRef<string | null>(null);

  const isSameSpacingValue = (a: number | null, b: number | null): boolean => {
    if (a === null || b === null) return false;
    return Math.abs(a - b) < SPACING_COMMIT_EPSILON;
  };

  const commitSpacing = (spacing: number) => {
    spacingGestureIdRef.current ??= crypto.randomUUID();
    const options = { gestureId: spacingGestureIdRef.current };

    if (handleBatchSpacingCommit) {
      handleBatchSpacingCommit(spacing, options);
    } else {
      handleBatchSpacing(spacing, options);
    }

    lastCommittedSpacingRef.current = spacing;
  };

  const onSpacingChange = (value: number) => {
    lastSpacingRef.current = value;
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
    }
    spacingDebounceTimerRef.current = setTimeout(() => {
      spacingDebounceTimerRef.current = null;
      const spacing = lastSpacingRef.current;
      if (spacing === null) return;
      if (isSameSpacingValue(lastCommittedSpacingRef.current, spacing)) return;
      commitSpacing(spacing);
    }, SPACING_COMMIT_DEBOUNCE_MS);
  };

  const onSpacingBlur = () => {
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
      spacingDebounceTimerRef.current = null;
    }
    if (
      !isSameSpacingValue(
        lastCommittedSpacingRef.current,
        lastSpacingRef.current,
      )
    ) {
      const spacing = lastSpacingRef.current;
      if (spacing !== null) {
        commitSpacing(spacing);
      }
    }

    lastSpacingRef.current = null;
    lastCommittedSpacingRef.current = null;
    spacingGestureIdRef.current = null;
  };

  // Escape는 onBlur를 타지 않는다. 예약만 되고 아직 안 나간 커밋을 걷지 않으면
  // 취소한 값이 80ms 뒤에 그대로 적용된다. 이미 나간 커밋은 되돌리지 않는다 -
  // 항목별 원래 간격은 이 컴포넌트가 갖고 있지 않다
  const onSpacingCancel = () => {
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
      spacingDebounceTimerRef.current = null;
    }
    lastSpacingRef.current = null;
    lastCommittedSpacingRef.current = null;
    spacingGestureIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (spacingDebounceTimerRef.current) {
        clearTimeout(spacingDebounceTimerRef.current);
      }
    };
  }, []);

  // displayText의 실제 표시 값(displayText || keyInfo.displayName)을 기준으로 Mixed 판단
  const getDisplayTextMixed = (): { isMixed: boolean; value: string } => {
    const keysData = getSelectedKeysData();
    if (keysData.length === 0) return { isMixed: false, value: '' };

    const getEffectiveDisplayText = (data: KeyData): string => {
      const displayText = data.position?.displayText;
      if (displayText) return displayText;
      return data.keyInfo?.displayName || '';
    };

    const firstValue = getEffectiveDisplayText(keysData[0]);
    const isMixed = keysData.some(
      (data) => getEffectiveDisplayText(data) !== firstValue,
    );

    return { isMixed, value: firstValue };
  };

  return (
    <>
      <PropertySection>
        {/* 정렬 */}
        <PropertyRow label={t('propertiesPanel.alignment') || '정렬'}>
          <div className="flex gap-[4px]">
            {/* 수평 정렬 */}
            <div className="flex">
              <button
                type="button"
                onClick={() => handleBatchAlign('left')}
                className="w-[24px] h-[23px] bg-inset rounded-l-[7px] border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
                title={t('propertiesPanel.alignLeft') || '왼쪽 정렬'}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M1 1V9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <rect
                    x="2.5"
                    y="2.5"
                    width="6"
                    height="1.5"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <rect
                    x="2.5"
                    y="6"
                    width="4"
                    height="1.5"
                    rx="0.5"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleBatchAlign('centerH')}
                className="w-[24px] h-[23px] bg-inset border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
                title={t('propertiesPanel.alignCenterH') || '수평 중앙 정렬'}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M5 1V9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <rect
                    x="1.5"
                    y="2.5"
                    width="7"
                    height="1.5"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <rect
                    x="2.5"
                    y="6"
                    width="5"
                    height="1.5"
                    rx="0.5"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleBatchAlign('right')}
                className="w-[24px] h-[23px] bg-inset rounded-r-[7px] flex items-center justify-center hover:bg-surface-hover transition-colors"
                title={t('propertiesPanel.alignRight') || '오른쪽 정렬'}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M9 1V9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <rect
                    x="1.5"
                    y="2.5"
                    width="6"
                    height="1.5"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <rect
                    x="3.5"
                    y="6"
                    width="4"
                    height="1.5"
                    rx="0.5"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
            {/* 수직 정렬 */}
            <div className="flex">
              <button
                type="button"
                onClick={() => handleBatchAlign('top')}
                className="w-[24px] h-[23px] bg-inset rounded-l-[7px] border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
                title={t('propertiesPanel.alignTop') || '위쪽 정렬'}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M1 1H9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <rect
                    x="2.5"
                    y="2.5"
                    width="1.5"
                    height="6"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <rect
                    x="6"
                    y="2.5"
                    width="1.5"
                    height="4"
                    rx="0.5"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleBatchAlign('centerV')}
                className="w-[24px] h-[23px] bg-inset border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
                title={t('propertiesPanel.alignCenterV') || '수직 중앙 정렬'}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M1 5H9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <rect
                    x="2.5"
                    y="1.5"
                    width="1.5"
                    height="7"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <rect
                    x="6"
                    y="2.5"
                    width="1.5"
                    height="5"
                    rx="0.5"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleBatchAlign('bottom')}
                className="w-[24px] h-[23px] bg-inset rounded-r-[7px] flex items-center justify-center hover:bg-surface-hover transition-colors"
                title={t('propertiesPanel.alignBottom') || '아래쪽 정렬'}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M1 9H9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <rect
                    x="2.5"
                    y="1.5"
                    width="1.5"
                    height="6"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <rect
                    x="6"
                    y="3.5"
                    width="1.5"
                    height="4"
                    rx="0.5"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        </PropertyRow>

        {/* 분배 */}
        <PropertyRow label={t('propertiesPanel.distribution') || '분배'}>
          <div className="flex gap-[4px]">
            <button
              type="button"
              onClick={() => handleBatchDistribute('horizontal')}
              disabled={selectedCount < 3}
              className={`w-[24px] h-[23px] bg-inset rounded-md flex items-center justify-center transition-colors ${
                selectedCount < 3
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-surface-hover'
              }`}
              title={t('propertiesPanel.distributeH') || '수평 분배'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect
                  x="0.5"
                  y="2.5"
                  width="1.5"
                  height="5"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="4.25"
                  y="2.5"
                  width="1.5"
                  height="5"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="8"
                  y="2.5"
                  width="1.5"
                  height="5"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchDistribute('vertical')}
              disabled={selectedCount < 3}
              className={`w-[24px] h-[23px] bg-inset rounded-md flex items-center justify-center transition-colors ${
                selectedCount < 3
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-surface-hover'
              }`}
              title={t('propertiesPanel.distributeV') || '수직 분배'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect
                  x="2.5"
                  y="0.5"
                  width="5"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="2.5"
                  y="4.25"
                  width="5"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="2.5"
                  y="8"
                  width="5"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </PropertyRow>

        {/* 간격 */}
        <PropertyRow label={t('propertiesPanel.spacing') || '간격'}>
          <NumberInput
            value={batchSpacing.value}
            onChange={onSpacingChange}
            onBlur={onSpacingBlur}
            onCancel={onSpacingCancel}
            suffix="px"
            min={0}
            max={500}
            allowDecimal
            decimalScale={1}
            isMixed={batchSpacing.isMixed}
          />
        </PropertyRow>

        {/* 크기 */}
        <PropertyRow label={t('propertiesPanel.size') || '크기'}>
          <NumberInput
            value={getMixedValue((pos) => pos.width, 60).value}
            onChange={(value) => handleBatchResize('width', value)}
            onPreview={(value) => handleBatchStyleChange('width', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="W"
            width={AXIS_FIELD_WIDTH}
            min={10}
            max={500}
            allowDecimal
            decimalScale={1}
            isMixed={getMixedValue((pos) => pos.width, 60).isMixed}
          />
          <NumberInput
            value={getMixedValue((pos) => pos.height, 60).value}
            onChange={(value) => handleBatchResize('height', value)}
            onPreview={(value) => handleBatchStyleChange('height', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="H"
            width={AXIS_FIELD_WIDTH}
            min={10}
            max={500}
            allowDecimal
            decimalScale={1}
            isMixed={getMixedValue((pos) => pos.height, 60).isMixed}
          />
        </PropertyRow>
      </PropertySection>

      {afterSizeContent ? (
        <PropertySection>{afterSizeContent}</PropertySection>
      ) : null}

      <PropertySection>
        {/* 배경색 */}
        <PropertyRow label={t('propertiesPanel.backgroundColor') || '배경색'}>
          {(
            effectiveColorState === 'active'
              ? activeMixedValue(
                  (pos) => colorPairFor(pos, 'backgroundColor', true).color,
                  DEFAULT_ELEMENT_ACTIVE_BG,
                ).isMixed
              : getMixedValue(
                  (pos) => colorPairFor(pos, 'backgroundColor', false).color,
                  DEFAULT_ELEMENT_BG,
                ).isMixed
          ) ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <ColorInput
            colorId={`batch-background:${batchSelectionKey}`}
            value={
              getMixedValue(
                (pos) => colorPairFor(pos, 'backgroundColor', false).color,
                DEFAULT_ELEMENT_BG,
              ).value
            }
            activeValue={
              activeMixedValue(
                (pos) => colorPairFor(pos, 'backgroundColor', true).color,
                DEFAULT_ELEMENT_ACTIVE_BG,
              ).value
            }
            showStateTabs={shadowActiveState}
            stateMode={effectiveColorState}
            onStateModeChange={setColorState}
            onChange={(color) =>
              handleBatchStyleChange('backgroundColor', color)
            }
            onChangeComplete={(color) =>
              handleBatchStyleChangeComplete('backgroundColor', color)
            }
            onActiveChangeComplete={(color) =>
              handleActiveStyleChangeComplete('activeBackgroundColor', color)
            }
            panelElement={panelElement}
            canvasAnchor={{ kind: 'batch' }}
            gradientValue={
              getMixedValue(
                (pos) =>
                  colorPairFor(pos, 'backgroundColor', false).gradient ?? null,
                null,
              ).value
            }
            activeGradientValue={
              activeMixedValue(
                (pos) =>
                  colorPairFor(pos, 'backgroundColor', true).gradient ?? null,
                null,
              ).value
            }
            onModeCommit={
              handleBatchGradientCommit
                ? (state, modeValue) =>
                    handleBatchGradientCommit(
                      'backgroundColor',
                      state,
                      modeValue,
                    )
                : undefined
            }
          />
        </PropertyRow>

        {/* 테두리 색상 */}
        <PropertyRow label={t('propertiesPanel.borderColor') || '테두리 색상'}>
          {(
            effectiveColorState === 'active'
              ? activeMixedValue(
                  (pos) => colorPairFor(pos, 'borderColor', true).color,
                  DEFAULT_ELEMENT_ACTIVE_BORDER,
                ).isMixed
              : getMixedValue(
                  (pos) => colorPairFor(pos, 'borderColor', false).color,
                  DEFAULT_ELEMENT_BORDER,
                ).isMixed
          ) ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <ColorInput
            colorId={`batch-border:${batchSelectionKey}`}
            gradientSurface="border"
            value={
              getMixedValue(
                (pos) => colorPairFor(pos, 'borderColor', false).color,
                DEFAULT_ELEMENT_BORDER,
              ).value
            }
            activeValue={
              activeMixedValue(
                (pos) => colorPairFor(pos, 'borderColor', true).color,
                DEFAULT_ELEMENT_ACTIVE_BORDER,
              ).value
            }
            showStateTabs={shadowActiveState}
            stateMode={effectiveColorState}
            onStateModeChange={setColorState}
            onChange={(color) => handleBatchStyleChange('borderColor', color)}
            onChangeComplete={(color) =>
              handleBatchStyleChangeComplete('borderColor', color)
            }
            onActiveChangeComplete={(color) =>
              handleActiveStyleChangeComplete('activeBorderColor', color)
            }
            panelElement={panelElement}
            canvasAnchor={{ kind: 'batch' }}
            gradientValue={
              getMixedValue(
                (pos) =>
                  colorPairFor(pos, 'borderColor', false).gradient ?? null,
                null,
              ).value
            }
            activeGradientValue={
              activeMixedValue(
                (pos) =>
                  colorPairFor(pos, 'borderColor', true).gradient ?? null,
                null,
              ).value
            }
            onModeCommit={
              handleBatchGradientCommit
                ? (state, modeValue) =>
                    handleBatchGradientCommit('borderColor', state, modeValue)
                : undefined
            }
          />
        </PropertyRow>

        {/* 테두리 두께 */}
        <PropertyRow label={t('propertiesPanel.borderWidth') || '테두리 두께'}>
          {getMixedValue(
            (pos) => pos.borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH,
            DEFAULT_ELEMENT_BORDER_WIDTH,
          ).isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <NumberInput
            value={
              getMixedValue(
                (pos) => pos.borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH,
                DEFAULT_ELEMENT_BORDER_WIDTH,
              ).value
            }
            onChange={(value) =>
              onStylePropertyCommit
                ? onStylePropertyCommit({ borderWidth: value })
                : handleBatchStyleChangeComplete('borderWidth', value)
            }
            onPreview={(value) =>
              onStylePropertyPreview
                ? onStylePropertyPreview({ borderWidth: value })
                : handleBatchStyleChange('borderWidth', value)
            }
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
          {getMixedValue((pos) => pos.borderRadius, DEFAULT_ELEMENT_RADIUS)
            .isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <NumberInput
            value={
              getMixedValue((pos) => pos.borderRadius, DEFAULT_ELEMENT_RADIUS)
                .value
            }
            onChange={(value) =>
              onStylePropertyCommit
                ? onStylePropertyCommit({ borderRadius: value })
                : handleBatchStyleChangeComplete('borderRadius', value)
            }
            onPreview={(value) =>
              onStylePropertyPreview
                ? onStylePropertyPreview({ borderRadius: value })
                : handleBatchStyleChange('borderRadius', value)
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={100}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 커스텀 이미지 */}
        <PropertyRow
          label={t('propertiesPanel.customImage') || '커스텀 이미지'}
        >
          <button
            ref={batchImageButtonRef}
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              showBatchImagePicker ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={onToggleBatchImagePicker}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>
      </PropertySection>

      {showShadowControls ? (
        <ShadowControls
          idleShadow={batchIdleShadow.value}
          activeShadow={batchActiveShadow.value}
          idleMixed={batchIdleShadow.isMixed}
          activeMixed={batchActiveShadow.isMixed}
          anyEnabled={
            batchIdleShadow.enabledAny ||
            (shadowActiveState && batchActiveShadow.enabledAny)
          }
          showActiveState={shadowActiveState}
          onChange={handleShadowChange}
          onEnabledChange={handleShadowEnabledChange}
          panelElement={panelElement}
          t={t}
        />
      ) : null}

      {(!hideDisplayText || !hideFontControls) && (
        <PropertySection>
          {/* 표시 텍스트 */}
          {!hideDisplayText && (
            <PropertyRow
              label={t('propertiesPanel.displayText') || '표시 텍스트'}
            >
              {(() => {
                const { isMixed, value } = getDisplayTextMixed();
                const displayTextValue = getMixedValue(
                  (pos) => pos.displayText,
                  '',
                ).value;
                // displayText가 직접 설정되어 있으면 그 값을 value에, 아니면 placeholder에 기본값 표시
                return (
                  <TextInput
                    value={isMixed ? '' : displayTextValue}
                    onChange={(v) => {
                      if (onStylePropertyCommit)
                        onStylePropertyCommit({ displayText: v });
                      else handleBatchStyleChangeComplete('displayText', v);
                    }}
                    onPreview={(v) => {
                      if (onStylePropertyPreview)
                        onStylePropertyPreview({ displayText: v });
                      else handleBatchStyleChange('displayText', v);
                    }}
                    onCancel={() => editGestureController.cancel()}
                    placeholder={isMixed ? 'Mixed' : value}
                    width="54px"
                    isMixed={isMixed}
                  />
                );
              })()}
            </PropertyRow>
          )}

          {!hideFontControls && (
            <>
              {/* 폰트 */}
              <PropertyRow label={t('propertiesPanel.font') || '폰트'}>
                {getMixedValue((pos) => pos.fontFamily, null).isMixed ? (
                  <span className="text-fg-faint text-body italic">Mixed</span>
                ) : null}
                <button
                  type="button"
                  className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                    activePageKey === FONT_PAGE_KEY ? 'shadow-focus-ring' : ''
                  } text-fg text-body`}
                  onClick={() => {
                    if (activePageKey === FONT_PAGE_KEY) closePage();
                    else openPage(FONT_PAGE_KEY);
                  }}
                >
                  {t('propertiesPanel.configure') || '설정하기'}
                </button>
              </PropertyRow>

              {/* 글꼴 크기 */}
              <PropertyRow label={t('propertiesPanel.fontSize') || '글꼴 크기'}>
                {getMixedValue((pos) => pos.fontSize, 14).isMixed ? (
                  <span className="text-fg-faint text-body italic">Mixed</span>
                ) : null}
                <NumberInput
                  value={getMixedValue((pos) => pos.fontSize, 14).value}
                  onChange={(value) =>
                    onStylePropertyCommit
                      ? onStylePropertyCommit({ fontSize: value })
                      : handleBatchStyleChangeComplete('fontSize', value)
                  }
                  onPreview={(value) =>
                    onStylePropertyPreview
                      ? onStylePropertyPreview({ fontSize: value })
                      : handleBatchStyleChange('fontSize', value)
                  }
                  onCancel={() => editGestureController.cancel()}
                  suffix="px"
                  min={8}
                  max={72}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>

              {/* 글꼴 색상 */}
              <PropertyRow
                label={t('propertiesPanel.fontColor') || '글꼴 색상'}
              >
                {(
                  effectiveColorState === 'active'
                    ? activeMixedValue(
                        (pos) => fontColorFor(pos, true),
                        DEFAULT_ELEMENT_ACTIVE_FONT,
                      ).isMixed
                    : getMixedValue(
                        (pos) => fontColorFor(pos, false),
                        DEFAULT_ELEMENT_FONT,
                      ).isMixed
                ) ? (
                  <span className="text-fg-faint text-body italic">Mixed</span>
                ) : null}
                <ColorInput
                  value={
                    getMixedValue(
                      (pos) => fontColorFor(pos, false),
                      DEFAULT_ELEMENT_FONT,
                    ).value
                  }
                  activeValue={
                    activeMixedValue(
                      (pos) => fontColorFor(pos, true),
                      DEFAULT_ELEMENT_ACTIVE_FONT,
                    ).value
                  }
                  showStateTabs={shadowActiveState}
                  stateMode={effectiveColorState}
                  onStateModeChange={setColorState}
                  onChange={(color) =>
                    handleBatchStyleChange('fontColor', color)
                  }
                  onChangeComplete={(color) =>
                    handleBatchStyleChangeComplete('fontColor', color)
                  }
                  onActiveChangeComplete={(color) =>
                    handleActiveStyleChangeComplete('activeFontColor', color)
                  }
                  panelElement={panelElement}
                />
              </PropertyRow>

              {/* 글꼴 스타일 */}
              <PropertyRow
                label={t('propertiesPanel.fontStyle') || '글꼴 스타일'}
              >
                <FontStyleToggle
                  isBold={
                    getMixedValue(
                      (pos) =>
                        (pos.fontWeight ?? DEFAULT_ELEMENT_FONT_WEIGHT) >= 700,
                      true,
                    ).value
                  }
                  isItalic={getMixedValue((pos) => pos.fontItalic, false).value}
                  isUnderline={
                    getMixedValue((pos) => pos.fontUnderline, false).value
                  }
                  isStrikethrough={
                    getMixedValue((pos) => pos.fontStrikethrough, false).value
                  }
                  {...createFontStyleToggleHandlers(
                    handleBatchStyleChangeComplete,
                  )}
                />
              </PropertyRow>
            </>
          )}
        </PropertySection>
      )}

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
              checked={getMixedValue((pos) => pos.useInlineStyles, false).value}
              onChange={() => {
                const currentValue = getMixedValue(
                  (pos) => pos.useInlineStyles,
                  false,
                ).value;
                handleBatchStyleChangeComplete(
                  'useInlineStyles',
                  !currentValue,
                );
              }}
            />
          </div>

          {/* 클래스명 */}
          <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
            <TextInput
              value={
                getMixedValue((pos) => pos.className, '').isMixed
                  ? ''
                  : getMixedValue((pos) => pos.className, '').value
              }
              onChange={(value) => {
                if (onStylePropertyCommit)
                  onStylePropertyCommit({ className: value });
                else handleBatchStyleChangeComplete('className', value);
              }}
              onPreview={(value) => {
                if (onStylePropertyPreview)
                  onStylePropertyPreview({ className: value });
                else handleBatchStyleChange('className', value);
              }}
              onCancel={() => editGestureController.cancel()}
              placeholder={
                getMixedValue((pos) => pos.className, '').isMixed
                  ? 'Mixed'
                  : 'className'
              }
              width="90px"
              isMixed={getMixedValue((pos) => pos.className, '').isMixed}
            />
          </PropertyRow>
        </PropertySection>
      )}

      {showSoundControls &&
        (() => {
          const soundMixedValue = getKeyOnlyMixedValue ?? getMixedValue;
          const soundChangeComplete =
            handleKeyOnlyStyleChangeComplete ?? handleBatchStyleChangeComplete;
          return (
            <PropertySection>
              <PropertyRow
                label={
                  t('propertiesPanel.keySoundEnabled') || '키 사운드 활성화'
                }
              >
                {soundMixedValue((pos) => pos.soundEnabled, false).isMixed ? (
                  <span className="text-fg-faint text-body italic">Mixed</span>
                ) : null}
                <Checkbox
                  commitStrategy="after-paint"
                  checked={
                    soundMixedValue((pos) => pos.soundEnabled, false).value
                  }
                  onChange={() => {
                    const current = soundMixedValue(
                      (pos) => pos.soundEnabled,
                      false,
                    ).value;
                    const nextEnabled = !current;
                    if (onSoundEnabledCommit) {
                      onSoundEnabledCommit(nextEnabled);
                    } else {
                      soundChangeComplete('soundEnabled', nextEnabled);
                    }
                  }}
                />
              </PropertyRow>

              <PropertyRow label={t('propertiesPanel.keySound') || '키 사운드'}>
                {soundMixedValue((pos) => pos.soundPath, '').isMixed ? (
                  <span className="text-fg-faint text-body italic">Mixed</span>
                ) : null}
                <button
                  type="button"
                  className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                    activePageKey === SOUND_PAGE_KEY ? 'shadow-focus-ring' : ''
                  } text-fg text-body`}
                  onClick={() => {
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
                {soundMixedValue((pos) => pos.soundVolume, 100).isMixed ? (
                  <span className="text-fg-faint text-body italic">Mixed</span>
                ) : null}
                <NumberInput
                  value={soundMixedValue((pos) => pos.soundVolume, 100).value}
                  onChange={(value) => {
                    const soundVolume = Math.max(0, Math.min(200, value));
                    if (onSoundVolumeCommit) {
                      onSoundVolumeCommit(soundVolume);
                    } else {
                      soundChangeComplete('soundVolume', soundVolume);
                    }
                  }}
                  suffix="%"
                  min={0}
                  max={200}
                  isMixed={
                    soundMixedValue((pos) => pos.soundVolume, 100).isMixed
                  }
                />
              </PropertyRow>
            </PropertySection>
          );
        })()}

      {/* FontPicker — 패널 서브 페이지 */}
      {!hideFontControls &&
        renderPageKey === FONT_PAGE_KEY &&
        pageHost &&
        createPortal(
          <FontPicker
            open
            selectedFont={getMixedValue((pos) => pos.fontFamily, null).value}
            onFontSelect={(fontName) => {
              handleBatchStyleChangeComplete('fontFamily', fontName);
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
            open={true}
            completionBinding={soundBinding.binding}
            selectedSound={
              (getKeyOnlyMixedValue ?? getMixedValue)(
                (pos) => pos.soundPath,
                '',
              ).value || null
            }
            onSoundSelect={(soundPath) => {
              const nextPath = soundPath || '';
              if (onSoundPathCommit) {
                onSoundPathCommit(nextPath);
                return;
              }
              (
                handleKeyOnlyStyleChangeComplete ??
                handleBatchStyleChangeComplete
              )('soundPath', nextPath);
            }}
            previewVolume={
              (getKeyOnlyMixedValue ?? getMixedValue)(
                (pos) => pos.soundVolume,
                100,
              ).value
            }
            pageTitle={t('propertiesPanel.keySound') || '키 사운드'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default BatchStyleTabContent;
