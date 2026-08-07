import { usePressAction } from '@hooks/usePressAction';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Checkbox from '@components/main/common/Checkbox';
import TabSwitch from '@components/main/common/TabSwitch';
import {
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import Modal from '../../Modal';
import { useTranslation } from '@contexts/useTranslation';
import {
  NOTE_SETTINGS_CONSTRAINTS,
  clampValue,
} from '../../../../../../types/settings/noteSettingsConstraints';
import type { NoteSettings } from '../../../../../../types/settings/noteSettings';
import {
  toDisplayDelayMs,
  toEffectiveMinLengthPx,
  toMinLengthMs,
} from '@utils/core/noteLengthPolicy';

type ConstraintKey = keyof typeof NOTE_SETTINGS_CONSTRAINTS;

const NOTE_TAB = 'note' as const;
const ADVANCED_TAB = 'advanced' as const;
type TabId = typeof NOTE_TAB | typeof ADVANCED_TAB;

const INPUT_CLASS =
  'text-center h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-body tabular-nums text-fg';

function sanitizeNumericValue(
  value: string | number | undefined,
  key: ConstraintKey,
): number {
  const parsed = parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return NOTE_SETTINGS_CONSTRAINTS[key].default;
  }
  return clampValue(parsed, key);
}

interface NoteSettingProps {
  onClose?: () => void;
  settings: NoteSettings | null;
  onSave?: (normalized: NoteSettings) => Promise<void> | void;
  title?: string | null;
}

