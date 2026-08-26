/* eslint-disable react-hooks/set-state-in-effect */
import React, {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import type {
  PropertyRowProps,
  TextInputProps,
  ColorInputProps,
  TabsProps,
  FontStyleToggleProps,
} from './types';
import { TABS } from './types';
import {
  SECTION_CARD_CLASS,
  FORM_ROW_CLASS,
  FORM_LABEL_CLASS,
} from '@utils/cardRecipes';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { gradientToCss } from '@src/types/color';
import { registerEditorDraftForLifecycle } from '@src/renderer/editor/runtime/lifecycleEditorDraft';
import { useAfterPaintValueCommit } from '@hooks/useAfterPaintValueCommit';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';
import TabSwitch from '@components/main/common/TabSwitch';

// ============================================================================
// 속성 행
// ============================================================================

export const PropertyRow: React.FC<PropertyRowProps> = ({
  label,
  children,
}) => (
  <div className={FORM_ROW_CLASS}>
    <p className={FORM_LABEL_CLASS}>{label}</p>
    <div className="flex items-center gap-[8px]">{children}</div>
  </div>
);

// 그룹 카드 — 관련 속성 행을 하나의 면으로 묶는 섹션 컨테이너.
// data 표식은 분리 창 피커가 좌우 정렬·폭을 맞추는 기준
export const PropertySection: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div data-dmn-section="true" className={SECTION_CARD_CLASS}>
    {children}
  </div>
);

// ============================================================================
// 숫자 입력
// ============================================================================

export {
  NumberInput,
  OptionalNumberInput,
} from '@components/main/common/NumberInput';

// ============================================================================
// 텍스트 입력
// ============================================================================

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  commitStrategy = 'after-paint',
  onBlur,
  onPreview,
  onCancel,
  placeholder,
  width = '90px',
  isMixed = false,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  // Escape로 blur된 경우 확정 없이 원복
  const escapedRef = useRef(false);
  const previewedRef = useRef(false);
  // 이번 편집에서 값을 내보냈는지. 되돌릴 게 없으면 취소가 호출부를 건드리면 안 된다
  const emittedRef = useRef(false);
  const committedValueRef = useRef(value);
  const committedMixedRef = useRef(isMixed);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionActiveRef = useRef(false);
  const unregisterLifecycleRef = useRef<(() => void) | null>(null);
  const finalizeRef = useRef<(finalValue: string) => void>(() => undefined);
  const liveCommit = onPreview ?? onChange;
  const { scheduleCommit, flushPendingCommit, cancelPendingCommit } =
    useAfterPaintValueCommit<string>({
      onCommit: liveCommit,
      strategy: commitStrategy,
      frameHostRef: inputRef,
    });

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value);
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    if (onPreview) previewedRef.current = true;
    emittedRef.current = true;
    scheduleCommit(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter는 blur를 통해 확정, Escape는 확정 없이 원복
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      // 되돌릴 게 있을 때만 이 필드가 Escape를 소비한다.
      // 팝업과 모달은 defaultPrevented로 한 겹씩 닫으므로, 손대지 않은 필드가 삼키면
      // 첫 Escape에 창이 안 닫힌다
      if (emittedRef.current) e.preventDefault();
      escapedRef.current = true;
      e.currentTarget.blur();
    }
  };

  const clearLifecycleRegistration = () => {
    unregisterLifecycleRef.current?.();
    unregisterLifecycleRef.current = null;
  };

  const finalize = (finalValue: string) => {
    if (!sessionActiveRef.current) return;
    sessionActiveRef.current = false;
    clearLifecycleRegistration();
    setIsFocused(false);
    if (escapedRef.current) {
      escapedRef.current = false;
      cancelPendingCommit();
      previewedRef.current = false;
      setLocalValue(committedValueRef.current);
      // 취소는 값을 내보낸 것과 같은 채널로 되돌린다. onPreview가 없는 입력은
      // 타이핑이 onChange로 이미 저장까지 갔으므로 되돌릴 길이 그것뿐이다.
      // Mixed는 되돌릴 값이 하나가 아니라 대표값을 쓰면 요소별 값이 사라진다
      // 취소 의미이므로 commit 성격의 onBlur는 호출하지 않음
      if (onCancel) {
        onCancel();
      } else if (emittedRef.current && !committedMixedRef.current && !isMixed) {
        (onPreview ?? onChange)(committedValueRef.current);
      }
      emittedRef.current = false;
      return;
    }
    // 확정은 입력 컴포넌트의 최종값 기준 (부모 store 재조회 금지)
    if (onPreview && previewedRef.current) {
      cancelPendingCommit();
      onChange(finalValue);
    } else {
      flushPendingCommit();
    }
    previewedRef.current = false;
    emittedRef.current = false;
    onBlur?.(finalValue);
  };

  useLayoutEffect(() => {
    finalizeRef.current = finalize;
  });

  useEffect(
    () => () => {
      sessionActiveRef.current = false;
      clearLifecycleRegistration();
    },
    [],
  );

  const handleFocus = () => {
    setIsFocused(true);
    escapedRef.current = false;
    previewedRef.current = false;
    emittedRef.current = false;
    committedValueRef.current = value;
    committedMixedRef.current = isMixed;
    sessionActiveRef.current = true;
    clearLifecycleRegistration();
    unregisterLifecycleRef.current = registerEditorDraftForLifecycle(() => {
      finalizeRef.current(inputRef.current?.value ?? value);
    });
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    finalize(event.currentTarget.value);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={localValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={`text-center h-[23px] p-[6px] bg-inset rounded-md ${
        isFocused ? 'shadow-focus-ring' : ''
      } text-body tabular-nums ${
        isMixed
          ? 'text-fg placeholder:text-fg-faint placeholder:italic'
          : 'text-fg'
      }`}
      style={{ width }}
    />
  );
};

