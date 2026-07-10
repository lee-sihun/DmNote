import React, {
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useTranslation } from '@contexts/useTranslation';
import Dropdown from '@components/main/common/Dropdown';
import Checkbox from '@components/main/common/Checkbox';
import type {
  CounterTabState,
  CounterPreviewData,
} from '@hooks/Modal/useUnifiedKeySettingState';

// ============================================================================
// 타입 정의
// ============================================================================

interface CounterTabContentProps {
  state: CounterTabState;
  setState: React.Dispatch<React.SetStateAction<CounterTabState>>;
  onPreview: (updates: Omit<CounterPreviewData, 'type'>) => void;
}

type ColorPickerTarget =
  | 'fillIdle'
  | 'fillActive'
  | 'strokeIdle'
  | 'strokeActive';

export interface CounterTabContentRef {
  fillActiveBtnRef: React.RefObject<HTMLButtonElement>;
  colorPickerInteractiveRefs: Array<React.RefObject<HTMLElement>>;
  colorValueFor: (key: string | null) => string;
  setColorFor: (key: string | null, color: string) => void;
  handleColorComplete: (key: string | null, color: string) => void;
}

// ============================================================================
// 메인 컴포넌트
// ============================================================================

const CounterTabContent = forwardRef<
  CounterTabContentRef,
  CounterTabContentProps
