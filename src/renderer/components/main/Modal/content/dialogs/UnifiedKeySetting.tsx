/* eslint-disable react-hooks/refs */
import React from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';
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
import { getScrollShadowState } from '@utils/grid/scrollShadow';
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

interface TabSwitchProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

// ============================================================================
// 탭 스위치 컴포넌트
// ============================================================================

const TabSwitch: React.FC<TabSwitchProps> = ({ activeTab, onTabChange }) => {
  const { t } = useTranslation();

  const tabs = [
    { id: TABS.KEY, label: t('keySetting.tabKey') },
    { id: TABS.NOTE, label: t('keySetting.tabNote') },
    { id: TABS.COUNTER, label: t('keySetting.tabCounter') },
  ] as const;

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
};

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
  const [scrollState, setScrollState] = React.useState({
    hasTopShadow: false,
    hasBottomShadow: false,
  });
  const [hasOverflow, setHasOverflow] = React.useState(false);
  // 탭 전환 시 그림자 애니메이션 스킵 여부 (깜빡임 방지)
  const [skipShadowTransition, setSkipShadowTransition] = React.useState(false);
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

  // 스크롤 상태 업데이트 함수
  const updateScrollState = (el: HTMLElement | null) => {
    if (!el) return;
    const nextState = getScrollShadowState(el, contentRef.current);
    setScrollState((prev) =>
      prev.hasTopShadow === nextState.hasTopShadow &&
      prev.hasBottomShadow === nextState.hasBottomShadow
        ? prev
        : nextState,
    );
  };

  // Lenis smooth scroll 적용 (onScroll 콜백으로 그림자 업데이트)
  const {
    scrollContainerRef: scrollRef,
    wrapperElement,
    lenisInstance,
    scrollbarWidth,
  } = useLenis({
    onScroll: () => updateScrollState(wrapperElement),
  });

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

  // 탭 변경 또는 마운트 시 스크롤 상태 확인 (DOM 렌더링 후 확인)
  React.useEffect(() => {
    // 탭 전환 시 그림자 애니메이션 스킵
    setSkipShadowTransition(true);

    // 콘텐츠 크기 변경 감지를 위한 ResizeObserver
    const el = wrapperElement;
    const contentEl = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (contentEl) {
        const contentHeight = contentEl.scrollHeight;
        const maxHeight = 195;
        setContainerHeight(Math.min(contentHeight, maxHeight));
        const nextHasOverflow = contentHeight > maxHeight;
        setHasOverflow((prev) =>
          prev === nextHasOverflow ? prev : nextHasOverflow,
        );
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState(el);
      updateHeight();
    });

    // 스크롤 영역 내부의 콘텐츠 크기 변경을 감지
    if (contentEl) {
      resizeObserver.observe(contentEl);
    }
    resizeObserver.observe(el);

    // 초기 상태 확인
    updateScrollState(el);
    updateHeight();

    // 다음 프레임에서 애니메이션 다시 활성화 및 첫 렌더 플래그 해제
    const rafId = requestAnimationFrame(() => {
      setSkipShadowTransition(false);
      isFirstRender.current = false;
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [activeTab, wrapperElement]);

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

  return (
    <Modal onClick={handleClose} animate={!initialSkipRef.current}>
      <div
        className="flex flex-col bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px] pr-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pr-[14px]">
          <TabSwitch activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* 스크롤 영역 - 스크롤바가 모달 오른쪽 끝에 위치 */}
        <div className="relative">
          {/* 상단 그림자 */}
          <div
            className={`absolute top-0 left-0 ${
              hasOverflow ? 'right-[14px]' : 'right-0'
            } h-[10px] bg-gradient-to-b from-[#1A191E] to-transparent pointer-events-none z-10 ${
              skipShadowTransition ? '' : 'transition-opacity duration-150'
            } ${scrollState.hasTopShadow ? 'opacity-100' : 'opacity-0'}`}
          />

          <div
            ref={scrollRef}
            className="overflow-y-auto modal-content-scroll pr-[14px]"
            style={{
              height:
                containerHeight !== null ? `${containerHeight}px` : 'auto',
              maxHeight: '195px',
              width:
                hasOverflow && scrollbarWidth > 0
                  ? `calc(100% + ${scrollbarWidth}px)`
                  : undefined,
              transform:
                hasOverflow && scrollbarWidth > 0
                  ? `translateX(-${scrollbarWidth}px)`
                  : undefined,
              paddingLeft:
                hasOverflow && scrollbarWidth > 0
                  ? `${scrollbarWidth}px`
                  : undefined,
              transition: isFirstRender.current
                ? 'none'
                : 'height 100ms ease-in-out',
            }}
          >
            <div ref={contentRef}>{renderTabContent()}</div>
          </div>

          {/* 하단 그림자 */}
          <div
            className={`absolute bottom-0 left-0 ${
              hasOverflow ? 'right-[14px]' : 'right-0'
            } h-[10px] bg-gradient-to-t from-[#1A191E] to-transparent pointer-events-none z-10 ${
              skipShadowTransition ? '' : 'transition-opacity duration-150'
            } ${scrollState.hasBottomShadow ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>

        {/* 저장/취소 버튼 */}
        <div className="flex gap-[10.5px] mt-[19px] pr-[14px]">
          <button
            onClick={handleSubmit}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {t('keySetting.save')}
          </button>
          <button
            onClick={handleClose}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
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
