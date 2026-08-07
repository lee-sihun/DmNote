import { useState, useEffect } from 'react';
import UnifiedKeySetting from '../../Modal/content/dialogs/UnifiedKeySetting';
import { createDefaultCounterSettings } from '@src/types/key/keys';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import type {
  KeyPosition,
  KeyCounterSettings,
  KeySlot,
  NoteColor,
} from '@src/types/key/keys';
import type {
  SaveData,
  PreviewData,
} from '@hooks/Modal/useUnifiedKeySettingState';

// ============================================================================
// 타입
// ============================================================================

interface SelectedKeyInfo {
  key: KeySlot;
  index: number;
}

interface OriginalKeyData {
  key: KeyPosition;
  counter: KeyCounterSettings;
}

type KeyPreviewUpdates = Partial<{
  activeImage: string;
  inactiveImage: string;
  soundPath: string;
  soundVolume: number;
  activeTransparent: boolean;
  idleTransparent: boolean;
  width: number;
  height: number;
  className: string;
  backgroundColor: string;
  activeBackgroundColor: string;
  borderColor: string;
  activeBorderColor: string;
  borderWidth: number;
  borderRadius: number;
  fontSize: number;
  fontColor: string;
  activeFontColor: string;
  idleImageFit: string;
  activeImageFit: string;
  imageFit: string;
  useInlineStyles: boolean;
  displayText: string;
}>;

interface GridKeySettingModalProps {
  selectedKey: SelectedKeyInfo | null;
  setSelectedKey: (key: SelectedKeyInfo | null) => void;
  currentKeyPosition: KeyPosition | undefined;
  onKeyUpdate: (data: SaveData) => void;
  onKeyPreview: (index: number, updates: KeyPreviewUpdates) => void;
  onNoteColorPreview: (
    index: number,
    noteColor: NoteColor,
    noteOpacity: number,
    noteGlowEnabled: boolean,
    noteGlowSize: number,
    noteGlowOpacity: number,
    noteGlowColor: NoteColor,
    noteAutoYCorrection: boolean,
    noteEffectEnabled: boolean,
  ) => void;
  onCounterPreview: (index: number, payload: KeyCounterSettings) => void;
  shouldSkipModalAnimation: boolean;
  onModalAnimationConsumed: (() => void) | undefined;
}

// ============================================================================
// 컴포넌트
// ============================================================================

