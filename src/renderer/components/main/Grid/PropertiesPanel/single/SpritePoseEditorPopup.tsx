import React from 'react';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import Dropdown from '@components/main/common/Dropdown';
import { NumberInput } from '@components/main/common/NumberInput';
import {
  AngleGlyph,
  ScaleGlyph,
} from '@components/main/common/TransformGlyphs';
import {
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import { ACTION_BUTTON_CLASS } from '@utils/cardRecipes';
import {
  SPRITE_CONSTRAINTS,
  type SpriteTransform,
} from '@src/types/key/sprites';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// 담당 키·이미지 오버라이드 컨트롤 묶음 (삭제·이름 변경은 행 메뉴가 맡는다)
export interface SpritePoseControls {
  keyOptions: ReadonlyArray<{ id: string; label: string }>;
  triggers: readonly string[];
  isDuplicate: boolean;
  hasImageOverride: boolean;
  onToggleTrigger: (keyId: string) => void;
  onImagePick: () => void;
  onImageReset: () => void;
}

interface SpritePoseEditorPopupProps {
  open: boolean;
  ariaLabel: string;
  transform: SpriteTransform;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement: HTMLElement | null;
  poseControls: SpritePoseControls;
  // 행 전환 시 바깥닫힘을 거치지 않는 영역 (상태 목록 well)
  interactiveRefs?: React.RefObject<HTMLElement>[];
  onTransformCommit: (next: SpriteTransform) => void;
  onTransformPreview?: (next: SpriteTransform) => void;
  onTransformCancel: () => void;
  onClose: () => void;
  t: (key: string) => string;
}

// 상태 하나의 편집 팝업 - 담당 키·변환·상태 이미지를 모아 패널 행을 요약으로 남긴다.
// 카드 규격·변환 그리드는 이미지 피커와 동일
const SpritePoseEditorPopup: React.FC<SpritePoseEditorPopupProps> = ({
  open,
  ariaLabel,
  transform,
  referenceRef,
  panelElement,
  poseControls,
  interactiveRefs,
  onTransformCommit,
  onTransformPreview,
  onTransformCancel,
  onClose,
  t,
}) => {
  const { offset, rotation, scale } = SPRITE_CONSTRAINTS;
  const commitField = (patch: Partial<SpriteTransform>) =>
    onTransformCommit({ ...transform, ...patch });
  const previewField = onTransformPreview
    ? (patch: Partial<SpriteTransform>) =>
        onTransformPreview({ ...transform, ...patch })
    : undefined;

  const keyOptionIds = new Set(
    poseControls.keyOptions.map((option) => option.id),
  );
  const deadTriggers = poseControls.triggers.filter(
    (id) => !keyOptionIds.has(id),
  );

  return (
    <PickerSurface
      open={open}
      ariaLabel={ariaLabel}
      referenceRef={referenceRef}
      panelElement={panelElement}
      fallbackWidth={172}
      fallbackHeight={220}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[172px] rounded-popup"
      offsetY={-93}
      interactiveRefs={interactiveRefs}
      onClose={onClose}
    >
      {poseControls.keyOptions.length === 0 && deadTriggers.length === 0 ? (
        <p className="text-fg-faint text-label">
          {t('propertiesPanel.spriteNoKeys') || '이 모드에 키 요소가 없습니다'}
        </p>
      ) : (
        <Dropdown
          options={[
            ...poseControls.keyOptions.map((option) => ({
              label: option.label,
              value: option.id,
            })),
            // 죽은 참조도 항목으로 노출해 토글로 제거
            ...deadTriggers.map((id) => ({
              label: t('propertiesPanel.spriteMissingKey') || '삭제된 키',
              value: id,
              danger: true,
            })),
          ]}
          multiple
          values={[...poseControls.triggers]}
          onChange={poseControls.onToggleTrigger}
          placeholder={
            t('propertiesPanel.spriteTriggerPlaceholder') || '키 선택'
          }
          fullWidth
          // 중복 조합은 배너 대신 트리거 자체가 짧은 라벨 + 위험 톤 + 사유 툴팁
          danger={poseControls.isDuplicate}
          dangerLabel={t('propertiesPanel.spriteDuplicateShort') || '중복 키'}
          title={
            poseControls.isDuplicate
              ? t('propertiesPanel.spriteDuplicateTriggers') ||
                '중복된 키 조합입니다'
              : undefined
          }
        />
      )}

      {/* 위치·회전·배율 - 라벨 대신 접두 글리프가 의미를 맡는다 */}
      <div className="flex flex-col gap-[4px]">
        <div className="flex items-center gap-[8px] w-full">
          <NumberInput
            value={transform.x}
            onChange={(value) =>
              commitField({ x: clamp(value, offset.min, offset.max) })
            }
            onPreview={
              previewField
                ? (value) =>
                    previewField({ x: clamp(value, offset.min, offset.max) })
                : undefined
            }
            onCancel={onTransformCancel}
            prefix="X"
            ariaLabel={`${t('propertiesPanel.position') || '위치'} X`}
            width="100%"
            min={offset.min}
            max={offset.max}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={transform.y}
            onChange={(value) =>
              commitField({ y: clamp(value, offset.min, offset.max) })
            }
            onPreview={
              previewField
                ? (value) =>
                    previewField({ y: clamp(value, offset.min, offset.max) })
                : undefined
            }
            onCancel={onTransformCancel}
            prefix="Y"
            ariaLabel={`${t('propertiesPanel.position') || '위치'} Y`}
            width="100%"
            min={offset.min}
            max={offset.max}
            allowDecimal
            decimalScale={1}
          />
        </div>
        <div className="flex items-center gap-[8px] w-full">
          <NumberInput
            value={transform.rotation}
            onChange={(value) =>
              commitField({
                rotation: clamp(value, rotation.min, rotation.max),
              })
            }
            onPreview={
              previewField
                ? (value) =>
                    previewField({
                      rotation: clamp(value, rotation.min, rotation.max),
                    })
                : undefined
            }
            onCancel={onTransformCancel}
            prefix={<AngleGlyph />}
            ariaLabel={t('propertiesPanel.spriteRotation') || '회전'}
            suffix="°"
            width="100%"
            min={rotation.min}
            max={rotation.max}
            allowDecimal
            decimalScale={1}
          />
          {/* 배율은 이미지 피커와 같은 정수 % 표기 - 저장은 배수 그대로 */}
          <NumberInput
            value={Math.round(transform.scale * 100)}
            onChange={(value) =>
              commitField({ scale: clamp(value / 100, scale.min, scale.max) })
            }
            onPreview={
              previewField
                ? (value) =>
                    previewField({
                      scale: clamp(value / 100, scale.min, scale.max),
                    })
                : undefined
            }
            onCancel={onTransformCancel}
            prefix={<ScaleGlyph />}
            ariaLabel={t('propertiesPanel.spriteScale') || '배율'}
            suffix="%"
            width="100%"
            min={scale.min * 100}
            max={scale.max * 100}
          />
        </div>
      </div>

      {/* 상태 이미지 - 안 고르면 기본 이미지가 그대로 쓰인다 */}
      <PropertySection>
        <PropertyRow
          label={t('propertiesPanel.spriteImageOverride') || '상태 이미지'}
        >
          <button
            type="button"
            className={ACTION_BUTTON_CLASS}
            onClick={poseControls.onImagePick}
          >
            {t('propertiesPanel.spriteImageSelect') || '선택'}
          </button>
          {poseControls.hasImageOverride ? (
            <button
              type="button"
              className={ACTION_BUTTON_CLASS}
              onClick={poseControls.onImageReset}
            >
              {t('propertiesPanel.spriteImageRemove') || '제거'}
            </button>
          ) : null}
        </PropertyRow>
      </PropertySection>
    </PickerSurface>
  );
};

export default SpritePoseEditorPopup;