// ============================================================================
// 컬러 입력
// ============================================================================

export const ColorInput: React.FC<ColorInputProps> = ({
  value,
  onChange,
  onPreview,
  pickerMountStrategy = 'after-paint',
  onChangeComplete,
  activeValue,
  onActiveChange,
  onActivePreview,
  onActiveChangeComplete,
  showStateTabs = false,
  stateMode: externalStateMode,
  onStateModeChange: externalOnStateModeChange,
  colorId,
  solidOnly = true,
  panelElement,
  isOpen: externalIsOpen,
  onToggle: externalOnToggle,
  gradientValue,
  activeGradientValue,
  onModeCommit,
  onModePreview,
  onCancel,
  canvasAnchor,
  gradientSurface = 'background',
  hexMixed = false,
  alphaMixed = false,
}) => {
  // 외부 제어 모드인지 확인
  const isControlled =
    externalIsOpen !== undefined && externalOnToggle !== undefined;

  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalIsOpen : internalOpen;
  const [internalPickerMounted, setInternalPickerMounted] = useState(false);
  const pickerMountFrameRef = useRef<number | null>(null);
  const pickerMountTimerRef = useRef<number | null>(null);

  const cancelPendingPickerMount = useCallback(() => {
    if (pickerMountFrameRef.current !== null) {
      cancelAnimationFrame(pickerMountFrameRef.current);
      pickerMountFrameRef.current = null;
    }
    if (pickerMountTimerRef.current !== null) {
      window.clearTimeout(pickerMountTimerRef.current);
      pickerMountTimerRef.current = null;
    }
  }, []);

  const schedulePickerMount = useCallback(() => {
    cancelPendingPickerMount();
    if (pickerMountStrategy === 'sync') {
      setInternalPickerMounted(true);
      return;
    }
    pickerMountFrameRef.current = requestAnimationFrame(() => {
      pickerMountFrameRef.current = null;
      pickerMountTimerRef.current = window.setTimeout(() => {
        pickerMountTimerRef.current = null;
        setInternalPickerMounted(true);
      }, 0);
    });
  }, [cancelPendingPickerMount, pickerMountStrategy]);

  const closeInternalPicker = useCallback(() => {
    cancelPendingPickerMount();
    setInternalPickerMounted(false);
    setInternalOpen(false);
  }, [cancelPendingPickerMount]);

  useEffect(
    () => () => {
      cancelPendingPickerMount();
    },
    [cancelPendingPickerMount],
  );

  const pickerMounted = isControlled ? open : internalPickerMounted;

  const isStateControlled =
    externalStateMode !== undefined && externalOnStateModeChange !== undefined;
  const [internalStateMode, setInternalStateMode] = useState<'idle' | 'active'>(
    'idle',
  );
  const stateMode =
    showStateTabs && isStateControlled
      ? externalStateMode
      : showStateTabs
      ? internalStateMode
      : 'idle';

  useEffect(() => {
    if (!showStateTabs) {
      setInternalStateMode('idle');
      if (!isControlled) closeInternalPicker();
    }
  }, [closeInternalPicker, showStateTabs, isControlled]);

  const buttonRef = useRef<HTMLButtonElement>(null);

  // 로컬 색상 상태 (드래그 중 UI 업데이트용)
  const [localColor, setLocalColor] = useState(value || '#FFFFFF');
  const [localActiveColor, setLocalActiveColor] = useState(
    activeValue ?? value ?? '#FFFFFF',
  );

  // 피커가 닫혀있을 때만 외부 prop과 동기화
  useEffect(() => {
    if (!open) {
      setLocalColor(value || '#FFFFFF');
      setLocalActiveColor(activeValue ?? value ?? '#FFFFFF');
    }
  }, [value, activeValue, open]);

  // colorId가 없으면 value 기반으로 생성
  const _stableId =
    colorId || `color-input-${value?.replace(/[^a-zA-Z0-9]/g, '')}`;

  const interactiveRefs = [buttonRef];

  const handleToggle = () => {
    if (isControlled) {
      externalOnToggle();
    } else if (internalOpen) {
      closeInternalPicker();
    } else {
      setInternalOpen(true);
      schedulePickerMount();
    }
  };

  const handleClose = () => {
    if (isControlled) {
      externalOnToggle();
    } else {
      closeInternalPicker();
    }
  };

  const setLocalColorForState = (color: string) => {
    if (showStateTabs && stateMode === 'active') {
      setLocalActiveColor(color);
      return;
    }
    setLocalColor(color);
  };

  // 드래그와 텍스트 입력은 같은 preview 채널을 쓴다
  const handleColorPreview = (color: string) => {
    setLocalColorForState(color);
    if (showStateTabs && stateMode === 'active') {
      onActivePreview?.(color);
      return;
    }
    onPreview?.(color);
  };

  // 드래그 완료 시 부모에게 전달
  const handleColorChangeComplete = (color: string) => {
    if (showStateTabs && stateMode === 'active') {
      setLocalActiveColor(color);
      onActiveChange?.(color);
      onActiveChangeComplete?.(color);
      return;
    }

    setLocalColor(color);
    onChange?.(color);
    onChangeComplete?.(color);
  };

  const handleStateModeChange = (nextMode: 'idle' | 'active') => {
    if (!showStateTabs) return;
    if (isStateControlled) {
      externalOnStateModeChange(nextMode);
      return;
    }
    setInternalStateMode(nextMode);
  };

  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  // ── gradient 배선 — onModeCommit이 주어진 경우에만 활성화 ──
  const supportsGradient = onModeCommit !== undefined;
  const storedGradient =
    stateMode === 'active'
      ? activeGradientValue ?? null
      : gradientValue ?? null;

  const gradientState = useGradientColorState({
    pair: supportsGradient
      ? {
          color:
            showStateTabs && stateMode === 'active'
              ? localActiveColor
              : localColor,
          gradient: storedGradient,
        }
      : {},
    fallbackColor: '#ffffff',
    contextKey: `${_stableId}:${stateMode}`,
    // 패널이 분리돼 있어도 캔버스 핸들은 메인 캔버스에 그려진다 (같은 React 트리)
    canvasAnchor: pickerMounted ? canvasAnchor : undefined,
    canvasSurface: gradientSurface,
    canvasState: stateMode,
    onPreview: (modeValue) => {
      if (modeValue.mode === 'solid') setLocalColorForState(modeValue.color);
      onModePreview?.(stateMode, modeValue);
    },
    onCancel,
    onCommit: (modeValue) => {
      const base =
        modeValue.mode === 'solid'
          ? modeValue.color
          : modeValue.spec.stops[0]?.color ?? '#ffffff';
      if (showStateTabs && stateMode === 'active') setLocalActiveColor(base);
      else setLocalColor(base);
      onModeCommit?.(stateMode, modeValue);
    },
  });

  const handleInputCancel = (
    _target: 'solid' | 'top' | 'bottom',
    restoredColor: string | { type: 'gradient'; top: string; bottom: string },
  ) => {
    gradientState.cancelPreview();
    if (typeof restoredColor === 'string') {
      setLocalColorForState(restoredColor);
    }
    onCancel?.();
  };

  return (
    <>
      <ColorSwatchButton
        ref={buttonRef}
        onClick={handleToggle}
        open={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
        surfaceClassName="rounded-md"
        color={getDisplayColor(
          showStateTabs && stateMode === 'active'
            ? localActiveColor
            : localColor,
        )}
        image={
          supportsGradient && storedGradient
            ? gradientToCss(storedGradient)
            : undefined
        }
      />
      <PopupExit open={pickerMounted}>
        {pickerMounted ? (
          <ColorPicker
            open={pickerMounted}
            referenceRef={buttonRef}
            panelElement={panelElement}
            color={
              supportsGradient
                ? gradientState.pickerColor
                : showStateTabs && stateMode === 'active'
                ? localActiveColor
                : localColor
            }
            onColorChange={
              supportsGradient
                ? (c: string) => gradientState.handlePickerColorChange(c, false)
                : handleColorPreview
            }
            onColorChangeComplete={
              supportsGradient
                ? (c: string) => gradientState.handlePickerColorChange(c, true)
                : handleColorChangeComplete
            }
            onClose={handleClose}
            onInputCancel={handleInputCancel}
            interactiveRefs={interactiveRefs}
            solidOnly={solidOnly}
            hexMixed={hexMixed}
            opacityPercentMixed={alphaMixed}
            stateMode={showStateTabs ? stateMode : undefined}
            onStateModeChange={
              showStateTabs ? handleStateModeChange : undefined
            }
            headerSlot={supportsGradient ? gradientState.headerSlot : undefined}
            footerSlot={
              supportsGradient ? <>{gradientState.footerSlot}</> : undefined
            }
            gradientSpec={
              supportsGradient ? gradientState.paletteGradientSpec : undefined
            }
            onGradientSpecSelect={
              supportsGradient
                ? gradientState.handleGradientSpecSelect
                : undefined
            }
          />
        ) : null}
      </PopupExit>
    </>
  );
};

// ============================================================================
// 글꼴 스타일 아이콘
// ============================================================================

// 렌더 크기가 viewBox보다 1px 작아 스트로크 값이 제각각이다 - 넷 다 화면상 1.2

const BoldIcon: React.FC = () => (
  <svg width="9" height="11" viewBox="0 0 10 12" fill="none">
    <path
      d="M1 1H5.5C7.433 1 9 2.343 9 4C9 5.657 7.433 6 5.5 6H1V1Z"
      stroke="currentColor"
      strokeWidth="1.33"
      strokeLinejoin="round"
    />
    <path
      d="M1 6H6C8.209 6 9.5 7.343 9.5 9C9.5 10.657 8.209 11 6 11H1V6Z"
      stroke="currentColor"
      strokeWidth="1.33"
      strokeLinejoin="round"
    />
  </svg>
);

const ItalicIcon: React.FC = () => (
  <svg width="7" height="11" viewBox="0 0 8 12" fill="none">
    <line
      x1="3"
      y1="1"
      x2="7"
      y2="1"
      stroke="currentColor"
      strokeWidth="1.37"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="11"
      x2="5"
      y2="11"
      stroke="currentColor"
      strokeWidth="1.37"
      strokeLinecap="round"
    />
    <line
      x1="5.5"
      y1="1"
      x2="2.5"
      y2="11"
      stroke="currentColor"
      strokeWidth="1.37"
      strokeLinecap="round"
    />
  </svg>
);

const UnderlineIcon: React.FC = () => (
  <svg width="11" height="13" viewBox="0 0 12 14" fill="none">
    <path
      d="M2 1V6C2 8.209 3.791 10 6 10C8.209 10 10 8.209 10 6V1"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="13"
      x2="11"
      y2="13"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
  </svg>
);

const StrikethroughIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <path
      d="M3 3C3 1.895 4.343 1 6 1C7.657 1 9 1.895 9 3C9 4 8 4.5 6 5"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
    <path
      d="M6 7C8 7.5 9 8 9 9C9 10.105 7.657 11 6 11C4.343 11 3 10.105 3 9"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="6"
      x2="11"
      y2="6"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
  </svg>
);

