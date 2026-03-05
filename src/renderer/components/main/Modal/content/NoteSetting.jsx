import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Checkbox from '@components/main/common/Checkbox';
import Modal from '../Modal';
import { useTranslation } from '@contexts/I18nContext';
import {
  NOTE_SETTINGS_CONSTRAINTS,
  clampValue,
} from '../../../../../types/noteSettingsConstraints';

const NOTE_TAB = 'note';
const ADVANCED_TAB = 'advanced';

const INPUT_CLASS =
  'text-center h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]';

function TabSwitch({ activeTab, onTabChange }) {
  const { t } = useTranslation();

  const tabs = [
    { id: NOTE_TAB, label: t('keySetting.tabNote') },
    { id: ADVANCED_TAB, label: t('propertiesPanel.advanced') },
  ];

  return (
    <div className="flex w-full h-[30px] bg-[#26262C] mb-[19px] rounded-[7px] items-center p-[3px] gap-[5px]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`w-full h-[24px] rounded-[7px] text-style-2 transition-colors ${
            activeTab === tab.id
              ? 'bg-[#3A3943] text-white'
              : 'bg-[#26262C] text-[#9395A1] hover:bg-[#303036]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function sanitizeNumericValue(value, key) {
  const parsed = parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return NOTE_SETTINGS_CONSTRAINTS[key].default;
  }
  return clampValue(parsed, key);
}

