import React from 'react';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import Dropdown from '@components/main/common/Dropdown';
import { NumberInput } from '@components/main/common/NumberInput';
import {
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  DEFAULT_SPRITE_IMAGE_FIT,
  type ReactiveSpritePosition,
  type SpriteImageFit,
} from '@src/types/key/sprites';

interface SpriteImageSettingsPopupProps {
  open: boolean;
  position: Pick<
    ReactiveSpritePosition,
    'baseImage' | 'imageFit' | 'imageRect'
  >;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement: HTMLElement | null;
  onCommit: (patch: Partial<ReactiveSpritePosition>) => void;
  onPreview: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  /** 파일 선택·디코드 검증·대상 재확인은 패널이 소유한다 */
  onImagePick: () => void;
  onImageReset: () => void;
  onClose: () => void;
  t: (key: string) => string;
}

// 기본 이미지 설정 팝업 - 이미지 상자(미리보기·위치·크기·표시)를
// 커스텀 이미지 전례(행 + 설정하기 + 피커 카드)로 묶은 표현 컴포넌트.
// 카드 규격·미리보기 문법은 이미지 피커와 동일. 기준점은 움직임 속성이라 패널 몫
const SpriteImageSettingsPopup: React.FC<SpriteImageSettingsPopupProps> = ({
  open,
  position,
  referenceRef,
  panelElement,
  onCommit,
  onPreview,
  onCancel,
  onImagePick,
  onImageReset,
  onClose,
  t,
}) => {
  const fit = position.imageFit ?? DEFAULT_SPRITE_IMAGE_FIT;
  const imageSrc = resolveImageSource(position.baseImage);

  const rectField = (patch: Partial<ReactiveSpritePosition['imageRect']>) => ({
    imageRect: { ...position.imageRect, ...patch },
  });

  return (
    <PickerSurface
      open={open}
      ariaLabel={t('propertiesPanel.spriteBaseImage') || '기본 이미지'}
      referenceRef={referenceRef}
      panelElement={panelElement}
      fallbackWidth={172}
      fallbackHeight={198}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[172px] rounded-popup"
      offsetY={-93}
      onClose={onClose}
    >
      {/* 이미지 미리보기 - 전면 선택 버튼과 형제 초기화 버튼 (중첩 버튼 금지) */}
      <div className="relative w-full h-[76px] rounded-[8px] overflow-hidden group">
        {/* 투명 격자 배경 */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'var(--ui-checker-pattern) center / var(--ui-checker-size) var(--ui-checker-size) repeat',
          }}
        />
        {imageSrc ? (
          <img
            key={imageSrc}
            src={imageSrc}
            alt=""
            draggable={false}
            className="absolute inset-0 block w-full h-full pointer-events-none select-none"
            style={{ objectFit: fit as React.CSSProperties['objectFit'] }}
          />
        ) : null}
        <button
          type="button"
          aria-label={t('propertiesPanel.spriteImageSelect') || '선택'}
          onClick={onImagePick}
          className="absolute inset-0 bg-black opacity-0 hover:opacity-40 focus-visible:opacity-40 transition-opacity cursor-pointer"
        />
        {position.baseImage ? (
          <button
            type="button"
            aria-label={t('imagePicker.reset') || '초기화'}
            title={t('imagePicker.reset') || '초기화'}
            onClick={onImageReset}
            // 18px 칩에 라이브 블러는 보이지도 않는다 - 솔리드 토큰 사용 (이미지 피커와 동일)
            className="absolute top-[4px] right-[4px] z-10 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] bg-glass-dim-solid shadow-elevation-chrome text-fg-faint hover:text-fg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-fast"
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
        ) : null}
      </div>

      {/* 위치·크기·기준점 - 접두 글자와 % 접미로 구분하는 무라벨 그리드 */}
      <div className="flex flex-col gap-[4px]">
        <div className="flex items-center gap-[8px] w-full">
          <NumberInput
            value={position.imageRect.x}
            onChange={(value) => onCommit(rectField({ x: value }))}
            onPreview={(value) => onPreview(rectField({ x: value }))}
            onCancel={onCancel}
            prefix="X"
            ariaLabel={`${t('propertiesPanel.spriteImageRect') || '위치'} X`}
            width="100%"
            min={-9999}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={position.imageRect.y}
            onChange={(value) => onCommit(rectField({ y: value }))}
            onPreview={(value) => onPreview(rectField({ y: value }))}
            onCancel={onCancel}
            prefix="Y"
            ariaLabel={`${t('propertiesPanel.spriteImageRect') || '위치'} Y`}
            width="100%"
            min={-9999}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
        </div>
        <div className="flex items-center gap-[8px] w-full">
          <NumberInput
            value={position.imageRect.width}
            onChange={(value) =>
              onCommit(rectField({ width: Math.max(1, value) }))
            }
            onPreview={(value) =>
              onPreview(rectField({ width: Math.max(1, value) }))
            }
            onCancel={onCancel}
            prefix="W"
            ariaLabel={`${t('propertiesPanel.spriteImageSize') || '크기'} W`}
            width="100%"
            min={1}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={position.imageRect.height}
            onChange={(value) =>
              onCommit(rectField({ height: Math.max(1, value) }))
            }
            onPreview={(value) =>
              onPreview(rectField({ height: Math.max(1, value) }))
            }
            onCancel={onCancel}
            prefix="H"
            ariaLabel={`${t('propertiesPanel.spriteImageSize') || '크기'} H`}
            width="100%"
            min={1}
            max={9999}
            allowDecimal
            decimalScale={1}
          />
        </div>
      </div>

      {/* 설정 카드 */}
      <PropertySection>
        <PropertyRow label={t('propertiesPanel.imageFit') || '표시'}>
          <Dropdown
            options={[
              {
                label: t('propertiesPanel.imageFitCover') || '채우기',
                value: 'cover',
              },
              {
                label: t('propertiesPanel.imageFitContain') || '맞춤',
                value: 'contain',
              },
              {
                label: t('propertiesPanel.imageFitFill') || '늘리기',
                value: 'fill',
              },
            ]}
            value={fit}
            onChange={(value) =>
              onCommit({ imageFit: value as SpriteImageFit })
            }
          />
        </PropertyRow>
      </PropertySection>
    </PickerSurface>
  );
};

export default SpriteImageSettingsPopup;