// ============================================================================
// 글꼴 스타일 토글
// ============================================================================

interface FontStyleButtonProps {
  active: boolean;
  title: string;
  onChange: (active: boolean) => void;
  children: React.ReactNode;
}

const FontStyleButton = ({
  active,
  title,
  onChange,
  children,
}: FontStyleButtonProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { value: visualActive, toggle } = useOptimisticBooleanCommit({
    canonicalValue: active,
    onCommit: onChange,
    frameHostRef: buttonRef,
  });
  const buttonClass = visualActive
    ? 'bg-fill-hover text-fg'
    : 'text-fg-faint hover:bg-fill hover:text-fg-muted';

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={visualActive}
      onClick={toggle}
      className={`w-[24px] h-[21px] flex items-center justify-center transition-colors duration-fast ${buttonClass}`}
      title={title}
    >
      {children}
    </button>
  );
};

export const FontStyleToggle: React.FC<FontStyleToggleProps> = ({
  isBold,
  isItalic,
  isUnderline,
  isStrikethrough,
  onBoldChange,
  onItalicChange,
  onUnderlineChange,
  onStrikethroughChange,
}) => {
  return (
    <div className="flex items-center h-[23px] bg-inset rounded-md overflow-hidden">
      <FontStyleButton active={isBold} onChange={onBoldChange} title="Bold">
        <BoldIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isItalic}
        onChange={onItalicChange}
        title="Italic"
      >
        <ItalicIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isUnderline}
        onChange={onUnderlineChange}
        title="Underline"
      >
        <UnderlineIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isStrikethrough}
        onChange={onStrikethroughChange}
        title="Strikethrough"
      >
        <StrikethroughIcon />
      </FontStyleButton>
    </div>
  );
};

