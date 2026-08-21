import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import TabSwitch from '@components/main/common/TabSwitch';
import { PropertySection } from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import { resolveImageSource } from '@utils/core/imageSource';
import { useEditSessionCompletionGuard } from '@src/renderer/contexts/EditSessionScope';

import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';
import { imageApi } from '@api/modules/resourceApi';

interface ImagePickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  idleImage?: string;
  activeImage?: string;
  idleTransparent?: boolean;
  activeTransparent?: boolean;
  idleImageFit?: string;
  activeImageFit?: string;
  onIdleImageChange?: (path: string) => void;
  onActiveImageChange?: (path: string) => void;
  onIdleTransparentChange?: (value: boolean) => void;
  onActiveTransparentChange?: (value: boolean) => void;
  onIdleImageFitChange?: (value: string) => void;
  onActiveImageFitChange?: (value: string) => void;
  onIdleImageReset?: () => void;
  onActiveImageReset?: () => void;
  onClose: () => void;
  interactiveRefs?: React.RefObject<HTMLElement>[];
  /** 눌림 상태가 없는 요소는 대기 이미지만 편집 */
  showActiveState?: boolean;
  /** 비동기 완료 콜백이 안정 ID applier로 라우팅되면 element-id */
  completionBinding?: CompletionBinding;
}

const STATE_MODES = {
  idle: 'idle',
  active: 'active',
} as const;

