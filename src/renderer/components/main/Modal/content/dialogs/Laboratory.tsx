import React, { useState } from 'react';
import Modal from '../../Modal';
import Checkbox from '@components/main/common/Checkbox';
import { useTranslation } from '@contexts/useTranslation';

interface LaboratoryProps {
  delayEnabled: boolean;
  thresholdMs: number;
  minLengthPx: number;
  keyDisplayDelayMs: number;
  trackHeight: number;
  speed: number;
  onSave: (payload: {
    delayedNoteEnabled: boolean;
    shortNoteThresholdMs: number;
    shortNoteMinLengthPx: number;
    keyDisplayDelayMs: number;
  }) => Promise<void> | void;
  onClose: () => void;
}

const LaboratoryModal = ({
  delayEnabled,
  thresholdMs,
  minLengthPx,
  keyDisplayDelayMs,
  trackHeight,
  speed,
  onSave,
  onClose,
}: LaboratoryProps) => {
  const { t } = useTranslation();
  const [enforceShort, setEnforceShort] = useState(!!delayEnabled);
  // store as strings so the user can clear the input while typing
  const [threshold, setThreshold] = useState(String(thresholdMs ?? 120));
  const [minimum, setMinimum] = useState(String(minLengthPx ?? 10));
  const [keyDelay, setKeyDelay] = useState(String(keyDisplayDelayMs ?? 0));

  // 자동 계산된 키 딜레이 값 (노트가 키에 도달하는 시간)
  const parsedThreshold = (() => {
    const value = Number(threshold);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(value, 2000);
  })();

  const calculatedDelay = (() => {
    if (!speed || speed <= 0) return 0;
    const travelDelay = Math.round((trackHeight / speed) * 1000);
    const shortNoteDelay = enforceShort ? parsedThreshold : 0;
    return travelDelay + shortNoteDelay;
  })();

  const handleAutoCalculate = () => {
    setKeyDelay(String(calculatedDelay));
  };

  const handleSave = async () => {
    const sanitizedThreshold = Math.max(
      0,
      Math.min(parseInt(String(threshold), 10) || 0, 2000),
    );
    const sanitizedMinimum = Math.max(
      1,
      Math.min(parseInt(String(minimum), 10) || 1, 100),
    );
    const sanitizedKeyDelay = Math.max(
      0,
      Math.min(parseInt(String(keyDelay), 10) || 0, 5000),
    );

    try {
      await onSave({
        delayedNoteEnabled: enforceShort,
        shortNoteThresholdMs: sanitizedThreshold,
        shortNoteMinLengthPx: sanitizedMinimum,
        keyDisplayDelayMs: sanitizedKeyDelay,
      });
    } finally {
      onClose();
    }
  };

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col items-center justify-center p-[20px] bg-glass-heavy backdrop-blur-[32px] rounded-[14px] shadow-elevation-3 gap-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('laboratory.delayToggle')}
          </p>
          <Checkbox
            checked={enforceShort}
            onChange={() => setEnforceShort((prev) => !prev)}
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('laboratory.minLength')}</p>
          <input
            type="number"
            min={1}
            max={100}
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
            onBlur={() => {
              const sanitized = Math.max(
                1,
                Math.min(Number(minimum) || 1, 100),
              );
              setMinimum(String(sanitized));
            }}
            className="text-center w-[47px] h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('laboratory.threshold')}</p>
          <input
            type="number"
            min={0}
            max={2000}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={() => {
              const sanitized = Math.max(
                0,
                Math.min(Number(threshold) || 0, 2000),
              );
              setThreshold(String(sanitized));
            }}
            className="text-center w-[47px] h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
          />
        </div>

        {/* 구분선 */}
        <div className="w-full h-[1px] bg-line" />

        {/* 키 딜레이 설정 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('laboratory.keyDelay')}</p>
          <div className="flex items-center gap-[8px]">
            <input
              type="number"
              min={0}
              max={5000}
              value={keyDelay}
              onChange={(e) => setKeyDelay(e.target.value)}
              onBlur={() => {
                const sanitized = Math.max(
                  0,
                  Math.min(Number(keyDelay) || 0, 5000),
                );
                setKeyDelay(String(sanitized));
              }}
              className="text-center w-[55px] h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
            />
          </div>
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-fg-faint text-style-4">
            {t('laboratory.keyDelayAuto', { value: calculatedDelay })}
          </p>
          <button
            onClick={handleAutoCalculate}
            className="px-[10px] h-[23px] bg-white/[0.07] hover:bg-white/[0.1] active:bg-white/[0.13] rounded-md text-fg text-style-4"
          >
            {t('laboratory.autoCalc')}
          </button>
        </div>

        <div className="flex gap-[8px]">
          <button
            onClick={handleSave}
            className="w-[150px] h-[30px] bg-accent hover:bg-accent-hover active:bg-accent-active rounded-lg text-accent-fg text-label transition-colors duration-fast"
          >
            {t('laboratory.save')}
          </button>
          <button
            onClick={onClose}
            className="w-[75px] h-[30px] bg-white/[0.05] hover:bg-white/[0.08] active:bg-white/[0.11] rounded-lg text-fg-muted hover:text-fg text-label transition-colors duration-fast"
          >
            {t('laboratory.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default LaboratoryModal;
