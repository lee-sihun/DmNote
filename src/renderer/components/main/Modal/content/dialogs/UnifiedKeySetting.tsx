/* eslint-disable react-hooks/refs */
import { usePressAction } from '@hooks/usePressAction';
import React from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';
import TabSwitch from '@components/main/common/TabSwitch';
import KeyTabContent, {
  type KeyTabContentRef,
} from '../settings/KeyTabContent';
import NoteTabContent, {
  type NoteTabContentRef,
} from '../settings/NoteTabContent';
import CounterTabContent, {
  type CounterTabContentRef,
} from '../settings/CounterTabContent';
import ImagePicker from '../pickers/ImagePicker';
import ColorPicker from '../pickers/ColorPicker';
import {
  TABS,
  useUnifiedKeySettingState,
  COLOR_MODES,
  toGradient,
  type TabType,
  type KeyData,
  type SaveData,
  type PreviewData,
} from '@hooks/Modal/useUnifiedKeySettingState';
import type { KeyCounterSettings } from '@src/types/key/keys';

// ============================================================================
// 타입 정의
// ============================================================================

interface UnifiedKeySettingProps {
  keyData: KeyData;
  initialCounterSettings?: KeyCounterSettings | null;
  onSave: (data: SaveData) => void;
  onClose: () => void;
  onPreview?: (data: PreviewData) => void;
  skipAnimation?: boolean;
}

// ============================================================================
// 메인 컴포넌트
// ============================================================================