const ImagePicker = ({
  open,
  referenceRef,
  panelElement = null,
  idleImage,
  activeImage,
  idleTransparent,
  activeTransparent,
  idleImageFit = 'cover',
  activeImageFit = 'cover',
  onIdleImageChange,
  onActiveImageChange,
  onIdleTransparentChange,
  onActiveTransparentChange,
  onIdleImageFitChange = undefined,
  onActiveImageFitChange = undefined,
  onIdleImageReset,
  onActiveImageReset,
  onClose,
  interactiveRefs = [],
  showActiveState = true,
  completionBinding = 'session-mode',
}: ImagePickerProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<
    (typeof STATE_MODES)[keyof typeof STATE_MODES]
  >(STATE_MODES.idle);
  const [isLoadingImage, setIsLoadingImage] = useState<boolean>(false);
  const loadingImageRef = useRef(false);
  const canBindCompletion = useEditSessionCompletionGuard(completionBinding);
  const effectiveMode = showActiveState ? mode : STATE_MODES.idle;

  useEffect(() => {
    if (!showActiveState) setMode(STATE_MODES.idle);
  }, [showActiveState]);

  const handleImageClick = async (stateMode: string): Promise<void> => {
    if (loadingImageRef.current) return;
    loadingImageRef.current = true;
    setIsLoadingImage(true);
    try {
      const result = await imageApi.load();
      if (!result?.success || !result.imagePath) {
        return;
      }
      // 파일 복사는 이미 끝났다. 대상이 갈렸으면 연결만 하지 않는다
      // (element-id 결합이면 ID applier가 유효성을 판정하므로 통과)
      if (!canBindCompletion()) return;
      if (stateMode === STATE_MODES.idle) {
        onIdleImageChange?.(result.imagePath);
      } else {
        onActiveImageChange?.(result.imagePath);
      }
    } catch (error) {
      console.error('Failed to load image', error);
    } finally {
      loadingImageRef.current = false;
      setIsLoadingImage(false);
    }
  };

  const handleReset = (): void => {
    if (effectiveMode === STATE_MODES.idle) {
      onIdleImageReset?.();
    } else {
      onActiveImageReset?.();
    }
  };

  const currentImage =
    effectiveMode === STATE_MODES.idle ? idleImage : activeImage;
  const currentImageSrc = resolveImageSource(currentImage);
  const currentTransparent =
    effectiveMode === STATE_MODES.idle ? idleTransparent : activeTransparent;
  const currentImageFit =
    effectiveMode === STATE_MODES.idle ? idleImageFit : activeImageFit;
  const showImageFit =
    typeof onIdleImageFitChange === 'function' ||
    typeof onActiveImageFitChange === 'function';
  const handleTransparentToggle = (): void => {
    if (effectiveMode === STATE_MODES.idle) {
      onIdleTransparentChange?.(!idleTransparent);
    } else {
      onActiveTransparentChange?.(!activeTransparent);
    }
  };

  const handleImageFitChange = (value: string): void => {
    if (effectiveMode === STATE_MODES.idle) {
      onIdleImageFitChange?.(value);
    } else {
      onActiveImageFitChange?.(value);
    }
  };

  return (
    <PickerSurface
      open={open}
      ariaLabel={t('keySetting.customImage')}
      referenceRef={referenceRef}
      panelElement={panelElement}
      fallbackWidth={172}
      fallbackHeight={220}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[172px] bg-glass-heavy backdrop-glass rounded-popup shadow-elevation-3"
      offsetY={-93}
      interactiveRefs={interactiveRefs}
      onClose={onClose}
    >
      {/* 모드 전환 */}
      {showActiveState ? (
        <TabSwitch
          commitStrategy="after-paint"
          tabs={[
            { id: STATE_MODES.idle, label: t('imagePicker.idle') },
            { id: STATE_MODES.active, label: t('imagePicker.active') },
          ]}
          activeTab={effectiveMode}
          onTabChange={(nextMode) => setMode(nextMode as typeof effectiveMode)}
        />
      ) : null}

      {/* 이미지 미리보기 영역 */}
      <div className="relative w-full h-[76px] rounded-[8px] overflow-hidden cursor-pointer group">
        {/* 투명 격자 배경 */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'var(--ui-checker-pattern) center / var(--ui-checker-size) var(--ui-checker-size) repeat',
          }}
        />

        {/* 이미지 표시 */}
        {currentImage && !currentTransparent && (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: currentImageSrc
                ? `url(${currentImageSrc})`
                : 'none',
            }}
          />
        )}

        {/* 호버 오버레이 */}
        <div
          className="absolute inset-0 bg-black opacity-0 group-hover:opacity-40 transition-opacity"
          onClick={() => handleImageClick(effectiveMode)}
          style={{
            pointerEvents: isLoadingImage ? 'none' : 'auto',
            cursor: isLoadingImage ? 'progress' : 'pointer',
          }}
        />

        {/* 초기화 칩 — 이미지가 있을 때만, 프리뷰 호버 시 표시 */}
        {currentImage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleReset();
            }}
            title={t('imagePicker.reset')}
            className="absolute top-[4px] right-[4px] z-10 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] bg-glass-dim backdrop-glass-popup shadow-elevation-chrome text-fg-faint hover:text-fg opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path
                d="M1 1L7 7M7 1L1 7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* 설정 카드 */}
      <PropertySection>
        {/* 키 투명화 토글 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('imagePicker.transparent')}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={currentTransparent}
            onChange={handleTransparentToggle}
          />
        </div>

        {/* 이미지 맞춤 */}
        {showImageFit && (
          <div className="flex justify-between items-center w-full min-h-[32px]">
            <p className="text-fg-muted text-label">
              {t('propertiesPanel.imageFit') || '표시'}
            </p>
            <Dropdown
              commitStrategy="after-paint"
              value={currentImageFit || 'cover'}
              options={[
                {
                  value: 'cover',
                  label: t('propertiesPanel.imageFitCover') || '채우기',
                },
                {
                  value: 'contain',
                  label: t('propertiesPanel.imageFitContain') || '맞춤',
                },
                {
                  value: 'fill',
                  label: t('propertiesPanel.imageFitFill') || '늘리기',
                },
                {
                  value: 'none',
                  label: t('propertiesPanel.imageFitNone') || '원본',
                },
              ]}
              onChange={handleImageFitChange}
            />
          </div>
        )}
      </PropertySection>
    </PickerSurface>
  );
};

export default ImagePicker;
