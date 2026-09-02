import React from 'react';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import {
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import { NumberInput } from '@components/main/common/NumberInput';
import {
  AngleGlyph,
  ScaleGlyph,
} from '@components/main/common/TransformGlyphs';
import {
  SPRITE_CONSTRAINTS,
  type SpriteAnchor,
  type SpriteImageFit,
  type SpriteTransform,
} from '@src/types/key/sprites';
import { SECTION_LABEL_CLASS, SECTION_WRAPPER_CLASS } from '@utils/cardRecipes';
import { clamp } from '@utils/core/clamp';
import { anchorToPercent, percentToAnchor } from '@utils/sprite/spriteGeometry';
import SpriteImagePreviewCard from './SpriteImagePreviewCard';

// 담당 키·이미지 오버라이드 컨트롤 묶음 (삭제·이름 변경은 행 메뉴가 맡는다)
interface SpritePoseControls {
  keyOptions: ReadonlyArray<{ id: string; label: string }>;
  triggers: readonly string[];
  isDuplicate: boolean;
  imageOverride: string | null;
  // 미리보기 표시 방식 - 캔버스 렌더가 스프라이트 imageFit을 따르므로 동일 적용
  imageFit: SpriteImageFit | null;
  onToggleTrigger: (keyId: string) => void;
  onImagePick: () => void;
  onImageReset: () => void;
}

// 손끝 핀 컨트롤 묶음 - 값은 캔버스 노브(Alt 드래그)와 같은 contactPoint
interface SpritePosePinControls {
  contactPoint: SpriteAnchor;
  /** 회전·배율 스크럽이 손끝을 제자리에 두도록 x·y를 역산 */
  pinLock: boolean;
  /** 캔버스 노브 드래그가 scale까지 역산 */
  stretch: boolean;
  onContactPointCommit: (point: SpriteAnchor) => void;
  onContactPointPreview: (point: SpriteAnchor) => void;
  onPinLockToggle: () => void;
  onStretchToggle: () => void;
}

interface SpritePoseEditorPopupProps {
  open: boolean;
  ariaLabel: string;
  // 편집 세션 신원 - 내부 subtree 재마운트와 앵커 재측정의 기준
  poseId: string;
  transform: SpriteTransform;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement: HTMLElement | null;
  poseControls: SpritePoseControls;
  pinControls: SpritePosePinControls;
  // 행 전환 시 바깥닫힘을 거치지 않는 영역 (상태 목록 well)
  interactiveRefs?: React.RefObject<HTMLElement>[];
  onTransformCommit: (next: SpriteTransform) => void;
  onTransformPreview: (next: SpriteTransform) => void;
  onTransformCancel: () => void;
  onClose: () => void;
  t: (key: string) => string;
}

// 상태 하나의 편집 팝업 - 담당 키·변환·상태 이미지를 모아 패널 행을 요약으로 남긴다.
// 카드 규격·변환 그리드는 이미지 피커와 동일.
// 셸(PickerSurface)은 행 전환 동안 유지하고 편집 subtree만 poseId로 재마운트해
// 입력 draft·포커스는 대상별로 끊고 전환 자체는 이어지게 한다
const SpritePoseEditorPopup: React.FC<SpritePoseEditorPopupProps> = ({
  open,
  ariaLabel,
  poseId,
  transform,
  referenceRef,
  panelElement,
  poseControls,
  pinControls,
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
  const previewField = (patch: Partial<SpriteTransform>) =>
    onTransformPreview({ ...transform, ...patch });

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
      // 미리보기 76 + 변환 그리드 50 + 손끝 섹션 127 + 담당 키 23 + 간격·패딩 40
      fallbackHeight={316}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[172px] rounded-popup"
      offsetY={-93}
      interactiveRefs={interactiveRefs}
      anchorKey={poseId}
      onClose={onClose}
    >
      {/* poseId 경계 - 행 전환마다 편집 subtree만 새 세션으로 */}
      <React.Fragment key={poseId}>
        {/* 상태 이미지 - 비우면 캔버스가 기본 이미지를 그대로 쓴다 */}
        <SpriteImagePreviewCard
          source={poseControls.imageOverride}
          imageFit={poseControls.imageFit}
          onPick={poseControls.onImagePick}
          onReset={poseControls.onImageReset}
          t={t}
        />

        {/* 위치·회전·배율 - 라벨 대신 접두 글리프가 의미를 맡는다 */}
        <div className="flex flex-col gap-[4px]">
          <div className="flex items-center gap-[8px] w-full">
            <NumberInput
              value={transform.x}
              onChange={(value) =>
                commitField({ x: clamp(value, offset.min, offset.max) })
              }
              onPreview={(value) =>
                previewField({ x: clamp(value, offset.min, offset.max) })
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
              onPreview={(value) =>
                previewField({ y: clamp(value, offset.min, offset.max) })
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
              onPreview={(value) =>
                previewField({
                  rotation: clamp(value, rotation.min, rotation.max),
                })
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
              onPreview={(value) =>
                previewField({
                  scale: clamp(value / 100, scale.min, scale.max),
                })
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

        {/* 손끝(핀) - 자세 이미지 기준 %. 캔버스 노브·Alt 드래그와 같은 값.
            X·Y 쌍은 라벨을 옆에 둘 폭이 없어 섹션 라벨 + 설정 카드 레시피로 묶고,
            토글 행은 이미지 피커의 설정 카드와 같은 행 문법을 따른다 */}
        <div className={SECTION_WRAPPER_CLASS}>
          <p className={SECTION_LABEL_CLASS}>
            {t('propertiesPanel.spriteContactPoint') || '손끝'}
          </p>
          <PropertySection>
            <div className="flex items-center gap-[8px] w-full min-h-[32px]">
              <NumberInput
                value={anchorToPercent(pinControls.contactPoint.x)}
                onChange={(value) =>
                  pinControls.onContactPointCommit({
                    ...pinControls.contactPoint,
                    x: percentToAnchor(value),
                  })
                }
                onPreview={(value) =>
                  pinControls.onContactPointPreview({
                    ...pinControls.contactPoint,
                    x: percentToAnchor(value),
                  })
                }
                onCancel={onTransformCancel}
                prefix="X"
                suffix="%"
                ariaLabel={`${
                  t('propertiesPanel.spriteContactPoint') || '손끝'
                } X`}
                width="100%"
                min={0}
                max={100}
                allowDecimal
                decimalScale={1}
              />
              <NumberInput
                value={anchorToPercent(pinControls.contactPoint.y)}
                onChange={(value) =>
                  pinControls.onContactPointCommit({
                    ...pinControls.contactPoint,
                    y: percentToAnchor(value),
                  })
                }
                onPreview={(value) =>
                  pinControls.onContactPointPreview({
                    ...pinControls.contactPoint,
                    y: percentToAnchor(value),
                  })
                }
                onCancel={onTransformCancel}
                prefix="Y"
                suffix="%"
                ariaLabel={`${
                  t('propertiesPanel.spriteContactPoint') || '손끝'
                } Y`}
                width="100%"
                min={0}
                max={100}
                allowDecimal
                decimalScale={1}
              />
            </div>
            <PropertyRow
              label={t('propertiesPanel.spritePinLock') || '핀 고정'}
            >
              <Checkbox
                checked={pinControls.pinLock}
                onChange={pinControls.onPinLockToggle}
              />
            </PropertyRow>
            <PropertyRow label={t('propertiesPanel.spriteStretch') || '뻗기'}>
              <Checkbox
                checked={pinControls.stretch}
                onChange={pinControls.onStretchToggle}
              />
            </PropertyRow>
          </PropertySection>
        </div>

        {/* 담당 키 - 미리보기·변환 아래가 정위치, 신규 상태도 카드가 작아 한눈에 보인다 */}
        {poseControls.keyOptions.length === 0 && deadTriggers.length === 0 ? (
          <p className="text-fg-faint text-label">
            {t('propertiesPanel.spriteNoKeys') ||
              '이 모드에 키 요소가 없습니다'}
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
            ariaLabel={t('propertiesPanel.spriteTriggerKeys') || '담당 키'}
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
      </React.Fragment>
    </PickerSurface>
  );
};

export default SpritePoseEditorPopup;