const UnifiedKeySetting: React.FC<UnifiedKeySettingProps> = ({
  keyData,
  initialCounterSettings,
  onSave,
  onClose,
  onPreview,
  skipAnimation = false,
}) => {
  const { t } = useTranslation();
  const initialSkipRef = React.useRef(skipAnimation);
  const contentRef = React.useRef<HTMLDivElement>(null);
  // 컨테이너 높이 (애니메이션용)
  const [containerHeight, setContainerHeight] = React.useState<number | null>(
    null,
  );
  // 높이 애니메이션 스킵 여부 (초기 마운트 시)
  const isFirstRender = React.useRef(true);

  // 탭 콘텐츠 refs
  const keyTabRef = React.useRef<KeyTabContentRef>(null);
  const noteTabRef = React.useRef<NoteTabContentRef>(null);
  const counterTabRef = React.useRef<CounterTabContentRef>(null);

  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  const {
    activeTab,
    setActiveTab,
    keyState,
    setKeyState,
    noteState,
    setNoteState,
    counterState,
    setCounterState,
    handleKeyPreview,
    handleNotePreview,
    handleCounterPreview,
    handleSubmit,
    handleClose,
  } = useUnifiedKeySettingState({
    keyData,
    initialCounterSettings,
    onPreview,
    onSave,
    onClose,
  });

  // 탭 변경 또는 마운트 시 콘텐츠 높이 동기화 (높이 애니메이션용)
  React.useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const updateHeight = () => {
      const contentHeight = contentEl.scrollHeight;
      const maxHeight = 195;
      setContainerHeight(Math.min(contentHeight, maxHeight));
    };

    // 스크롤 영역 내부의 콘텐츠 크기 변경을 감지
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(contentEl);
    updateHeight();

    // 다음 프레임에서 첫 렌더 플래그 해제
    const rafId = requestAnimationFrame(() => {
      isFirstRender.current = false;
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [activeTab]);

  // 탭 변경 시 스크롤 최상단으로 초기화
  React.useEffect(() => {
    if (lenisInstance.current) {
      lenisInstance.current.scrollTo(0, { immediate: true });
    }
  }, [activeTab, lenisInstance]);

  // 탭 콘텐츠 렌더링
  const renderTabContent = () => {
    switch (activeTab) {
      case TABS.KEY:
        return (
          <KeyTabContent
            ref={keyTabRef}
            state={keyState}
            setState={setKeyState}
            onPreview={handleKeyPreview}
          />
        );
      case TABS.NOTE:
        return (
          <NoteTabContent
            ref={noteTabRef}
            state={noteState}
            setState={setNoteState}
            onPreview={handleNotePreview}
          />
        );
      case TABS.COUNTER:
        return (
          <CounterTabContent
            ref={counterTabRef}
            state={counterState}
            setState={setCounterState}
            onPreview={handleCounterPreview}
          />
        );
      default:
        return null;
    }
  };

  // 이미지 변경 핸들러 (KeyTab용)
  const handleIdleImageChange = (imageUrl: string) => {
    setKeyState((prev) => ({ ...prev, inactiveImage: imageUrl }));
    handleKeyPreview({ inactiveImage: imageUrl });
  };

  const handleActiveImageChange = (imageUrl: string) => {
    setKeyState((prev) => ({ ...prev, activeImage: imageUrl }));
    handleKeyPreview({ activeImage: imageUrl });
  };

  const handleIdleTransparentChange = (checked: boolean) => {
    setKeyState((prev) => ({ ...prev, idleTransparent: checked }));
    handleKeyPreview({ idleTransparent: checked });
  };

  const handleActiveTransparentChange = (checked: boolean) => {
    setKeyState((prev) => ({ ...prev, activeTransparent: checked }));
    handleKeyPreview({ activeTransparent: checked });
  };

  // 입력 blur 커밋과의 경합으로 첫 click이 유실되는 것을 방어
  const submitPress = usePressAction(() => handleSubmit());
  const cancelPress = usePressAction(() => handleClose());
  return (
    <Modal
      onClick={handleClose}
      animate={!initialSkipRef.current}
      ariaLabel={t('keySetting.title')}
    >
      <div
        className="flex flex-col min-w-[264px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 p-[14px]"
        onClick={(e) => e.stopPropagation()}
      >
        <TabSwitch
          commitStrategy="after-paint"
          tabs={[
            { id: TABS.KEY, label: t('keySetting.tabKey') },
            { id: TABS.NOTE, label: t('keySetting.tabNote') },
            { id: TABS.COUNTER, label: t('keySetting.tabCounter') },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab as TabType)}
          className="mb-[12px]"
        />

        {/* 스크롤 영역 */}
        <div
          ref={scrollRef}
          className="overflow-y-auto modal-content-scroll dmn-scroll-fade"
          style={{
            height: containerHeight !== null ? `${containerHeight}px` : 'auto',
            maxHeight: '195px',
            transition: isFirstRender.current
              ? 'none'
              : 'height 100ms ease-in-out',
          }}
        >
          <div ref={contentRef}>{renderTabContent()}</div>
        </div>

        {/* 저장/취소 버튼 */}
        <div className="flex gap-[8px] mt-[12px]">
          <button
            {...submitPress}
            className="flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
          >
            {t('keySetting.save')}
          </button>
          <button
            {...cancelPress}
            className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
          >
            {t('keySetting.cancel')}
          </button>
        </div>
      </div>

      {/* 이미지 피커 - 스크롤 영역 외부에 렌더링 */}
      {keyState.showImagePicker && (
        <ImagePicker
          open={keyState.showImagePicker}
          referenceRef={keyTabRef.current?.imageButtonRef}
          idleImage={keyState.inactiveImage}
          activeImage={keyState.activeImage}
          idleTransparent={keyState.idleTransparent}
          activeTransparent={keyState.activeTransparent}
          onIdleImageChange={handleIdleImageChange}
          onActiveImageChange={handleActiveImageChange}
          onIdleTransparentChange={handleIdleTransparentChange}
          onActiveTransparentChange={handleActiveTransparentChange}
          onIdleImageReset={() => handleIdleImageChange('')}
          onActiveImageReset={() => handleActiveImageChange('')}
          onClose={() =>
            setKeyState((prev) => ({ ...prev, showImagePicker: false }))
          }
        />
      )}

      {/* 노트 컬러 피커 - 스크롤 영역 외부에 렌더링 */}
      {noteState.showPicker && (
        <ColorPicker
          open={noteState.showPicker}
          referenceRef={noteTabRef.current?.colorButtonRef}
          color={
            noteState.colorMode === COLOR_MODES.gradient
              ? toGradient(noteState.noteColor, noteState.gradientBottom)
              : noteState.noteColor
          }
          onColorChange={(c) => noteTabRef.current?.handleColorChange(c)}
          onColorChangeComplete={(c) =>
            noteTabRef.current?.handleColorChangeComplete(c)
          }
          onClose={() =>
            setNoteState((prev) => ({ ...prev, showPicker: false }))
          }
          position={'right'}
        />
      )}

      {/* 글로우 컬러 피커 - 스크롤 영역 외부에 렌더링 */}
      {noteState.showGlowPicker && (
        <ColorPicker
          open={noteState.showGlowPicker}
          referenceRef={noteTabRef.current?.glowColorButtonRef}
          color={
            noteState.glowColorMode === COLOR_MODES.gradient
              ? toGradient(noteState.glowColor, noteState.glowGradientBottom)
              : noteState.glowColor
          }
          onColorChange={(c) => noteTabRef.current?.handleGlowColorChange(c)}
          onColorChangeComplete={(c) =>
            noteTabRef.current?.handleGlowColorChangeComplete(c)
          }
          onClose={() =>
            setNoteState((prev) => ({ ...prev, showGlowPicker: false }))
          }
          position={'right'}
        />
      )}

      {/* 카운터 컬러 피커 - 스크롤 영역 외부에 렌더링 */}
      {counterState.pickerFor && (
        <ColorPicker
          open={counterState.pickerOpen}
          referenceRef={counterTabRef.current?.fillActiveBtnRef}
          color={
            counterTabRef.current?.colorValueFor(counterState.pickerFor) ??
            '#FFFFFF'
          }
          onColorChange={(c: string) =>
            counterTabRef.current?.setColorFor(counterState.pickerFor, c)
          }
          onColorChangeComplete={(c: string) =>
            counterTabRef.current?.handleColorComplete(
              counterState.pickerFor,
              c,
            )
          }
          onClose={() =>
            setCounterState((prev) => ({
              ...prev,
              pickerFor: null,
              pickerOpen: false,
            }))
          }
          solidOnly={true}
          interactiveRefs={counterTabRef.current?.colorPickerInteractiveRefs}
          position={'right'}
        />
      )}
    </Modal>
  );
};

export default UnifiedKeySetting;
