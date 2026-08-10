import { useState, useEffect } from 'react';
import UnifiedKeySetting from '../../Modal/content/dialogs/UnifiedKeySetting';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';
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

  // 닫으면 호출부가 selectedKey를 비우므로, 퇴장 구간에 쓸 대상은 붙잡아 둔다
  const open = Boolean(selectedKey && currentKeyPosition);
  const {
    mounted,
    state: motionState,
    cycle,
  } = useModalPresence(open, {
    skipEnter: shouldSkipModalAnimation,
  });
  const shown = useRetainedWhileOpen(open, { selectedKey, currentKeyPosition });
  const shownKey = shown.selectedKey;
  const shownPosition = shown.currentKeyPosition;

  if (!mounted || !shownKey || !shownPosition) return null;

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
        key: shownPosition,
        counter: shownPosition.counter,
      });
    }

    if (
      previewData.type === 'counter' &&
      typeof onCounterPreview === 'function'
    ) {
      const currentCounter: KeyCounterSettings =
        shownPosition.counter ?? createDefaultCounterSettings();
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
      onCounterPreview(shownKey.index, mergedPayload);
    }

    if (previewData.type === 'key' && typeof onKeyPreview === 'function') {
      const { type: _type, ...rest } = previewData;
      onKeyPreview(shownKey.index, rest);
    }

    // 노트 미리보기 처리
    if (
      previewData.type === 'note' &&
      typeof onNoteColorPreview === 'function'
    ) {
      const noteColor = previewData.noteColor ?? shownPosition.noteColor;
      const noteOpacity = previewData.noteOpacity ?? shownPosition.noteOpacity;
      const noteGlowEnabled =
        previewData.noteGlowEnabled ?? shownPosition.noteGlowEnabled;
      const noteGlowSize =
        previewData.noteGlowSize ?? shownPosition.noteGlowSize;
      const noteGlowOpacity =
        previewData.noteGlowOpacity ?? shownPosition.noteGlowOpacity;
      const noteGlowColor =
        previewData.noteGlowColor ?? shownPosition.noteGlowColor;
      const noteAutoYCorrection =
        previewData.noteAutoYCorrection ?? shownPosition.noteAutoYCorrection;
      const noteEffectEnabled =
        previewData.noteEffectEnabled ?? shownPosition.noteEffectEnabled;

      onNoteColorPreview(
        shownKey.index,
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
    // 열 때마다 새 인스턴스로 간다. 퇴장 유예 동안 재오픈하면 인스턴스가 재사용돼
    // 취소했던 편집 상태가 남고, 다른 키를 열면 그 값이 그대로 저장될 수 있다
    <UnifiedKeySetting
      key={`${cycle}:${shownKey.index}`}
      keyData={{
        key: shownKey.key,
        activeImage: shownPosition.activeImage,
        inactiveImage: shownPosition.inactiveImage,
        activeTransparent: shownPosition.activeTransparent || false,
        idleTransparent: shownPosition.idleTransparent || false,
        width: shownPosition.width,
        height: shownPosition.height,
        noteColor: shownPosition.noteColor || '#FFFFFF',
        noteOpacity: shownPosition.noteOpacity ?? 90,
        noteEffectEnabled: shownPosition.noteEffectEnabled,
        noteGlowEnabled: shownPosition.noteGlowEnabled ?? true,
        noteGlowSize: shownPosition.noteGlowSize ?? 20,
        noteGlowOpacity: shownPosition.noteGlowOpacity ?? 70,
        noteGlowColor:
          shownPosition.noteGlowColor || shownPosition.noteColor || '#FFFFFF',
        noteAutoYCorrection: shownPosition.noteAutoYCorrection,
        className: shownPosition.className || '',
      }}
      initialCounterSettings={shownPosition.counter || null}
      onClose={handleClose}
      onSave={handleSave}
      onPreview={handlePreview}
      motionState={motionState}
    />
  );
};

export default GridKeySettingModal;