>(({ state, setState, onPreview }, ref) => {
  const { t } = useTranslation();

  // 컬러 피커 위치 지정용 ref
  const fillIdleBtnRef = useRef<HTMLButtonElement>(null);
  const fillActiveBtnRef = useRef<HTMLButtonElement>(null);
  const strokeIdleBtnRef = useRef<HTMLButtonElement>(null);
  const strokeActiveBtnRef = useRef<HTMLButtonElement>(null);
  const fillGroupRef = useRef<HTMLDivElement>(null);
  const strokeGroupRef = useRef<HTMLDivElement>(null);
  const alignDropdownWrapperRef = useRef<HTMLDivElement>(null);
  const [alignDropdownWidth, setAlignDropdownWidth] = useState(0);

  // 드롭다운 너비 측정
  useEffect(() => {
    const measure = () => {
      if (!alignDropdownWrapperRef.current) return;
      const btn = alignDropdownWrapperRef.current.querySelector('button');
      if (btn) {
        const w = btn.offsetWidth;
        if (w && w !== alignDropdownWidth) setAlignDropdownWidth(w);
      }
    };

    measure();

    let ro: ResizeObserver | undefined;
    const btn = alignDropdownWrapperRef.current
      ? alignDropdownWrapperRef.current.querySelector('button')
      : null;
    if (btn && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(btn);
    }

    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
  }, [state.align, alignDropdownWidth]);

  // 옵션들
  const placementOptions = [
    { label: t('counterSetting.placementInside'), value: 'inside' },
    { label: t('counterSetting.placementOutside'), value: 'outside' },
  ];

  const alignOptions = [
    { label: t('counterSetting.alignTop'), value: 'top' },
    { label: t('counterSetting.alignBottom'), value: 'bottom' },
    { label: t('counterSetting.alignLeft'), value: 'left' },
    { label: t('counterSetting.alignRight'), value: 'right' },
  ];

  const alignModeOptions = [
    { label: t('counterSetting.alignModeCenter'), value: 'center' },
    { label: t('counterSetting.alignModeBetween'), value: 'between' },
  ];

  // 배치 변경 핸들러
  const handlePlacementChange = (value: string) => {
    setState((prev) => ({ ...prev, placement: value }));
    onPreview({ placement: value });
  };

  // 정렬 변경 핸들러
  const handleAlignChange = (value: string) => {
    setState((prev) => ({ ...prev, align: value }));
    onPreview({ align: value });
  };

  const handleAlignModeChange = (value: string) => {
    setState((prev) => ({ ...prev, alignMode: value }));
    onPreview({ alignMode: value });
  };

  // 간격 변경 핸들러
  const handleGapChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.replace(/[^0-9]/g, '');
    if (newValue === '') {
      setState((prev) => ({ ...prev, displayGap: '' }));
    } else {
      setState((prev) => ({ ...prev, displayGap: newValue }));
    }
  };

  const handleGapBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const inputValue = e.target.value.replace(/[^0-9]/g, '');
    if (inputValue === '' || Number.isNaN(parseInt(inputValue, 10))) {
      setState((prev) => ({
        ...prev,
        gap: 0,
        displayGap: '0px',
        isGapFocused: false,
      }));
      onPreview({ gap: 0 });
    } else {
      const numValue = parseInt(inputValue, 10);
      const clamped = Math.max(numValue, 0);
      setState((prev) => ({
        ...prev,
        gap: clamped,
        displayGap: `${clamped}px`,
        isGapFocused: false,
      }));
      onPreview({ gap: clamped });
    }
  };

  // 컬러 버튼 스타일
  const colorButtonClass = (active: boolean) =>
    `relative px-[8px] h-[23px] bg-white/[0.07] hover:bg-white/[0.1] active:bg-white/[0.13] transition-colors duration-fast rounded-md flex items-center justify-center ${
      active ? 'shadow-focus-ring' : ''
    } text-fg text-style-2`;

  // 컬러 프리뷰 박스
  const renderColorSquare = (style: React.CSSProperties) => (
    <div
      className="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px]"
      style={style}
    />
  );

  // 피커 토글 핸들러
  const handleColorToggle = (target: ColorPickerTarget) => {
    if (state.pickerOpen && state.pickerFor === target) {
      setState((prev) => ({ ...prev, pickerFor: null, pickerOpen: false }));
    } else {
      setState((prev) => ({ ...prev, pickerFor: target, pickerOpen: true }));
    }
  };

  const _closePicker = () => {
    setState((prev) => ({ ...prev, pickerFor: null, pickerOpen: false }));
  };

  // ref를 통해 refs와 핸들러 노출
  useImperativeHandle(
    ref,
    () => {
      const colorPickerInteractiveRefsInner = [
        fillIdleBtnRef,
        fillActiveBtnRef,
        strokeIdleBtnRef,
        strokeActiveBtnRef,
        fillGroupRef,
        strokeGroupRef,
      ];

      const colorValueForInner = (key: string | null): string => {
        switch (key) {
          case 'fillIdle':
            return state.fillIdle;
          case 'fillActive':
            return state.fillActive;
          case 'strokeIdle':
            return state.strokeIdle;
          case 'strokeActive':
            return state.strokeActive;
          default:
            return '#FFFFFF';
        }
      };

      const setColorForInner = (key: string | null, color: string) => {
        switch (key) {
          case 'fillIdle':
            setState((prev) => ({ ...prev, fillIdle: color }));
            break;
          case 'fillActive':
            setState((prev) => ({ ...prev, fillActive: color }));
            break;
          case 'strokeIdle':
            setState((prev) => ({ ...prev, strokeIdle: color }));
            break;
          case 'strokeActive':
            setState((prev) => ({ ...prev, strokeActive: color }));
            break;
          default:
            break;
        }
      };

      const handleColorCompleteInner = (key: string | null, color: string) => {
        switch (key) {
          case 'fillIdle':
            setState((prev) => ({ ...prev, fillIdle: color }));
            break;
          case 'fillActive':
            setState((prev) => ({ ...prev, fillActive: color }));
            break;
          case 'strokeIdle':
            setState((prev) => ({ ...prev, strokeIdle: color }));
            break;
          case 'strokeActive':
            setState((prev) => ({ ...prev, strokeActive: color }));
            break;
          default:
            break;
        }

        const payload = {
          placement: state.placement,
          align: state.align,
          alignMode: state.alignMode,
          gap: state.gap,
          fill: {
            idle: key === 'fillIdle' ? color : state.fillIdle,
            active: key === 'fillActive' ? color : state.fillActive,
          },
          stroke: {
            idle: key === 'strokeIdle' ? color : state.strokeIdle,
            active: key === 'strokeActive' ? color : state.strokeActive,
          },
        };
        onPreview(payload);
      };

      return {
        fillActiveBtnRef,
        colorPickerInteractiveRefs: colorPickerInteractiveRefsInner,
        colorValueFor: colorValueForInner,
        setColorFor: setColorForInner,
        handleColorComplete: handleColorCompleteInner,
      };
    },
    [state, setState, onPreview],
  );

  // 카운터 토글 핸들러
  const handleCounterToggle = () => {
    const newEnabled = !state.counterEnabled;
    setState((prev) => ({ ...prev, counterEnabled: newEnabled }));
    onPreview({ enabled: newEnabled });
  };

  return (
    <div className="flex flex-col gap-[19px]">
      {/* 배치 영역 */}
      <div className="flex justify-between w-full items-center">
        <p className="text-fg-muted text-label">
          {t('counterSetting.placementArea')}
        </p>
        <Dropdown
          options={placementOptions}
          value={state.placement}
          onChange={handlePlacementChange}
        />
      </div>

      {/* 정렬 방향 */}
      <div className="flex justify-between w-full items-center">
        <p className="text-fg-muted text-label">
          {t('counterSetting.alignDirection')}
        </p>
        <div ref={alignDropdownWrapperRef}>
          <Dropdown
            options={alignOptions}
            value={state.align}
            onChange={handleAlignChange}
          />
        </div>
      </div>

      {/* 정렬 방식 (내부 배치 전용) */}
      {state.placement === 'inside' && (
        <div className="flex justify-between w-full items-center">
          <p className="text-fg-muted text-label">
            {t('counterSetting.alignMode')}
          </p>
          <Dropdown
            options={alignModeOptions}
            value={state.alignMode}
            onChange={handleAlignModeChange}
          />
        </div>
      )}

      {/* 간격 */}
      <div className="flex justify-between w-full items-center">
        <p className="text-fg-muted text-label">{t('counterSetting.gap')}</p>
        <input
          type="text"
          value={state.displayGap}
          onChange={handleGapChange}
          onFocus={() =>
            setState((prev) => ({
              ...prev,
              isGapFocused: true,
              displayGap: String(prev.gap),
            }))
          }
          onBlur={handleGapBlur}
          className="text-center h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
          style={{
            width: alignDropdownWidth ? `${alignDropdownWidth}px` : undefined,
          }}
        />
      </div>

      {/* 채우기 */}
      <div className="flex justify-between w-full items-center">
        <p className="text-fg-muted text-label">{t('counterSetting.fill')}</p>
        <div ref={fillGroupRef} className="flex items-center gap-[8px]">
          <button
            ref={fillIdleBtnRef}
            type="button"
            className={colorButtonClass(
              state.pickerOpen && state.pickerFor === 'fillIdle',
            )}
            onClick={() => handleColorToggle('fillIdle')}
          >
            {renderColorSquare({ backgroundColor: state.fillIdle })}
            <span className="ml-[16px] text-left">
              {t('counterSetting.idle')}
            </span>
          </button>
          <button
            ref={fillActiveBtnRef}
            type="button"
            className={colorButtonClass(
              state.pickerOpen && state.pickerFor === 'fillActive',
            )}
            onClick={() => handleColorToggle('fillActive')}
          >
            {renderColorSquare({ backgroundColor: state.fillActive })}
            <span className="ml-[16px] text-left">
              {t('counterSetting.active')}
            </span>
          </button>
        </div>
      </div>

      {/* 외곽선 */}
      <div className="flex justify-between w-full items-center">
        <p className="text-fg-muted text-label">{t('counterSetting.stroke')}</p>
        <div ref={strokeGroupRef} className="flex items-center gap-[8px]">
          <button
            ref={strokeIdleBtnRef}
            type="button"
            className={colorButtonClass(
              state.pickerOpen && state.pickerFor === 'strokeIdle',
            )}
            onClick={() => handleColorToggle('strokeIdle')}
          >
            {renderColorSquare({ backgroundColor: state.strokeIdle })}
            <span className="ml-[16px] text-left">
              {t('counterSetting.idle')}
            </span>
          </button>
          <button
            ref={strokeActiveBtnRef}
            type="button"
            className={colorButtonClass(
              state.pickerOpen && state.pickerFor === 'strokeActive',
            )}
            onClick={() => handleColorToggle('strokeActive')}
          >
            {renderColorSquare({ backgroundColor: state.strokeActive })}
            <span className="ml-[16px] text-left">
              {t('counterSetting.active')}
            </span>
          </button>
        </div>
      </div>

      <div className="h-px w-full bg-line" />

      {/* 카운터 사용 */}
      <div className="flex justify-between w-full items-center">
        <p className="text-fg-muted text-label">
          {t('counterSetting.counterEnabled')}
        </p>
        <Checkbox
          checked={state.counterEnabled}
          onChange={handleCounterToggle}
        />
      </div>
    </div>
  );
});

export default CounterTabContent;
