import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import { NumberInput } from '@components/main/common/NumberInput';
import TabSwitch from '@components/main/common/TabSwitch';
import { PropertySection } from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import { resolveImageSource } from '@utils/core/imageSource';
import { canDecodeImage } from '@utils/core/assetProbe';
import { useEditSessionCompletionGuard } from '@src/renderer/contexts/EditSessionScope';

import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';
import { imageApi } from '@api/modules/resourceApi';
import {
  DEFAULT_IMAGE_MODE,
  IDENTITY_IMAGE_TRANSFORM,
  IMAGE_TRANSFORM_CONSTRAINTS,
  applyImageTransformLeaf,
  imageTransformToCss,
  type ImageMode,
  type ImageTransform,
  type ImageTransformLeaf,
} from '@src/types/key/imageLayer';
import {
  useEditStatePreviewPublisher,
  type EditStateAnchor,
} from '@stores/grid/useEditStatePreviewStore';

interface ImagePickerProps {
  open: boolean;
  /** 캔버스 상태 프리뷰 대상 - 지정 시 열려 있는 동안 편집 상태를 발행 */
  previewAnchor?: EditStateAnchor | null;
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
  /** 이미지 레이어 모드·변환 - 키 요소만 편집 가능 */
  imageMode?: ImageMode;
  idleImageTransform?: ImageTransform;
  activeImageTransform?: ImageTransform;
  onImageModeChange?: (mode: ImageMode) => void;
  onImageTransformChange?: (
    state: 'idle' | 'active',
    leaf: ImageTransformLeaf,
    value: number,
  ) => void;
  /** 입력 중·드래그 중 값 - 저장 없이 캔버스에만 비친다 */
  onImageTransformPreview?: (
    state: 'idle' | 'active',
    leaf: ImageTransformLeaf,
    value: number,
  ) => void;
  onImageTransformCancel?: () => void;
  onClose: () => void;
  interactiveRefs?: React.RefObject<HTMLElement>[];
  /** 눌림 상태가 없는 요소는 대기 이미지만 편집 */
  showActiveState?: boolean;
  /** 비동기 완료 콜백이 안정 ID applier로 라우팅되면 element-id */
  completionBinding?: CompletionBinding;
}

// 회전·크기 입력의 접두 글리프 - X/Y 글자와 같은 자리
const AngleGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M2 2v8h8M2 5.5a4.5 4.5 0 0 1 4.5 4.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ScaleGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M2 10L10 2M10 2H6.5M10 2v3.5M2 10h3.5M2 10V6.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const STATE_MODES = {
  idle: 'idle',
  active: 'active',
} as const;