export default function NoteSetting({
  onClose,
  settings,
  onSave,
  title = null,
}) {
  const { t } = useTranslation();
  const initial = settings || {};
  const [activeTab, setActiveTab] = useState(NOTE_TAB);

  const [frameLimit, setFrameLimit] = useState(
    String(sanitizeNumericValue(initial.frameLimit, 'frameLimit')),
  );
  const [speed, setSpeed] = useState(
    String(sanitizeNumericValue(initial.speed, 'speed')),
  );
  const [trackHeight, setTrackHeight] = useState(
    String(sanitizeNumericValue(initial.trackHeight, 'trackHeight')),
  );
  const [reverse, setReverse] = useState(Boolean(initial.reverse || false));
  const [fadeTopPx, setFadeTopPx] = useState(
    String(sanitizeNumericValue(initial.fadeTopPx, 'fadeTopPx')),
  );
  const [fadeBottomPx, setFadeBottomPx] = useState(
    String(sanitizeNumericValue(initial.fadeBottomPx, 'fadeBottomPx')),
  );
  const [reverseFadeTopPx, setReverseFadeTopPx] = useState(
    String(sanitizeNumericValue(initial.reverseFadeTopPx, 'reverseFadeTopPx')),
  );
  const [reverseFadeBottomPx, setReverseFadeBottomPx] = useState(
    String(
      sanitizeNumericValue(initial.reverseFadeBottomPx, 'reverseFadeBottomPx'),
    ),
  );

  const [delayedNoteEnabled, setDelayedNoteEnabled] = useState(
    Boolean(initial.delayedNoteEnabled || false),
  );
  const [shortNoteThresholdMs, setShortNoteThresholdMs] = useState(
    String(
      sanitizeNumericValue(
        initial.shortNoteThresholdMs,
        'shortNoteThresholdMs',
      ),
    ),
  );
  const [shortNoteMinLengthPx, setShortNoteMinLengthPx] = useState(
    String(
      sanitizeNumericValue(
        initial.shortNoteMinLengthPx,
        'shortNoteMinLengthPx',
      ),
    ),
  );
  const [keyDisplayDelayMs, setKeyDisplayDelayMs] = useState(
    String(
      sanitizeNumericValue(initial.keyDisplayDelayMs, 'keyDisplayDelayMs'),
    ),
  );
  const tabContentRef = useRef(null);
  const [tabContentHeight, setTabContentHeight] = useState(null);
  const [disableHeightTransition, setDisableHeightTransition] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);

  const updateTabContentHeight = useCallback(() => {
    const element = tabContentRef.current;
    if (!element) return;
    const nextHeight = element.offsetHeight;
    setTabContentHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const calculatedDelay = useMemo(() => {
    const safeSpeed = sanitizeNumericValue(speed, 'speed');
    const safeTrackHeight = sanitizeNumericValue(trackHeight, 'trackHeight');
    const safeThreshold = sanitizeNumericValue(
      shortNoteThresholdMs,
      'shortNoteThresholdMs',
    );

    if (safeSpeed <= 0) return 0;
    const travelDelay = Math.round((safeTrackHeight / safeSpeed) * 1000);
    return delayedNoteEnabled ? travelDelay + safeThreshold : travelDelay;
  }, [speed, trackHeight, shortNoteThresholdMs, delayedNoteEnabled]);

  const handleAutoCalculate = () => {
    const clamped = clampValue(calculatedDelay, 'keyDisplayDelayMs');
    setKeyDisplayDelayMs(String(clamped));
  };

  useLayoutEffect(() => {
    updateTabContentHeight();
  }, [activeTab, updateTabContentHeight]);

  useEffect(() => {
    const element = tabContentRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      updateTabContentHeight();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [activeTab, updateTabContentHeight]);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setDisableHeightTransition(false);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  // transitionend 미발화 시 (높이 동일, 트랜지션 비활성 등) 안전 해제
  useEffect(() => {
    if (!isAnimating) return;
    const timer = setTimeout(() => setIsAnimating(false), 150);
    return () => clearTimeout(timer);
  }, [isAnimating]);

  // overflow-hidden 제거 후 BFC 변경으로 인한 높이 차이 보정
  useEffect(() => {
    if (!isAnimating && !disableHeightTransition) {
      requestAnimationFrame(() => updateTabContentHeight());
    }
  }, [isAnimating, disableHeightTransition, updateTabContentHeight]);

  const handleSave = async () => {
    const normalized = {
      ...settings,
      frameLimit: sanitizeNumericValue(frameLimit, 'frameLimit'),
      speed: sanitizeNumericValue(speed, 'speed'),
      trackHeight: sanitizeNumericValue(trackHeight, 'trackHeight'),
      reverse,
      fadeTopPx: sanitizeNumericValue(fadeTopPx, 'fadeTopPx'),
      fadeBottomPx: sanitizeNumericValue(fadeBottomPx, 'fadeBottomPx'),
      reverseFadeTopPx: sanitizeNumericValue(
        reverseFadeTopPx,
        'reverseFadeTopPx',
      ),
      reverseFadeBottomPx: sanitizeNumericValue(
        reverseFadeBottomPx,
        'reverseFadeBottomPx',
      ),
      delayedNoteEnabled,
      shortNoteThresholdMs: sanitizeNumericValue(
        shortNoteThresholdMs,
        'shortNoteThresholdMs',
      ),
      shortNoteMinLengthPx: sanitizeNumericValue(
        shortNoteMinLengthPx,
        'shortNoteMinLengthPx',
      ),
      keyDisplayDelayMs: sanitizeNumericValue(
        keyDisplayDelayMs,
        'keyDisplayDelayMs',
      ),
    };

    try {
      await onSave?.(normalized);
    } finally {
      onClose?.();
    }
  };

  const renderNoteTab = () => (
    <div className="flex flex-col gap-[12px]">
      <div className="flex justify-between w-full items-center">
        <p className="text-white text-style-2">{t('noteSetting.frameLimit')}</p>
        <input
          type="number"
          min={NOTE_SETTINGS_CONSTRAINTS.frameLimit.min}
          max={NOTE_SETTINGS_CONSTRAINTS.frameLimit.max}
          value={frameLimit}
          onChange={(e) => setFrameLimit(e.target.value)}
          onBlur={() =>
            setFrameLimit(
              String(sanitizeNumericValue(frameLimit, 'frameLimit')),
            )
          }
          className={`${INPUT_CLASS} w-[47px]`}
        />
      </div>

      <div className="flex justify-between w-full items-center">
        <p className="text-white text-style-2">{t('noteSetting.speed')}</p>
        <input
          type="number"
          min={NOTE_SETTINGS_CONSTRAINTS.speed.min}
          max={NOTE_SETTINGS_CONSTRAINTS.speed.max}
          value={speed}
          onChange={(e) => setSpeed(e.target.value)}
          onBlur={() => setSpeed(String(sanitizeNumericValue(speed, 'speed')))}
          className={`${INPUT_CLASS} w-[47px]`}
        />
      </div>

      <div className="flex justify-between w-full items-center">
        <p className="text-white text-style-2">
          {t('noteSetting.trackHeight')}
        </p>
        <input
          type="number"
          min={NOTE_SETTINGS_CONSTRAINTS.trackHeight.min}
          max={NOTE_SETTINGS_CONSTRAINTS.trackHeight.max}
          value={trackHeight}
          onChange={(e) => setTrackHeight(e.target.value)}
          onBlur={() =>
            setTrackHeight(
              String(sanitizeNumericValue(trackHeight, 'trackHeight')),
            )
          }
          className={`${INPUT_CLASS} w-[47px]`}
        />
      </div>

      <div className="flex justify-between w-full items-center h-[23px]">
        <p className="text-white text-style-2">
          {t('noteSetting.reverseEffect')}
        </p>
        <Checkbox
          checked={reverse}
          onChange={() => setReverse((prev) => !prev)}
        />
      </div>

      <div className="flex justify-between w-full items-center min-h-[23px]">
        <p className="text-white text-style-2">
          {t('noteSetting.fade')}
          {reverse ? ' (R)' : ''}
        </p>
        <div className="flex items-center gap-[10.5px]">
          <div
            className="relative h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943]"
            style={{ width: '54px' }}
          >
            <svg
              className="absolute left-[5px] top-[50%] transform -translate-y-1/2 pointer-events-none"
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="#97999E"
            >
              <rect x="2" y="2" width="10" height="2" opacity="0.2" rx="1" />
              <rect x="2" y="6" width="10" height="2" opacity="0.6" rx="1" />
              <rect x="2" y="10" width="10" height="2" opacity="1" rx="1" />
            </svg>
            <input
              type="number"
              min={NOTE_SETTINGS_CONSTRAINTS.fadeTopPx.min}
              max={NOTE_SETTINGS_CONSTRAINTS.fadeTopPx.max}
              value={reverse ? reverseFadeTopPx : fadeTopPx}
              onChange={(e) =>
                reverse
                  ? setReverseFadeTopPx(e.target.value)
                  : setFadeTopPx(e.target.value)
              }
              onBlur={() => {
                if (reverse)
                  setReverseFadeTopPx(
                    String(
                      sanitizeNumericValue(
                        reverseFadeTopPx,
                        'reverseFadeTopPx',
                      ),
                    ),
                  );
                else
                  setFadeTopPx(
                    String(sanitizeNumericValue(fadeTopPx, 'fadeTopPx')),
                  );
              }}
              className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-center"
            />
          </div>
          <div
            className="relative h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943]"
            style={{ width: '54px' }}
          >
            <svg
              className="absolute left-[5px] top-[50%] transform -translate-y-1/2 pointer-events-none"
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="#97999E"
            >
              <rect x="2" y="2" width="10" height="2" opacity="1" rx="1" />
              <rect x="2" y="6" width="10" height="2" opacity="0.6" rx="1" />
              <rect x="2" y="10" width="10" height="2" opacity="0.2" rx="1" />
            </svg>
            <input
              type="number"
              min={NOTE_SETTINGS_CONSTRAINTS.fadeBottomPx.min}
              max={NOTE_SETTINGS_CONSTRAINTS.fadeBottomPx.max}
              value={reverse ? reverseFadeBottomPx : fadeBottomPx}
              onChange={(e) =>
                reverse
                  ? setReverseFadeBottomPx(e.target.value)
                  : setFadeBottomPx(e.target.value)
              }
              onBlur={() => {
                if (reverse)
                  setReverseFadeBottomPx(
                    String(
                      sanitizeNumericValue(
                        reverseFadeBottomPx,
                        'reverseFadeBottomPx',
                      ),
                    ),
                  );
                else
                  setFadeBottomPx(
                    String(sanitizeNumericValue(fadeBottomPx, 'fadeBottomPx')),
                  );
              }}
              className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-center"
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="flex flex-col gap-[12px]">
      <div className="flex justify-between w-full items-center h-[23px]">
        <p className="text-white text-style-2">{t('laboratory.delayToggle')}</p>
        <Checkbox
          checked={delayedNoteEnabled}
          onChange={() => setDelayedNoteEnabled((prev) => !prev)}
        />
      </div>

      <div className="flex justify-between w-full items-center">
        <p className="text-white text-style-2">{t('laboratory.minLength')}</p>
        <input
          type="number"
          min={NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.min}
          max={NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.max}
          value={shortNoteMinLengthPx}
          onChange={(e) => setShortNoteMinLengthPx(e.target.value)}
          onBlur={() =>
            setShortNoteMinLengthPx(
              String(
                sanitizeNumericValue(
                  shortNoteMinLengthPx,
                  'shortNoteMinLengthPx',
                ),
              ),
            )
          }
          className={`${INPUT_CLASS} w-[47px]`}
        />
      </div>

      <div className="flex justify-between w-full items-center">
        <p className="text-white text-style-2">{t('laboratory.threshold')}</p>
        <input
          type="number"
          min={NOTE_SETTINGS_CONSTRAINTS.shortNoteThresholdMs.min}
          max={NOTE_SETTINGS_CONSTRAINTS.shortNoteThresholdMs.max}
          value={shortNoteThresholdMs}
          onChange={(e) => setShortNoteThresholdMs(e.target.value)}
          onBlur={() =>
            setShortNoteThresholdMs(
              String(
                sanitizeNumericValue(
                  shortNoteThresholdMs,
                  'shortNoteThresholdMs',
                ),
              ),
            )
          }
          className={`${INPUT_CLASS} w-[47px]`}
        />
      </div>

      <div className="w-full h-[1px] bg-[#2A2A30]" />

      <div className="flex justify-between w-full items-center">
        <p className="text-white text-style-2">{t('laboratory.keyDelay')}</p>
        <input
          type="number"
          min={NOTE_SETTINGS_CONSTRAINTS.keyDisplayDelayMs.min}
          max={NOTE_SETTINGS_CONSTRAINTS.keyDisplayDelayMs.max}
          value={keyDisplayDelayMs}
          onChange={(e) => setKeyDisplayDelayMs(e.target.value)}
          onBlur={() =>
            setKeyDisplayDelayMs(
              String(
                sanitizeNumericValue(keyDisplayDelayMs, 'keyDisplayDelayMs'),
              ),
            )
          }
          className={`${INPUT_CLASS} w-[47px]`}
        />
      </div>

      <div className="flex justify-between w-full items-center">
        <p className="text-[#717178] text-style-4">
          {t('laboratory.keyDelayAuto', { value: calculatedDelay })}
        </p>
        <button
          onClick={handleAutoCalculate}
          className="px-[10px] h-[23px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-4"
        >
          {t('laboratory.autoCalc')}
        </button>
      </div>
    </div>
  );

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <p className="text-white text-style-2 mb-[10px]">{title}</p>}
        <TabSwitch
          activeTab={activeTab}
          onTabChange={(tab) => {
            if (tab !== activeTab) {
              setIsAnimating(true);
              setActiveTab(tab);
            }
          }}
        />

        <div
          className={`${isAnimating ? 'overflow-hidden' : ''} ${
            disableHeightTransition
              ? ''
              : 'transition-[height] duration-100 ease-in-out'
          }`}
          style={{
            height:
              tabContentHeight !== null ? `${tabContentHeight}px` : 'auto',
          }}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'height') {
              setIsAnimating(false);
            }
          }}
        >
          <div ref={tabContentRef}>
            {activeTab === NOTE_TAB ? renderNoteTab() : renderAdvancedTab()}
          </div>
        </div>

        <div className="flex gap-[10.5px] mt-[19px]">
          <button
            onClick={handleSave}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {t('noteSetting.save')}
          </button>
          <button
            onClick={onClose}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
          >
            {t('noteSetting.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
