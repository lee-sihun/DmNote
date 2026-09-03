import React from 'react';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import Dropdown from '@components/main/common/Dropdown';
import Checkbox from '@components/main/common/Checkbox';
import { NumberInput } from '@components/main/common/NumberInput';
import {
  AngleGlyph,
  ScaleGlyph,
} from '@components/main/common/TransformGlyphs';
import {
  SPRITE_CONSTRAINTS,
  type SpriteAnchor,
  type SpriteTransform,
} from '@src/types/key/sprites';
import { clamp } from '@utils/core/clamp';
import SpriteImagePreviewCard from './SpriteImagePreviewCard';

// 담당 키·이미지 오버라이드 컨트롤 묶음 (삭제·이름 변경은 행 메뉴가 맡는다)
interface SpritePoseControls {
  keyOptions: ReadonlyArray<{ id: string; label: string }>;
  triggers: readonly string[];
  isDuplicate: boolean;
  imageOverride: string | null;
  onToggleTrigger: (keyId: string) => void;
  onImagePick: () => void;
  onImageReset: () => void;
}

interface SpritePoseEditorPopupProps {
  open: boolean;
  ariaLabel: string;
  // 편집 세션 신원 - 내부 subtree 재마운트와 앵커 재측정의 기준
  poseId: string;
  transform: SpriteTransform;
  pivot: SpriteAnchor;
  followsBasePivot: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement: HTMLElement | null;
  poseControls: SpritePoseControls;
  // 행 전환 시 바깥닫힘을 거치지 않는 영역 (상태 목록 well)
  interactiveRefs?: React.RefObject<HTMLElement>[];
  onTransformCommit: (patch: Partial<SpriteTransform>) => void;
  onTransformPreview: (next: SpriteTransform) => void;
  onTransformCancel: () => void;
  onPivotCommit: (patch: Partial<SpriteAnchor>) => void;
  onPivotPreview: (next: SpriteAnchor) => void;
  onPivotLinkChange: () => void;
  onClose: () => void;
  t: (key: string) => string;
}

// 상태 하나의 편집 팝업 - 상태 이미지·변환 수치·담당 키. 위치·회전·배율은 캔버스
// 핸들(본체 드래그·회전 노브·모서리)과 같은 값이라 여기서는 수치 입력만 맡는다.
// 셸(PickerSurface)은 행 전환 동안 유지하고 편집 subtree만 poseId로 재마운트해
// 입력 draft·포커스는 대상별로 끊고 전환 자체는 이어지게 한다
const SpritePoseEditorPopup: React.FC<SpritePoseEditorPopupProps> = ({
  open,
  ariaLabel,
  poseId,
  transform,
  pivot,
  followsBasePivot,
  referenceRef,
  panelElement,
  poseControls,
  interactiveRefs,
  onTransformCommit,
  onTransformPreview,
  onTransformCancel,
  onPivotCommit,
  onPivotPreview,
  onPivotLinkChange,
  onClose,
  t,
}) => {
  const { offset, rotation, scale, anchor } = SPRITE_CONSTRAINTS;
  // 커밋은 바뀐 축만 올린다 - 전체를 펼쳐 보내면 저장 큐에 대기 중인 직전 편집을 덮는다
  const commitField = (patch: Partial<SpriteTransform>) =>
    onTransformCommit(patch);
  const previewField = (patch: Partial<SpriteTransform>) =>
    onTransformPreview({ ...transform, ...patch });
  const commitPivotField = (patch: Partial<SpriteAnchor>) =>
    onPivotCommit(patch);
  const previewPivotField = (patch: Partial<SpriteAnchor>) =>
    onPivotPreview({ ...pivot, ...patch });

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
      // 미리보기 76 + 변환 그리드 68 + 담당 키 32 + 간격·패딩 32
      fallbackHeight={followsBasePivot ? 240 : 276}
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

        <div className="flex flex-col gap-[4px]">
          <div className="flex items-center justify-between min-h-[28px]">
            <span className="text-fg-muted text-label">
              {t('propertiesPanel.spriteFollowBasePivot') ||
                '기본 기준점 따라가기'}
            </span>
            <Checkbox
              checked={followsBasePivot}
              onChange={onPivotLinkChange}
              ariaLabel={
                t('propertiesPanel.spriteFollowBasePivot') ||
                '기본 기준점 따라가기'
              }
              commitStrategy="after-paint"
            />
          </div>
          {!followsBasePivot ? (
            <div className="flex items-center gap-[8px] w-full">
              <NumberInput
                value={pivot.x * 100}
                onChange={(value) =>
                  commitPivotField({
                    x: clamp(value / 100, anchor.min, anchor.max),
                  })
                }
                onPreview={(value) =>
                  previewPivotField({
                    x: clamp(value / 100, anchor.min, anchor.max),
                  })
                }
                onCancel={onTransformCancel}
                prefix="X"
                ariaLabel={`${
                  t('propertiesPanel.spriteStatePivot') || '상태 기준점'
                } X`}
                suffix="%"
                width="100%"
                min={anchor.min * 100}
                max={anchor.max * 100}
                allowDecimal
                decimalScale={1}
              />
              <NumberInput
                value={pivot.y * 100}
                onChange={(value) =>
                  commitPivotField({
                    y: clamp(value / 100, anchor.min, anchor.max),
                  })
                }
                onPreview={(value) =>
                  previewPivotField({
                    y: clamp(value / 100, anchor.min, anchor.max),
                  })
                }
                onCancel={onTransformCancel}
                prefix="Y"
                ariaLabel={`${
                  t('propertiesPanel.spriteStatePivot') || '상태 기준점'
                } Y`}
                suffix="%"
                width="100%"
                min={anchor.min * 100}
                max={anchor.max * 100}
                allowDecimal
                decimalScale={1}
              />
            </div>
          ) : null}
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