const ImagePicker = ({
  open,
  previewAnchor = null,
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
  imageMode = DEFAULT_IMAGE_MODE,
  idleImageTransform,
  activeImageTransform,
  onImageModeChange,
  onImageTransformChange,
  onImageTransformPreview,
  onImageTransformCancel,
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
  // 열려 있는 동안 편집 상태를 캔버스 프리뷰로 발행
  useEditStatePreviewPublisher(open ? previewAnchor : null, effectiveMode);

  useEffect(() => {
    if (!showActiveState) setMode(STATE_MODES.idle);
  }, [showActiveState]);

  const showInvalidImageAlert = (): void => {
    void window.api.ui.dialog
      .alert(t('imagePicker.invalidImage'), {
        confirmText: t('common.ok') || '확인',
      })
      .catch((error) => {
        console.error('Failed to open invalid image alert:', error);
      });
  };

  const handleImageClick = async (stateMode: string): Promise<void> => {
    if (loadingImageRef.current) return;
    loadingImageRef.current = true;
    setIsLoadingImage(true);
    try {
      const result = await imageApi.load();
      if (!result?.success || !result.imagePath) {
        // errorCode가 없는 실패는 사용자 취소
        if (result?.errorCode) showInvalidImageAlert();
        return;
      }
      // 시그니처를 통과해도 WebView가 못 그리는 파일이 있다. 직전 값을 덮기 전에 확인한다
      if (!(await canDecodeImage(result.imagePath))) {
        showInvalidImageAlert();
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

  const showImageLayer = typeof onImageTransformChange === 'function';
  const committedTransform =
    (effectiveMode === STATE_MODES.idle
      ? idleImageTransform
      : activeImageTransform) ?? IDENTITY_IMAGE_TRANSFORM;
  // 미리보기 썸네일도 드래그를 따라가야 한다. 확정 전 값은 저장소에 없으므로 여기서 든다
  const [draftTransform, setDraftTransform] = useState<{
    mode: typeof effectiveMode;
    transform: ImageTransform;
  } | null>(null);
  const currentTransform =
    draftTransform?.mode === effectiveMode
      ? draftTransform.transform
      : committedTransform;
  const currentTransformCss = imageTransformToCss(currentTransform);
  const handleTransformLeaf = (leaf: ImageTransformLeaf, value: number) => {
    setDraftTransform(null);
    onImageTransformChange?.(effectiveMode, leaf, value);
  };
  const canPreviewTransform = typeof onImageTransformPreview === 'function';
  const handleTransformLeafPreview = (
    leaf: ImageTransformLeaf,
    value: number,
  ) => {
    setDraftTransform({
      mode: effectiveMode,
      transform: applyImageTransformLeaf(committedTransform, { leaf, value }),
    });
    onImageTransformPreview?.(effectiveMode, leaf, value);
  };
  const handleTransformCancel = () => {
    setDraftTransform(null);
    onImageTransformCancel?.();
  };
  // 입력별 preview·cancel 묶음. preview 콜백이 없으면 둘 다 빼서 타이핑이 저장으로 바로 간다
  const transformLeafGesture = (leaf: ImageTransformLeaf, scale = 1) =>
    canPreviewTransform
      ? {
          onPreview: (value: number) =>
            handleTransformLeafPreview(leaf, value / scale),
          onCancel: handleTransformCancel,
        }
      : {};

  return (
    <PickerSurface
      open={open}
      ariaLabel={t('keySetting.customImage')}
      referenceRef={referenceRef}
      panelElement={panelElement}
      fallbackWidth={172}
      fallbackHeight={220}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[172px] rounded-popup"
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
        {currentImageSrc && !currentTransparent && (
          <img
            key={currentImageSrc}
            src={currentImageSrc}
            alt=""
            data-image-picker-preview="true"
            className="absolute inset-0 block w-full h-full pointer-events-none select-none"
            style={{
              objectFit: (currentImageFit ||
                'cover') as React.CSSProperties['objectFit'],
              transform: currentTransformCss,
            }}
            draggable={false}
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
            // 18px 칩에 라이브 블러는 보이지도 않는다. 게다가 바깥 글래스 표면이
            // backdrop root라 이 칩은 그 표면 안쪽만 샘플하면서 재필터만 한 겹 더 든다
            className="absolute top-[4px] right-[4px] z-10 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] bg-glass-dim-solid shadow-elevation-chrome text-fg-faint hover:text-fg opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path
                d="M1 1L7 7M7 1L1 7"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* 상태별 위치·회전·크기 - 라벨 대신 접두 글리프가 의미를 맡는다 */}
      {showImageLayer && (
        <div className="flex flex-col gap-[4px]">
          <div className="flex items-center gap-[8px] w-full">
            <NumberInput
              commitStrategy="after-paint"
              value={currentTransform.offsetX}
              onChange={(value) => handleTransformLeaf('offsetX', value)}
              {...transformLeafGesture('offsetX')}
              prefix="X"
              ariaLabel={`${t('imagePicker.position')} X`}
              width="100%"
              min={IMAGE_TRANSFORM_CONSTRAINTS.offset.min}
              max={IMAGE_TRANSFORM_CONSTRAINTS.offset.max}
              allowDecimal
              decimalScale={1}
            />
            <NumberInput
              commitStrategy="after-paint"
              value={currentTransform.offsetY}
              onChange={(value) => handleTransformLeaf('offsetY', value)}
              {...transformLeafGesture('offsetY')}
              prefix="Y"
              ariaLabel={`${t('imagePicker.position')} Y`}
              width="100%"
              min={IMAGE_TRANSFORM_CONSTRAINTS.offset.min}
              max={IMAGE_TRANSFORM_CONSTRAINTS.offset.max}
              allowDecimal
              decimalScale={1}
            />
          </div>
          <div className="flex items-center gap-[8px] w-full">
            <NumberInput
              commitStrategy="after-paint"
              value={currentTransform.rotation}
              onChange={(value) => handleTransformLeaf('rotation', value)}
              {...transformLeafGesture('rotation')}
              prefix={<AngleGlyph />}
              ariaLabel={t('imagePicker.rotation')}
              suffix="°"
              width="100%"
              min={IMAGE_TRANSFORM_CONSTRAINTS.rotation.min}
              max={IMAGE_TRANSFORM_CONSTRAINTS.rotation.max}
              allowDecimal
              decimalScale={1}
            />
            <NumberInput
              commitStrategy="after-paint"
              value={Math.round(currentTransform.scale * 100)}
              onChange={(value) => handleTransformLeaf('scale', value / 100)}
              {...transformLeafGesture('scale', 100)}
              prefix={<ScaleGlyph />}
              ariaLabel={t('imagePicker.scale')}
              suffix="%"
              width="100%"
              min={IMAGE_TRANSFORM_CONSTRAINTS.scale.min * 100}
              max={IMAGE_TRANSFORM_CONSTRAINTS.scale.max * 100}
            />
          </div>
        </div>
      )}

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

        {/* 배치 모드 - 공통 */}
        {typeof onImageModeChange === 'function' && (
          <div className="flex justify-between items-center w-full min-h-[32px]">
            <p className="text-fg-muted text-label">{t('imagePicker.mode')}</p>
            <Dropdown
              commitStrategy="after-paint"
              value={imageMode}
              options={[
                { value: 'replace', label: t('imagePicker.modeReplace') },
                { value: 'overlay', label: t('imagePicker.modeOverlay') },
              ]}
              onChange={(value) => onImageModeChange(value as ImageMode)}
            />
          </div>
        )}
      </PropertySection>
    </PickerSurface>
  );
};

export default ImagePicker;
