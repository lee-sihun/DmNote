import React from 'react';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import Dropdown from '@components/main/common/Dropdown';
import { NumberInput } from '@components/main/common/NumberInput';
import {
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import {
  DEFAULT_SPRITE_IMAGE_FIT,
  type ReactiveSpritePosition,
  type SpriteImageFit,
  type SpriteImagePlacement,
} from '@src/types/key/sprites';
import { clamp } from '@utils/core/clamp';
import SpriteImagePreviewCard from './SpriteImagePreviewCard';

// 이미지 상자 입력의 편집 한계. 저장 계약(SPRITE_CONSTRAINTS.imageRect,
// 좌표 ±32768 / 치수 하한 0.000001)보다 좁다 - 손으로 칠 수 있는 범위만 열고
// 그 밖의 값은 리사이즈 배율과 플러그인 patch가 만든다. 좁히기만 하므로
// 기존 값은 표시·보존되고 이 필드를 직접 건드릴 때만 범위로 접힌다
const IMAGE_RECT_EDIT_LIMITS = {
  coordMin: -9999,
  coordMax: 9999,
  dimensionMin: 1,
  dimensionMax: 9999,
} as const;

interface SpriteImageSettingsPopupProps {
  open: boolean;
  position: Pick<
    ReactiveSpritePosition,
    'baseImage' | 'imageFit' | 'imageRect' | 'imagePlacement'
  >;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement: HTMLElement | null;
  onCommit: (patch: Partial<ReactiveSpritePosition>) => void;
  onPreview: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  /** 파일 선택·디코드 검증·대상 재확인은 패널이 소유한다 */
  onImagePick: () => void;
  onImageReset: () => void;
  /** 배치 방식 전환 - 축 배치는 패널이 이미지 크기를 읽어 한 커밋으로 채운다 */
  onPlacementChange: (next: SpriteImagePlacement) => void;
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
  onPlacementChange,
  onClose,
  t,
}) => {
  const fit = position.imageFit ?? DEFAULT_SPRITE_IMAGE_FIT;

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
      <SpriteImagePreviewCard
        source={position.baseImage}
        // 축 배치는 캔버스가 비트맵을 그대로 그리므로 썸네일도 맞춤으로
        imageFit={position.imagePlacement === 'pivot' ? 'contain' : fit}
        onPick={onImagePick}
        onReset={onImageReset}
        t={t}
      />

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
            min={IMAGE_RECT_EDIT_LIMITS.coordMin}
            max={IMAGE_RECT_EDIT_LIMITS.coordMax}
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
            min={IMAGE_RECT_EDIT_LIMITS.coordMin}
            max={IMAGE_RECT_EDIT_LIMITS.coordMax}
            allowDecimal
            decimalScale={1}
          />
        </div>
        <div className="flex items-center gap-[8px] w-full">
          <NumberInput
            value={position.imageRect.width}
            onChange={(value) =>
              onCommit(
                rectField({
                  width: clamp(
                    value,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMin,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMax,
                  ),
                }),
              )
            }
            onPreview={(value) =>
              onPreview(
                rectField({
                  width: clamp(
                    value,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMin,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMax,
                  ),
                }),
              )
            }
            onCancel={onCancel}
            prefix="W"
            ariaLabel={`${t('propertiesPanel.spriteImageSize') || '크기'} W`}
            width="100%"
            min={IMAGE_RECT_EDIT_LIMITS.dimensionMin}
            max={IMAGE_RECT_EDIT_LIMITS.dimensionMax}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={position.imageRect.height}
            onChange={(value) =>
              onCommit(
                rectField({
                  height: clamp(
                    value,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMin,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMax,
                  ),
                }),
              )
            }
            onPreview={(value) =>
              onPreview(
                rectField({
                  height: clamp(
                    value,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMin,
                    IMAGE_RECT_EDIT_LIMITS.dimensionMax,
                  ),
                }),
              )
            }
            onCancel={onCancel}
            prefix="H"
            ariaLabel={`${t('propertiesPanel.spriteImageSize') || '크기'} H`}
            width="100%"
            min={IMAGE_RECT_EDIT_LIMITS.dimensionMin}
            max={IMAGE_RECT_EDIT_LIMITS.dimensionMax}
            allowDecimal
            decimalScale={1}
          />
        </div>
      </div>

      {/* 설정 카드 */}
      <PropertySection>
        {/* 배치 - 상자 맞춤은 모든 이미지를 상자에 끼우고, 축 기준은 이미지마다
            자기 축을 기준점에 맞춰 크기·비율이 달라도 축이 유지된다 */}
        <PropertyRow
          label={t('propertiesPanel.spriteImagePlacement') || '배치'}
        >
          <Dropdown
            options={[
              {
                label: t('propertiesPanel.spritePlacementPivot') || '축 기준',
                value: 'pivot',
              },
              {
                label: t('propertiesPanel.spritePlacementBox') || '상자 맞춤',
                value: 'box',
              },
            ]}
            value={position.imagePlacement}
            onChange={(value) =>
              onPlacementChange(value as SpriteImagePlacement)
            }
          />
        </PropertyRow>
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