const NoteSetting = ({
  onClose,
  settings,
  onSave,
  title = null,
}: NoteSettingProps) => {
  const { t } = useTranslation();
  const initial: Partial<NoteSettings> = settings || {};
  const [activeTab, setActiveTab] = useState<TabId>(NOTE_TAB);

  const [frameLimit, setFrameLimit] = useState<string>(
    String(sanitizeNumericValue(initial.frameLimit, 'frameLimit')),
  );
  const [speed, setSpeed] = useState<string>(
    String(sanitizeNumericValue(initial.speed, 'speed')),
  );
  const [trackHeight, setTrackHeight] = useState<string>(
    String(sanitizeNumericValue(initial.trackHeight, 'trackHeight')),
  );
  const [reverse, setReverse] = useState<boolean>(
    Boolean(initial.reverse || false),
  );
  const [fadeTopPx, setFadeTopPx] = useState<string>(
    String(sanitizeNumericValue(initial.fadeTopPx, 'fadeTopPx')),
  );
  const [fadeBottomPx, setFadeBottomPx] = useState<string>(
    String(sanitizeNumericValue(initial.fadeBottomPx, 'fadeBottomPx')),
  );
  const [reverseFadeTopPx, setReverseFadeTopPx] = useState<string>(
    String(sanitizeNumericValue(initial.reverseFadeTopPx, 'reverseFadeTopPx')),
  );
  const [reverseFadeBottomPx, setReverseFadeBottomPx] = useState<string>(
    String(
      sanitizeNumericValue(initial.reverseFadeBottomPx, 'reverseFadeBottomPx'),
    ),
  );

  const [delayedNoteEnabled, setDelayedNoteEnabled] = useState<boolean>(
    Boolean(initial.delayedNoteEnabled || false),
  );
  const [shortNoteThresholdMs, setShortNoteThresholdMs] = useState<string>(
    String(
      sanitizeNumericValue(
        initial.shortNoteThresholdMs,
        'shortNoteThresholdMs',
      ),
    ),
  );
  const [shortNoteMinLengthPx, setShortNoteMinLengthPx] = useState<string>(
    String(
      sanitizeNumericValue(
        initial.shortNoteMinLengthPx,
        'shortNoteMinLengthPx',
      ),
    ),
  );
  const [keyDisplayDelayMs, setKeyDisplayDelayMs] = useState<string>(
    String(
      sanitizeNumericValue(initial.keyDisplayDelayMs, 'keyDisplayDelayMs'),
    ),
  );
  const tabContentRef = useRef<HTMLDivElement>(null);
  const [tabContentHeight, setTabContentHeight] = useState<number | null>(null);
  const [disableHeightTransition, setDisableHeightTransition] =
    useState<boolean>(true);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  const updateTabContentHeight = () => {
    const element = tabContentRef.current;
    if (!element) return;
    const nextHeight = element.offsetHeight;
    setTabContentHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  };

  const safeSpeed = sanitizeNumericValue(speed, 'speed');
  const safeTrackHeight = sanitizeNumericValue(trackHeight, 'trackHeight');
  const safeThreshold = sanitizeNumericValue(
    shortNoteThresholdMs,
    'shortNoteThresholdMs',
  );
  const safeMinLengthPx = sanitizeNumericValue(
    shortNoteMinLengthPx,
    'shortNoteMinLengthPx',
  );
  const effectiveMinPx = toEffectiveMinLengthPx(
    safeMinLengthPx,
    safeTrackHeight,
  );
  const minLengthMs = toMinLengthMs(effectiveMinPx, safeSpeed);
  const travelDelay = (safeTrackHeight / safeSpeed) * 1000;
  // 노트 표시 지연은 오버레이 길이 정책과 같은 식을 써야 키·카운터와 정렬이 맞음
  const noteDisplayDelay = toDisplayDelayMs(minLengthMs, safeThreshold);
  const calculatedDelay = Math.round(
    delayedNoteEnabled ? travelDelay + noteDisplayDelay : travelDelay,
  );

  const handleAutoCalculate = () => {
    const clamped = clampValue(calculatedDelay, 'keyDisplayDelayMs');
    setKeyDisplayDelayMs(String(clamped));
  };

  useLayoutEffect(() => {
    updateTabContentHeight();
  }, [activeTab]);

  useEffect(() => {
    const element = tabContentRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      updateTabContentHeight();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [activeTab]);

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
  }, [isAnimating, disableHeightTransition]);

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
      await onSave?.(normalized as NoteSettings);
    } finally {
      onClose?.();
    }
  };

  const renderNoteTab = () => (
    <div className="flex flex-col gap-[12px]">
      <PropertySection>
        <PropertyRow label={t('noteSetting.frameLimit')}>
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
        </PropertyRow>
        <PropertyRow label={t('noteSetting.speed')}>
          <input
            type="number"
            min={NOTE_SETTINGS_CONSTRAINTS.speed.min}
            max={NOTE_SETTINGS_CONSTRAINTS.speed.max}
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            onBlur={() =>
              setSpeed(String(sanitizeNumericValue(speed, 'speed')))
            }
            className={`${INPUT_CLASS} w-[47px]`}
          />
        </PropertyRow>
        <PropertyRow label={t('noteSetting.trackHeight')}>
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
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        <PropertyRow label={t('noteSetting.reverseEffect')}>
          <Checkbox
            commitStrategy="after-paint"
            checked={reverse}
            onChange={() => setReverse((prev) => !prev)}
          />
        </PropertyRow>
        <PropertyRow label={`${t('noteSetting.fade')}${reverse ? ' (R)' : ''}`}>
          {/* 외형은 label 셸이 소유, input은 투명 flex 자식 - 긴 값도 잘리지 않음 */}
          <label className="flex items-center gap-[4px] h-[23px] px-[6px] w-[54px] bg-inset rounded-md cursor-text focus-within:shadow-focus-ring">
            <svg
              className="shrink-0 text-fg-muted"
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="currentColor"
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
              className="flex-1 min-w-0 h-full bg-transparent text-body tabular-nums text-fg text-center"
            />
          </label>
          <label className="flex items-center gap-[4px] h-[23px] px-[6px] w-[54px] bg-inset rounded-md cursor-text focus-within:shadow-focus-ring">
            <svg
              className="shrink-0 text-fg-muted"
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="currentColor"
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
              className="flex-1 min-w-0 h-full bg-transparent text-body tabular-nums text-fg text-center"
            />
          </label>
        </PropertyRow>
      </PropertySection>
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="flex flex-col gap-[12px]">
      <PropertySection>
        <PropertyRow label={t('laboratory.delayToggle')}>
          <Checkbox
            commitStrategy="after-paint"
            checked={delayedNoteEnabled}
            onChange={() => setDelayedNoteEnabled((prev) => !prev)}
          />
        </PropertyRow>
        <PropertyRow label={t('laboratory.minLength')}>
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
        </PropertyRow>
        <PropertyRow label={t('laboratory.threshold')}>
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
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        <PropertyRow label={t('laboratory.keyDelay')}>
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
        </PropertyRow>
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-faint text-body">
            {t('laboratory.keyDelayAuto', { value: calculatedDelay })}
          </p>
          <button
            onClick={handleAutoCalculate}
            className="px-[10px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-md text-fg text-body"
          >
            {t('laboratory.autoCalc')}
          </button>
        </div>
      </PropertySection>
    </div>
  );

  // 입력 blur·IME flush와의 경합으로 첫 click이 유실되는 것을 방어
  const savePress = usePressAction(handleSave);
  const cancelPress = usePressAction(onClose);

  return (
    <Modal onClick={onClose} ariaLabel={title ?? t('keySetting.tabNote')}>
      <div
        className="flex flex-col w-[264px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 p-[14px]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <p className="text-fg-muted text-label mb-[12px]">{title}</p>}
        <TabSwitch
          tabs={[
            { id: NOTE_TAB, label: t('keySetting.tabNote') },
            { id: ADVANCED_TAB, label: t('propertiesPanel.advanced') },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) => {
            if (tab !== activeTab) {
              setIsAnimating(true);
              setActiveTab(tab as TabId);
            }
          }}
          className="mb-[12px]"
        />

        <div
          className={`${isAnimating ? 'overflow-hidden' : ''} ${
            disableHeightTransition
              ? ''
              : 'transition-[height] duration-fast ease-in-out'
          }`}
          style={{
            height:
              tabContentHeight !== null ? `${tabContentHeight}px` : 'auto',
          }}
          onTransitionEnd={(e: React.TransitionEvent<HTMLDivElement>) => {
            if (e.propertyName === 'height') {
              setIsAnimating(false);
            }
          }}
        >
          <div ref={tabContentRef}>
            {activeTab === NOTE_TAB ? renderNoteTab() : renderAdvancedTab()}
          </div>
        </div>

        <div className="flex gap-[8px] mt-[12px]">
          <button
            {...savePress}
            className="flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
          >
            {t('noteSetting.save')}
          </button>
          <button
            {...cancelPress}
            className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
          >
            {t('noteSetting.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default NoteSetting;
