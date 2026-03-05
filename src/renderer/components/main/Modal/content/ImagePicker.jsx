import React, { useState, useRef, useLayoutEffect } from 'react';
import { useTranslation } from '@contexts/I18nContext';
import FloatingPopup from '../FloatingPopup';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import { resolveImageSource } from '@utils/imageSource';

const STATE_MODES = {
  idle: 'idle',
  active: 'active',
};

export default function ImagePicker({
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
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(STATE_MODES.idle);
  const [isLoadingImage, setIsLoadingImage] = useState(false);

  const handleImageClick = async (stateMode) => {
    if (isLoadingImage) return;
    setIsLoadingImage(true);
    try {
      const result = await window.api.image.load();
      if (!result?.success || !result.imagePath) {
        return;
      }
      if (stateMode === STATE_MODES.idle) {
        onIdleImageChange?.(result.imagePath);
      } else {
        onActiveImageChange?.(result.imagePath);
      }
    } catch (error) {
      console.error('Failed to load image', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  const handleReset = () => {
    if (mode === STATE_MODES.idle) {
      onIdleImageReset?.();
    } else {
      onActiveImageReset?.();
    }
  };

  const currentImage = mode === STATE_MODES.idle ? idleImage : activeImage;
  const currentImageSrc = resolveImageSource(currentImage);
  const currentTransparent =
    mode === STATE_MODES.idle ? idleTransparent : activeTransparent;
  const currentImageFit =
    mode === STATE_MODES.idle ? idleImageFit : activeImageFit;
  const showImageFit =
    typeof onIdleImageFitChange === 'function' ||
    typeof onActiveImageFitChange === 'function';
  const handleTransparentToggle = () => {
    if (mode === STATE_MODES.idle) {
      onIdleTransparentChange?.(!idleTransparent);
    } else {
      onActiveTransparentChange?.(!activeTransparent);
    }
  };

  const handleImageFitChange = (value) => {
    if (mode === STATE_MODES.idle) {
      onIdleImageFitChange?.(value);
    } else {
      onActiveImageFitChange?.(value);
    }
  };

  // 고정 위치 상태
  const [fixedPosition, setFixedPosition] = useState(null);
  const pickerContainerRef = useRef(null);

  // panelElement가 있을 때 고정 위치 계산 (패널 기준, ColorPicker와 동일한 위치)
  useLayoutEffect(() => {
    if (!open) {
      setFixedPosition(null);
      return;
    }

    if (panelElement) {
      // 다음 프레임에서 실제 렌더링된 picker 크기를 측정
      requestAnimationFrame(() => {
        const panelRect = panelElement.getBoundingClientRect();

        // picker 요소의 실제 크기를 측정하거나 기본값 사용
        const pickerEl = pickerContainerRef.current;
        const pickerWidth = pickerEl ? pickerEl.offsetWidth : 164;
        const pickerHeight = pickerEl ? pickerEl.offsetHeight : 220;

        // ColorPicker의 솔리드 모드 높이를 기준으로 하단 정렬
        const colorPickerSolidHeight = 264;

        const gap = 5; // 패널과 피커 사이의 간격
        const padding = 5; // 화면 가장자리 패딩

        // X축: 패널 왼쪽에서 gap만큼 떨어진 위치
        let fixedX = panelRect.left - pickerWidth - gap;

        // 왼쪽 화면 경계를 벗어나면 최소 padding 위치로 조정
        if (fixedX < padding) {
          fixedX = padding;
        }

        // Y축: ColorPicker의 솔리드 모드 하단과 동일한 위치에 ImagePicker 하단 정렬
        const panelBottomPadding = 20;
        const solidPickerBottom = panelRect.bottom - panelBottomPadding;

        // ImagePicker 하단을 ColorPicker 솔리드 모드 하단과 동일하게
        let fixedY = solidPickerBottom - pickerHeight;

        // Y축 상단 경계 체크
        if (fixedY < padding) {
          fixedY = padding;
        }

        setFixedPosition({ x: fixedX, y: fixedY });
      });
    } else {
      setFixedPosition(null);
    }
  }, [open, panelElement]);

  // fixedPosition이 있으면 offsetY를 무시 (이미 정확한 좌표가 계산됨)
  const effectiveOffsetY = fixedPosition ? 0 : -93;

  return (
    <FloatingPopup
      open={open}
      referenceRef={referenceRef}
      fixedX={fixedPosition?.x}
      fixedY={fixedPosition?.y}
      placement="right-start"
      offset={32}
      offsetY={effectiveOffsetY}
      className="z-50"
      interactiveRefs={interactiveRefs}
      onClose={onClose}
      autoClose={false}
    >
      <div
        ref={pickerContainerRef}
        className="flex flex-col p-[8px] gap-[8px] w-[146px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30]"
      >
        {/* 모드 전환 버튼 */}
        <div className="flex gap-[6px] max-w-full">
          {[
            { key: STATE_MODES.idle, label: t('imagePicker.idle') },
            { key: STATE_MODES.active, label: t('imagePicker.active') },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`flex-1 whitespace-nowrap px-[9px] h-[23px] rounded-[7px] text-style-4 text-[#DBDEE8] transition-colors ${
                mode === item.key
                  ? 'bg-[#2E2D33] text-[#FFFFFF]'
                  : 'hover:bg-[#303036] text-[#6F6E7A]'
              }`}
              onClick={() => setMode(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 이미지 미리보기 영역 */}
        <div className="relative w-[129px] h-[64px] rounded-[7px] border-[1px] border-[#3A3943] overflow-hidden cursor-pointer group">
          {/* 투명 격자 배경 */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
              backgroundSize: '10px 10px',
              backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px',
              backgroundColor: '#fff',
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
            onClick={() => handleImageClick(mode)}
            style={{
              pointerEvents: isLoadingImage ? 'none' : 'auto',
              cursor: isLoadingImage ? 'progress' : 'pointer',
            }}
          />
        </div>

        {/* 구분선 */}
        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        {/* 키 투명화 토글 */}
        <div className="flex justify-between items-center w-full">
          <p className="text-white text-style-2">
            {t('imagePicker.transparent')}
          </p>
          <Checkbox
            checked={currentTransparent}
            onChange={handleTransparentToggle}
          />
        </div>

        {/* 이미지 맞춤 */}
        {showImageFit && (
          <div className="flex justify-between items-center w-full">
            <p className="text-white text-style-2">
              {t('propertiesPanel.imageFit') || '표시'}
            </p>
            <Dropdown
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

        {/* 구분선 */}
        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        {/* 이미지 초기화 버튼 */}
        <button
          onClick={handleReset}
          className="w-full h-[23px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-2 transition-colors"
        >
          {t('imagePicker.reset')}
        </button>
      </div>
    </FloatingPopup>
  );
}