// ============================================================================
// 탭 버튼 & 탭
// ============================================================================

export const Tabs: React.FC<TabsProps> = ({
  activeTab,
  onTabChange,
  t,
  availableTabs,
}) => {
  const tabs = availableTabs?.length
    ? availableTabs
    : [TABS.STYLE, TABS.NOTE, TABS.COUNTER];

  const labels: Record<string, string> = {
    [TABS.STYLE]: t('propertiesPanel.tabStyle') || '키',
    [TABS.NOTE]: t('propertiesPanel.tabNote') || '노트',
    [TABS.COUNTER]: t('propertiesPanel.tabCounter') || '카운터',
  };

  return (
    <TabSwitch
      tabs={tabs.map((tab) => ({ id: tab, label: labels[tab] }))}
      activeTab={activeTab}
      onTabChange={onTabChange}
      commitStrategy="after-paint"
    />
  );
};

// ============================================================================
// 아이콘 컴포넌트
// ============================================================================

export const CloseIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M1 1L9 9M9 1L1 9"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

// 레이어/속성 모드 전환 토글 아이콘
export const ModeToggleIcon: React.FC<{
  mode: 'layer' | 'property';
  disabled?: boolean;
}> = ({ mode, disabled = false }) => {
  const strokeColor = 'currentColor';
  const fillColor = 'currentColor';
  const disabledClass = disabled ? 'text-fg-disabled' : undefined;

  if (mode === 'layer') {
    // 레이어 아이콘 (쌓인 레이어)
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className={disabledClass}
      >
        <path
          d="M8 2L14 5.5L8 9L2 5.5L8 2Z"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M2 8L8 11.5L14 8"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2 10.5L8 14L14 10.5"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 속성 아이콘 (슬라이더/설정)
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={disabledClass}
    >
      <line
        x1="2"
        y1="4"
        x2="14"
        y2="4"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="5" cy="4" r="1.5" fill={fillColor} />
      <line
        x1="2"
        y1="8"
        x2="14"
        y2="8"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="11" cy="8" r="1.5" fill={fillColor} />
      <line
        x1="2"
        y1="12"
        x2="14"
        y2="12"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="7" cy="12" r="1.5" fill={fillColor} />
    </svg>
  );
};
