import { useEffect, useRef, useState } from 'react';
import type { KeyPosition, NoteColor } from '@src/types/key/keys';
import type { EditorCounterFillPropertyPatchV1 } from '@src/types/editor';
import { normalizeCounterSettings } from '@src/types/key/keys';
import type {
  BatchLocalColors,
  BatchPickerTarget,
} from './batch/batchPickerTypes';

interface UseBatchColorPickerControllerOptions {
  selectedKeyCount: number;
  getSelectedKeysData: () => Array<{ position: KeyPosition }>;
  getSelectedKeyOnlyPositions: () => Array<{ position: KeyPosition }>;
}

export const useBatchColorPickerController = ({
  selectedKeyCount,
  getSelectedKeysData,
  getSelectedKeyOnlyPositions,
}: UseBatchColorPickerControllerOptions) => {
  const batchNoteColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchGlowColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchBorderColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchCounterFillButtonRef = useRef<HTMLButtonElement>(null);
  const [batchPickerFor, setBatchPickerFor] = useState<BatchPickerTarget>(null);
  const [batchCounterColorState, setBatchCounterColorState] = useState<
    'idle' | 'active'
  >('idle');
  const effectiveBatchCounterColorState =
    selectedKeyCount > 0 ? batchCounterColorState : 'idle';
  const [batchLocalColors, setBatchLocalColors] = useState<BatchLocalColors>({
    fillIdle: '#FFFFFF',
    fillActive: '#FFFFFF',
  });

  useEffect(() => {
    if (selectedKeyCount === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 선택 소실 시 로컬 피커 세션 초기화
      setBatchCounterColorState('idle');
      setBatchPickerFor((current) => (current === 'fill' ? null : current));
    }
  }, [selectedKeyCount]);

  const batchColorPickerInteractiveRefs = [
    batchNoteColorButtonRef,
    batchGlowColorButtonRef,
    batchBorderColorButtonRef,
    batchCounterFillButtonRef,
  ];

  const handleBatchPickerToggle = (target: BatchPickerTarget) => {
    if (target && target !== batchPickerFor) {
      // 새로 열 때는 항상 대기 탭에서 시작 - 열림과 같은 배치로 리셋
      setBatchCounterColorState('idle');
      const keysData = getSelectedKeysData();
      const keyOnly = getSelectedKeyOnlyPositions();
      const firstPos =
        target === 'fill' && keyOnly.length > 0
          ? keyOnly[0].position
          : keysData[0]?.position;
      if (firstPos) {
        const counterSettings = normalizeCounterSettings(firstPos.counter);
        setBatchLocalColors({
          fillIdle: counterSettings.fill.idle,
          fillActive: counterSettings.fill.active,
        });
      }
    }
    setBatchPickerFor((prev) => (prev === target ? null : target));
  };

  const getBatchPickerColor = (): NoteColor | string => {
    switch (batchPickerFor) {
      case 'fill':
        return effectiveBatchCounterColorState === 'active'
          ? batchLocalColors.fillActive
          : batchLocalColors.fillIdle;
      default:
        return '#FFFFFF';
    }
  };

  const getBatchPickerRef = () => {
    switch (batchPickerFor) {
      case 'noteColor':
        return batchNoteColorButtonRef;
      case 'glowColor':
        return batchGlowColorButtonRef;
      case 'borderColor':
        return batchBorderColorButtonRef;
      case 'fill':
        return batchCounterFillButtonRef;
      default:
        return null;
    }
  };

  const handleBatchPickerColorChange = (newColor: NoteColor) => {
    if (batchPickerFor !== 'fill') return;
    const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
    const key =
      effectiveBatchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';
    setBatchLocalColors((prev) => ({
      ...prev,
      [key]: solidColor,
    }));
  };
  const handleBatchPickerColorChangeComplete = (newColor: NoteColor) =>
    handleBatchPickerColorChange(newColor);
  const handleBatchFillPickerColorChangeComplete = (
    newColor: string,
    onCounterFillCommit: (patch: EditorCounterFillPropertyPatchV1) => void,
  ) => {
    const key =
      effectiveBatchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';
    setBatchLocalColors((prev) => ({ ...prev, [key]: newColor }));
    onCounterFillCommit(
      effectiveBatchCounterColorState === 'active'
        ? { property: 'counterFillActive', value: { color: newColor } }
        : { property: 'counterFillIdle', value: { color: newColor } },
    );
  };

  return {
    batchNoteColorButtonRef,
    batchGlowColorButtonRef,
    batchBorderColorButtonRef,
    batchCounterFillButtonRef,
    batchPickerFor,
    setBatchPickerFor,
    effectiveBatchCounterColorState,
    setBatchCounterColorState,
    batchLocalColors,
    setBatchLocalColors,
    batchColorPickerInteractiveRefs,
    handleBatchPickerToggle,
    getBatchPickerColor,
    getBatchPickerRef,
    handleBatchPickerColorChange,
    handleBatchPickerColorChangeComplete,
    handleBatchFillPickerColorChangeComplete,
  };
};
