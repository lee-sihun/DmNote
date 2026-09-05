/* eslint-disable react-hooks/set-state-in-effect */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ColorInputProps } from './types';
import { I18nContext } from '@contexts/I18nContextDef';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { gradientToCss } from '@src/types/color';

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
  const i18n = React.useContext(I18nContext);
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

  // 새로 열 때는 항상 대기 탭에서 시작 - 열림과 같은 이벤트에서 리셋해
  // 첫 렌더·최초 발행부터 이전 "입력" 선택이 새지 않는다
  const resetStateModeToIdle = () => {
    if (!showStateTabs) return;
    if (isStateControlled) {
      externalOnStateModeChange('idle');
    } else {
      setInternalStateMode('idle');
    }
  };

  const handleToggle = () => {
    if (isControlled) {
      if (!open) resetStateModeToIdle();
      externalOnToggle();
    } else if (internalOpen) {
      closeInternalPicker();
    } else {
      resetStateModeToIdle();
      setInternalOpen(true);
      schedulePickerMount();
    }
  };

  // controlled open을 부모가 토글 핸들러 없이 직접 여는 경로도 대기 시작 보장
  // layout effect라 리셋 전 상태가 화면·프리뷰에 새지 않는다 (핸들러 리셋과 중복 무해)
  const wasOpenRef = useRef(open);
  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) resetStateModeToIdle();
    wasOpenRef.current = open;
  });

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
      if (modeValue.mode === 'solid') {
        // 단색 확정은 일반 완료 파이프라인도 통과 - 부모의 드래그 정산 계약 유지
        handleColorChangeComplete(modeValue.color);
      } else {
        const base = modeValue.spec.stops[0]?.color ?? '#ffffff';
        if (showStateTabs && stateMode === 'active') setLocalActiveColor(base);
        else setLocalColor(base);
      }
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
        aria-label={i18n?.t('noteColor.color') ?? 'noteColor.color'}
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