const GridKeySettingModal = ({
  selectedKey,
  setSelectedKey,
  currentKeyPosition,
  onKeyUpdate,
  onKeyPreview,
  onNoteColorPreview,
  onCounterPreview,
  shouldSkipModalAnimation,
  onModalAnimationConsumed,
}: GridKeySettingModalProps) => {
  const [originalKeyData, setOriginalKeyData] =
    useState<OriginalKeyData | null>(null);

  // 모달 열릴 때 애니메이션 스킵 처리
  useEffect(() => {
    if (
      shouldSkipModalAnimation &&
      selectedKey &&
      typeof onModalAnimationConsumed === 'function'
    ) {
      onModalAnimationConsumed();
    }
  }, [shouldSkipModalAnimation, selectedKey, onModalAnimationConsumed]);

  if (!selectedKey || !currentKeyPosition) return null;

  const handleClose = () => {
    // 프리뷰는 canonical을 건드리지 않으므로 게스처 취소만으로 원복
    editGestureController.cancel();
    setSelectedKey(null);
    setOriginalKeyData(null);
  };

  const handleSave = (data: SaveData) => {
    if (typeof onKeyUpdate === 'function') {
      // key·note·counter를 단일 payload로 저장 - 커밋과 히스토리를 각 1회로 유지
      onKeyUpdate(data);
    }
    setOriginalKeyData(null);
    setSelectedKey(null);
  };

  const handlePreview = (previewData: PreviewData) => {
    // 원본 데이터 저장 (최초 미리보기 시)
    if (!originalKeyData) {
      setOriginalKeyData({
        key: currentKeyPosition,
        counter: currentKeyPosition.counter,
      });
    }

    if (
      previewData.type === 'counter' &&
      typeof onCounterPreview === 'function'
    ) {
      const currentCounter: KeyCounterSettings =
        currentKeyPosition.counter ?? createDefaultCounterSettings();
      const mergedPayload: KeyCounterSettings = {
        ...currentCounter,
        enabled: previewData.enabled ?? currentCounter.enabled,
        placement: (previewData.placement ??
          currentCounter.placement) as KeyCounterSettings['placement'],
        align: (previewData.align ??
          currentCounter.align) as KeyCounterSettings['align'],
        alignMode: (previewData.alignMode ??
          currentCounter.alignMode) as KeyCounterSettings['alignMode'],
        gap: previewData.gap ?? currentCounter.gap,
        fill: {
          idle: previewData.fill?.idle ?? currentCounter.fill.idle,
          active: previewData.fill?.active ?? currentCounter.fill.active,
        },
        stroke: {
          idle: previewData.stroke?.idle ?? currentCounter.stroke.idle,
          active: previewData.stroke?.active ?? currentCounter.stroke.active,
        },
      };
      onCounterPreview(selectedKey.index, mergedPayload);
    }

    if (previewData.type === 'key' && typeof onKeyPreview === 'function') {
      const { type: _type, ...rest } = previewData;
      onKeyPreview(selectedKey.index, rest);
    }

    // 노트 미리보기 처리
    if (
      previewData.type === 'note' &&
      typeof onNoteColorPreview === 'function'
    ) {
      const noteColor = previewData.noteColor ?? currentKeyPosition.noteColor;
      const noteOpacity =
        previewData.noteOpacity ?? currentKeyPosition.noteOpacity;
      const noteGlowEnabled =
        previewData.noteGlowEnabled ?? currentKeyPosition.noteGlowEnabled;
      const noteGlowSize =
        previewData.noteGlowSize ?? currentKeyPosition.noteGlowSize;
      const noteGlowOpacity =
        previewData.noteGlowOpacity ?? currentKeyPosition.noteGlowOpacity;
      const noteGlowColor =
        previewData.noteGlowColor ?? currentKeyPosition.noteGlowColor;
      const noteAutoYCorrection =
        previewData.noteAutoYCorrection ??
        currentKeyPosition.noteAutoYCorrection;
      const noteEffectEnabled =
        previewData.noteEffectEnabled ?? currentKeyPosition.noteEffectEnabled;

      onNoteColorPreview(
        selectedKey.index,
        noteColor,
        noteOpacity,
        noteGlowEnabled,
        noteGlowSize,
        noteGlowOpacity,
        noteGlowColor,
        noteAutoYCorrection,
        noteEffectEnabled,
      );
    }
  };

  return (
    <UnifiedKeySetting
      keyData={{
        key: selectedKey.key,
        activeImage: currentKeyPosition.activeImage,
        inactiveImage: currentKeyPosition.inactiveImage,
        activeTransparent: currentKeyPosition.activeTransparent || false,
        idleTransparent: currentKeyPosition.idleTransparent || false,
        width: currentKeyPosition.width,
        height: currentKeyPosition.height,
        noteColor: currentKeyPosition.noteColor || '#FFFFFF',
        noteOpacity: currentKeyPosition.noteOpacity ?? 90,
        noteEffectEnabled: currentKeyPosition.noteEffectEnabled,
        noteGlowEnabled: currentKeyPosition.noteGlowEnabled ?? true,
        noteGlowSize: currentKeyPosition.noteGlowSize ?? 20,
        noteGlowOpacity: currentKeyPosition.noteGlowOpacity ?? 70,
        noteGlowColor:
          currentKeyPosition.noteGlowColor ||
          currentKeyPosition.noteColor ||
          '#FFFFFF',
        noteAutoYCorrection: currentKeyPosition.noteAutoYCorrection,
        className: currentKeyPosition.className || '',
      }}
      initialCounterSettings={currentKeyPosition.counter || null}
      onClose={handleClose}
      onSave={handleSave}
      onPreview={handlePreview}
      skipAnimation={shouldSkipModalAnimation}
    />
  );
};

export default GridKeySettingModal;
