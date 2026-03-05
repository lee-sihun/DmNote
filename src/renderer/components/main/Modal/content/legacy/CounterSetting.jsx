import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from './ColorPicker';
import { useTranslation } from '@contexts/I18nContext';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/keys';

export default function CounterSettingModal({
  onClose,
  onSave,
  onPreview,
  initialSettings,
  keyName,
}) {
  const { t } = useTranslation();

  const resolvedSettings = useMemo(
    () =>
      normalizeCounterSettings(
        initialSettings ?? createDefaultCounterSettings(),
      ),
    [initialSettings],
  );

  const [placement, setPlacement] = useState(resolvedSettings.placement);
  const [align, setAlign] = useState(resolvedSettings.align);
  const [alignMode, setAlignMode] = useState(resolvedSettings.alignMode);
  const [gap, setGap] = useState(resolvedSettings.gap ?? 6);
  const [isGapFocused, setIsGapFocused] = useState(false);
  const [displayGap, setDisplayGap] = useState(
    `${resolvedSettings.gap ?? 6}px`,
  );

  const [fillIdle, setFillIdle] = useState(resolvedSettings.fill.idle);
  const [fillActive, setFillActive] = useState(resolvedSettings.fill.active);
  const [strokeIdle, setStrokeIdle] = useState(resolvedSettings.stroke.idle);
  const [strokeActive, setStrokeActive] = useState(
    resolvedSettings.stroke.active,
  );

  // 정렬 드롭다운과 동일한 폭으로 간격 인풋 너비를 맞추기 위한 참조 및 상태
  const alignDropdownWrapperRef = useRef(null);
  const [alignDropdownWidth, setAlignDropdownWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (!alignDropdownWrapperRef.current) return;
      const btn = alignDropdownWrapperRef.current.querySelector('button');
      if (btn) {
        const w = btn.offsetWidth;
        if (w && w !== alignDropdownWidth) setAlignDropdownWidth(w);
      }
    };

    // 초기 측정
    measure();

    // 버튼 자체 크기 변화를 감지
    let ro;
    const btn = alignDropdownWrapperRef.current
      ? alignDropdownWrapperRef.current.querySelector('button')
      : null;
    if (btn && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(btn);
    }

    // 윈도우 리사이즈 대응
    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
    // align 값/라벨 변경 시에도 재측정
  }, [align]);

  useEffect(() => {
    setPlacement(resolvedSettings.placement);
    setAlign(resolvedSettings.align);
    setAlignMode(resolvedSettings.alignMode);
    setGap(resolvedSettings.gap ?? 6);
    setDisplayGap(`${resolvedSettings.gap ?? 6}px`);
    setIsGapFocused(false);
    setFillIdle(resolvedSettings.fill.idle);
    setFillActive(resolvedSettings.fill.active);
    setStrokeIdle(resolvedSettings.stroke.idle);
    setStrokeActive(resolvedSettings.stroke.active);
    setPickerOpen(false);
    setPickerFor(null);
  }, [resolvedSettings]);

  // 실시간 프리뷰: 내부 상태가 변하면 즉시 onPreview 호출 (색상 제외)
  useEffect(() => {
    if (typeof onPreview !== 'function') return;
    const payload = {
      placement,
      align,
      alignMode,
      gap,
      fill: { idle: fillIdle, active: fillActive },
      stroke: { idle: strokeIdle, active: strokeActive },
    };
    onPreview(payload);
  }, [placement, align, alignMode, gap]);

  const [pickerFor, setPickerFor] = useState(null); // 'fillIdle' | 'fillActive' | 'strokeIdle' | 'strokeActive'
  const [pickerOpen, setPickerOpen] = useState(false);

  const fillIdleBtnRef = useRef(null);
  const fillActiveBtnRef = useRef(null);
  const strokeIdleBtnRef = useRef(null);
  const strokeActiveBtnRef = useRef(null);
  const fillGroupRef = useRef(null);
  const strokeGroupRef = useRef(null);

  const colorPickerInteractiveRefs = useMemo(
    () => [
      fillIdleBtnRef,
      fillActiveBtnRef,
      strokeIdleBtnRef,
      strokeActiveBtnRef,
      fillGroupRef,
      strokeGroupRef,
    ],
    [],
  );

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

  const colorButtonClass = (active) =>
    `relative px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
      active ? 'border-[#459BF8]' : 'border-[#3A3943]'
    } text-[#DBDEE8] text-style-2`;

  const renderColorSquare = (style) => (
    <div
      className="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px] border border-[#3A3943]"
      style={style}
    />
  );

  const closePicker = () => {
    setPickerOpen(false);
    setPickerFor(null);
  };

  const referenceRefFor = () => {
    // 항상 "채우기 위치에 고정 앵커
    return fillActiveBtnRef;
  };

  const colorValueFor = (key) => {
    switch (key) {
      case 'fillIdle':
        return fillIdle;
      case 'fillActive':
        return fillActive;
      case 'strokeIdle':
        return strokeIdle;
      case 'strokeActive':
        return strokeActive;
      default:
        return '#FFFFFF';
    }
  };

  const setColorFor = (key, color) => {
    switch (key) {
      case 'fillIdle':
        setFillIdle(color);
        break;
      case 'fillActive':
        setFillActive(color);
        break;
      case 'strokeIdle':
        setStrokeIdle(color);
        break;
      case 'strokeActive':
        setStrokeActive(color);
        break;
      default:
        break;
    }
  };

  const handleColorToggle = (target) => {
    if (pickerOpen && pickerFor === target) {
      closePicker();
    } else {
      setPickerFor(target);
      setPickerOpen(true);
    }
  };

  const handleColorComplete = (key, color) => {
    setColorFor(key, color);

    if (typeof onPreview !== 'function') return;

    const payload = {
      placement,
      align,
      alignMode,
      gap,
      fill: {
        idle: key === 'fillIdle' ? color : fillIdle,
        active: key === 'fillActive' ? color : fillActive,
      },
      stroke: {
        idle: key === 'strokeIdle' ? color : strokeIdle,
        active: key === 'strokeActive' ? color : strokeActive,
      },
    };
    onPreview(payload);
  };

  const handleApply = () => {
    const payload = {
      placement,
      align,
      alignMode,
      gap,
      fill: {
        idle: fillIdle,
        active: fillActive,
      },
      stroke: {
        idle: strokeIdle,
        active: strokeActive,
      },
    };
    if (typeof onSave === 'function') {
      onSave(normalizeCounterSettings(payload));
    }
  };

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col items-center justify-center p-[20px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] gap-[19px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 배치 영역 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('counterSetting.placementArea')}
          </p>
          <Dropdown
            options={placementOptions}
            value={placement}
            onChange={setPlacement}
          />
        </div>

        {/* 정렬 방향 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('counterSetting.alignDirection')}
          </p>
          <div ref={alignDropdownWrapperRef}>
            <Dropdown
              options={alignOptions}
              value={align}
              onChange={setAlign}
            />
          </div>
        </div>

        {/* 정렬 방식 (내부 배치 전용) */}
        {placement === 'inside' && (
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">
              {t('counterSetting.alignMode')}
            </p>
            <Dropdown
              options={alignModeOptions}
              value={alignMode}
              onChange={setAlignMode}
            />
          </div>
        )}

        {/* 간격 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('counterSetting.gap')}</p>
          <input
            type="text"
            value={displayGap}
            onChange={(e) => {
              const newValue = e.target.value.replace(/[^0-9]/g, '');
              if (newValue === '') {
                setDisplayGap('');
              } else {
                setDisplayGap(newValue);
              }
            }}
            onFocus={() => {
              setIsGapFocused(true);
              setDisplayGap(String(gap));
            }}
            onBlur={(e) => {
              setIsGapFocused(false);
              const inputValue = e.target.value.replace(/[^0-9]/g, '');
              if (inputValue === '' || Number.isNaN(parseInt(inputValue, 10))) {
                setGap(0);
                setDisplayGap('0px');
              } else {
                const numValue = parseInt(inputValue, 10);
                const clamped = Math.max(numValue, 0);
                setGap(clamped);
                setDisplayGap(`${clamped}px`);
              }
            }}
            className="text-center h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
            style={{
              width: alignDropdownWidth ? `${alignDropdownWidth}px` : undefined,
            }}
          />
        </div>

        {/* 채우기 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('counterSetting.fill')}</p>
          <div ref={fillGroupRef} className="flex items-center gap-[8px]">
            <button
              ref={fillIdleBtnRef}
              type="button"
              className={colorButtonClass(
                pickerOpen && pickerFor === 'fillIdle',
              )}
              onClick={() => handleColorToggle('fillIdle')}
            >
              {renderColorSquare({ backgroundColor: fillIdle })}
              <span className="ml-[16px] text-left">
                {t('counterSetting.idle')}
              </span>
            </button>
            <button
              ref={fillActiveBtnRef}
              type="button"
              className={colorButtonClass(
                pickerOpen && pickerFor === 'fillActive',
              )}
              onClick={() => handleColorToggle('fillActive')}
            >
              {renderColorSquare({ backgroundColor: fillActive })}
              <span className="ml-[16px] text-left">
                {t('counterSetting.active')}
              </span>
            </button>
          </div>
        </div>

        {/* 외곽선 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('counterSetting.stroke')}
          </p>
          <div ref={strokeGroupRef} className="flex items-center gap-[8px]">
            <button
              ref={strokeIdleBtnRef}
              type="button"
              className={colorButtonClass(
                pickerOpen && pickerFor === 'strokeIdle',
              )}
              onClick={() => handleColorToggle('strokeIdle')}
            >
              {renderColorSquare({ backgroundColor: strokeIdle })}
              <span className="ml-[16px] text-left">
                {t('counterSetting.idle')}
              </span>
            </button>
            <button
              ref={strokeActiveBtnRef}
              type="button"
              className={colorButtonClass(
                pickerOpen && pickerFor === 'strokeActive',
              )}
              onClick={() => handleColorToggle('strokeActive')}
            >
              {renderColorSquare({ backgroundColor: strokeActive })}
              <span className="ml-[16px] text-left">
                {t('counterSetting.active')}
              </span>
            </button>
          </div>
        </div>

        {/* 적용하기/취소 */}
        <div className="flex gap-[10.5px]">
          <button
            onClick={handleApply}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {t('counterSetting.apply')}
          </button>
          <button
            onClick={onClose}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
          >
            {t('counterSetting.cancel')}
          </button>
        </div>

        {pickerFor && (
          <ColorPicker
            open={pickerOpen}
            referenceRef={referenceRefFor()}
            color={colorValueFor(pickerFor)}
            onColorChange={(c) => setColorFor(pickerFor, c)}
            onColorChangeComplete={(c) => handleColorComplete(pickerFor, c)}
            onClose={closePicker}
            solidOnly={true}
            interactiveRefs={colorPickerInteractiveRefs}
          />
        )}
      </div>
    </Modal>
  );
}
