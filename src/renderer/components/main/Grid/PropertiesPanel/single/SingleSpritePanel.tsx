import React, { useEffect, useRef, useState } from 'react';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { spriteItemsApi } from '@api/modules/itemsApi';
import { imageApi } from '@api/modules/resourceApi';
import { canDecodeImage } from '@utils/core/assetProbe';
import { slotDisplayName } from '@utils/keySlot';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import {
  DEFAULT_SPRITE_TRANSITION_EASING,
  SPRITE_CONSTRAINTS,
  findDuplicateTriggerPose,
  type ReactiveSpritePosition,
  type SpriteImageFit,
  type SpritePose,
  type SpriteTransform,
} from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  CloseIcon,
  TABS,
  TabType,
} from '../index';
import Dropdown from '@components/main/common/Dropdown';
import EditSessionBoundary from '../EditSessionBoundary';

// 공용 버튼 크롬 (knob 패널의 설정 버튼과 동일)
const ACTION_BUTTON_CLASS =
  'px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center text-fg text-body';

// 24 그리드를 12px로 렌더 - 스트로크 2.4가 화면상 1.2
const RenameIcon: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 20H21"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16.5 3.5C17.3284 2.67157 18.6716 2.67157 19.5 3.5V3.5C20.3284 4.32843 20.3284 5.67157 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// 계약과 동일한 cubic-bezier 문자열만 저장 (transitionEasing은 문자열 그대로 CSS로 간다)
const SPRITE_EASING_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Default', value: DEFAULT_SPRITE_TRANSITION_EASING },
  { label: 'Linear', value: 'cubic-bezier(0, 0, 1, 1)' },
  { label: 'Ease Out', value: 'cubic-bezier(0, 0, 0.58, 1)' },
  { label: 'Ease In', value: 'cubic-bezier(0.42, 0, 1, 1)' },
  { label: 'Ease In-Out', value: 'cubic-bezier(0.42, 0, 0.58, 1)' },
  { label: 'Overshoot', value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
];

interface SpriteTransformFieldsProps {
  transform: SpriteTransform;
  onCommit: (next: SpriteTransform) => void;
  onPreview?: (next: SpriteTransform) => void;
  t: (key: string) => string;
}

// 대기 자세와 각 자세 행이 공유하는 변환 4필드
const SpriteTransformFields: React.FC<SpriteTransformFieldsProps> = ({
  transform,
  onCommit,
  onPreview,
  t,
}) => {
  const { offset, rotation, scale } = SPRITE_CONSTRAINTS;
  const commitField = (patch: Partial<SpriteTransform>) =>
    onCommit({ ...transform, ...patch });
  const previewField = onPreview
    ? (patch: Partial<SpriteTransform>) => onPreview({ ...transform, ...patch })
    : undefined;
  return (
    <>
      <PropertyRow label={t('propertiesPanel.position') || '위치'}>
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
          onCancel={() => editGestureController.cancel()}
          prefix="X"
          width={AXIS_FIELD_WIDTH}
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
          onCancel={() => editGestureController.cancel()}
          prefix="Y"
          width={AXIS_FIELD_WIDTH}
          min={offset.min}
          max={offset.max}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>
      <PropertyRow label={t('propertiesPanel.spriteRotation') || '회전'}>
        <NumberInput
          value={transform.rotation}
          onChange={(value) =>
            commitField({ rotation: clamp(value, rotation.min, rotation.max) })
          }
          onPreview={
            previewField
              ? (value) =>
                  previewField({
                    rotation: clamp(value, rotation.min, rotation.max),
                  })
              : undefined
          }
          onCancel={() => editGestureController.cancel()}
          suffix="°"
          width={AXIS_FIELD_WIDTH}
          min={rotation.min}
          max={rotation.max}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>
      <PropertyRow label={t('propertiesPanel.spriteScale') || '배율'}>
        <NumberInput
          value={transform.scale}
          onChange={(value) =>
            commitField({ scale: clamp(value, scale.min, scale.max) })
          }
          onPreview={
            previewField
              ? (value) =>
                  previewField({ scale: clamp(value, scale.min, scale.max) })
              : undefined
          }
          onCancel={() => editGestureController.cancel()}
          suffix="×"
          width={AXIS_FIELD_WIDTH}
          min={scale.min}
          max={scale.max}
          allowDecimal
          decimalScale={2}
          step={0.1}
        />
      </PropertyRow>
    </>
  );
};

interface SingleSpritePanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  singleSpritePosition: CanonicalReactiveSpritePosition;
  selectedKeyType: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  t: (key: string) => string;
}

export const SingleSpritePanel: React.FC<SingleSpritePanelProps> = ({
  setPanelElement,
  singleSpritePosition,
  selectedKeyType,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  singleScrollRefFor,
  t,
}) => {
  const position = singleSpritePosition;
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const canonicalKeyPositions = useKeyStore(
    (state) => state.canonicalPositions,
  );
  const loadingImageRef = useRef(false);

  // 무효 자세(빈/중복 트리거)는 백엔드가 거부하므로 커밋 착지 전까지 패널이 값을 들고 있는다
  const [posesDraft, setPosesDraft] = useState<{
    id: string;
    poses: SpritePose[];
  } | null>(null);

  // draft는 커밋이 canonical에 착지하거나 대상이 바뀔 때 지운다
  useEffect(() => {
    setPosesDraft((current) => {
      if (!current) return current;
      if (current.id !== position.id) return null;
      const canonical = useSpriteStore
        .getState()
        .positions[selectedKeyType]?.find(
          (sprite) => sprite.id === position.id,
        );
      if (!canonical) return current;
      return JSON.stringify(canonical.poses) === JSON.stringify(current.poses)
        ? null
        : current;
    });
  }, [position.id, position.poses, selectedKeyType]);

  // 담당 키 후보: 현재 모드의 키 요소 목록 (값은 요소 id, 라벨은 슬롯 표시명)
  const modeSlots = keyMappings[selectedKeyType] ?? [];
  const keyOptions = (canonicalKeyPositions[selectedKeyType] ?? []).flatMap(
    (keyPosition, index) => {
      if (!keyPosition.id) return [];
      const label =
        slotDisplayName(modeSlots[index] ?? '') || `Key ${index + 1}`;
      return [{ id: keyPosition.id, label }];
    },
  );
  const keyOptionIds = new Set(keyOptions.map((option) => option.id));

  const displayPoses =
    posesDraft && posesDraft.id === position.id
      ? posesDraft.poses
      : position.poses;
  const duplicatePose = findDuplicateTriggerPose(displayPoses);
  const hasEmptyTriggerPose = displayPoses.some(
    (pose) => pose.triggers.length === 0,
  );
  const posesCommittable = duplicatePose === null && !hasEmptyTriggerPose;

  // 전체 필드 패치 커밋: 다음 spritePositions 레코드를 구성해 editor_commit으로.
  // 활성 preview 게스처가 있으면 gestureId를 실어 정산한다
  const commitFields = (patch: Partial<ReactiveSpritePosition>) => {
    const canonical = useSpriteStore.getState().positions;
    const modePositions = canonical[selectedKeyType] ?? [];
    const index = modePositions.findIndex(
      (sprite) => sprite.id === position.id,
    );
    if (index < 0) return;
    const nextMode = [...modePositions];
    nextMode[index] = { ...nextMode[index], ...patch };
    const next = { ...canonical, [selectedKeyType]: nextMode };
    const gestureId = editGestureController.activeGestureId() ?? undefined;
    const persisted = spriteItemsApi.updatePositions(next, gestureId);
    editGestureController.settleCommit(persisted);
    void persisted.catch((error) => {
      console.error('Failed to update sprite', error);
    });
  };

  // 스크럽·타이핑 실시간 프리뷰 (spritePosition 도메인)
  const previewFields = (patch: Record<string, unknown>) => {
    if (!isNativeElementId(position.id)) return;
    const locator = resolveElementById('sprite', position.id);
    if (!locator) return;
    editGestureController.preview(locator.mode, [{ id: position.id, patch }], {
      domain: 'spritePosition',
    });
  };

  const updatePoses = (nextPoses: SpritePose[]) => {
    setPosesDraft({ id: position.id, poses: nextPoses });
    const blocked =
      nextPoses.some((pose) => pose.triggers.length === 0) ||
      findDuplicateTriggerPose(nextPoses) !== null;
    if (blocked) {
      // 열린 preview 게스처에 무효 poses가 실려 커밋 경계로 승격되지 않게 닫는다
      editGestureController.cancel();
      return;
    }
    commitFields({ poses: nextPoses });
  };

  const replacePose = (poseIndex: number, patch: Partial<SpritePose>) =>
    updatePoses(
      displayPoses.map((pose, index) =>
        index === poseIndex ? { ...pose, ...patch } : pose,
      ),
    );

  const togglePoseTrigger = (poseIndex: number, keyId: string) => {
    const pose = displayPoses[poseIndex];
    if (!pose) return;
    const nextTriggers = pose.triggers.includes(keyId)
      ? pose.triggers.filter((id) => id !== keyId)
      : [...pose.triggers, keyId];
    replacePose(poseIndex, { triggers: nextTriggers });
  };

  const addPose = () => {
    if (displayPoses.length >= SPRITE_CONSTRAINTS.maxPoses) return;
    const pose: SpritePose = {
      poseId: crypto.randomUUID(),
      triggers: [],
      matchMode: 'exact',
      transform: { ...position.idleTransform },
      imageOverride: null,
    };
    updatePoses([...displayPoses, pose]);
  };

  const removePose = (poseIndex: number) =>
    updatePoses(displayPoses.filter((_, index) => index !== poseIndex));

  const showInvalidImageAlert = (): void => {
    void window.api.ui.dialog
      .alert(t('imagePicker.invalidImage'), {
        confirmText: t('common.ok') || '확인',
      })
      .catch((error) => {
        console.error('Failed to open invalid image alert:', error);
      });
  };

  // 키 패널과 동일한 이미지 선택 흐름 (image_load + 디코드 확인)
  const pickImage = async (): Promise<string | null> => {
    if (loadingImageRef.current) return null;
    loadingImageRef.current = true;
    try {
      const result = await imageApi.load();
      if (!result?.success || !result.imagePath) {
        // errorCode가 없는 실패는 사용자 취소
        if (result?.errorCode) showInvalidImageAlert();
        return null;
      }
      // 시그니처를 통과해도 WebView가 못 그리는 파일이 있다. 직전 값을 덮기 전에 확인한다
      if (!(await canDecodeImage(result.imagePath))) {
        showInvalidImageAlert();
        return null;
      }
      return result.imagePath;
    } catch (error) {
      console.error('Failed to load image', error);
      return null;
    } finally {
      loadingImageRef.current = false;
    }
  };

  const handleBaseImageSelect = async () => {
    const path = await pickImage();
    if (path) commitFields({ baseImage: path });
  };

  const handlePoseImageSelect = async (poseIndex: number) => {
    const path = await pickImage();
    if (path) replacePose(poseIndex, { imageOverride: path });
  };

  const spriteTitle = position.layerName || 'Sprite';
  const { anchor, transitionMs } = SPRITE_CONSTRAINTS;
  const easingValue =
    position.transitionEasing || DEFAULT_SPRITE_TRANSITION_EASING;
  const easingOptions = SPRITE_EASING_PRESETS.some(
    (preset) => preset.value === easingValue,
  )
    ? [...SPRITE_EASING_PRESETS]
    : [
        {
          label: t('propertiesPanel.spriteEasingCustom') || '사용자 정의',
          value: easingValue,
        },
        ...SPRITE_EASING_PRESETS,
      ];

  const pivotPercent = (value: number) => Math.round(value * 1000) / 10;

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className={PANEL_HEADER_CLASS}>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="text-fg text-label leading-none bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => {
              if (!renameCancelledRef.current) {
                handleRenameCommit(renameValue);
              }
              renameCancelledRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                handleRenameCancel();
              }
            }}
          />
        ) : (
          <div className="flex items-center gap-[4px] min-w-0">
            <span
              className="text-fg text-label truncate max-w-[100px] cursor-default"
              onDoubleClick={handleRenameStart}
              title={spriteTitle}
            >
              {spriteTitle}
            </span>
            <button
              onClick={handleRenameStart}
              className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0"
              title={t('contextMenu.rename') || 'Rename'}
            >
              <RenameIcon />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            {/* 이미지 */}
            <PropertySection>
              <PropertyRow
                label={t('propertiesPanel.spriteBaseImage') || '기본 이미지'}
              >
                <button
                  type="button"
                  className={ACTION_BUTTON_CLASS}
                  onClick={() => void handleBaseImageSelect()}
                >
                  {t('propertiesPanel.spriteImageSelect') || '선택'}
                </button>
                {position.baseImage ? (
                  <button
                    type="button"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => commitFields({ baseImage: null })}
                  >
                    {t('propertiesPanel.spriteImageRemove') || '제거'}
                  </button>
                ) : null}
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
                  value={position.imageFit ?? 'contain'}
                  onChange={(value) =>
                    commitFields({ imageFit: value as SpriteImageFit })
                  }
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.spriteImageRect') || '이미지 위치'}
              >
                <NumberInput
                  value={position.imageRect.x}
                  onChange={(value) =>
                    commitFields({
                      imageRect: { ...position.imageRect, x: value },
                    })
                  }
                  onPreview={(value) =>
                    previewFields({
                      imageRect: { ...position.imageRect, x: value },
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="X"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                  allowDecimal
                  decimalScale={1}
                />
                <NumberInput
                  value={position.imageRect.y}
                  onChange={(value) =>
                    commitFields({
                      imageRect: { ...position.imageRect, y: value },
                    })
                  }
                  onPreview={(value) =>
                    previewFields({
                      imageRect: { ...position.imageRect, y: value },
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="Y"
                  width={AXIS_FIELD_WIDTH}
                  min={-9999}
                  max={9999}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.spriteImageSize') || '이미지 크기'}
              >
                <NumberInput
                  value={position.imageRect.width}
                  onChange={(value) =>
                    commitFields({
                      imageRect: {
                        ...position.imageRect,
                        width: Math.max(1, value),
                      },
                    })
                  }
                  onPreview={(value) =>
                    previewFields({
                      imageRect: {
                        ...position.imageRect,
                        width: Math.max(1, value),
                      },
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="W"
                  width={AXIS_FIELD_WIDTH}
                  min={1}
                  max={9999}
                  allowDecimal
                  decimalScale={1}
                />
                <NumberInput
                  value={position.imageRect.height}
                  onChange={(value) =>
                    commitFields({
                      imageRect: {
                        ...position.imageRect,
                        height: Math.max(1, value),
                      },
                    })
                  }
                  onPreview={(value) =>
                    previewFields({
                      imageRect: {
                        ...position.imageRect,
                        height: Math.max(1, value),
                      },
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="H"
                  width={AXIS_FIELD_WIDTH}
                  min={1}
                  max={9999}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>

              {/* 정규화 좌표를 %로 표시 */}
              <PropertyRow label={t('propertiesPanel.spritePivot') || '기준점'}>
                <NumberInput
                  value={pivotPercent(position.pivot.x)}
                  onChange={(value) =>
                    commitFields({
                      pivot: {
                        ...position.pivot,
                        x: clamp(value, 0, 100) / 100,
                      },
                    })
                  }
                  onPreview={(value) =>
                    previewFields({
                      pivot: {
                        ...position.pivot,
                        x: clamp(value, 0, 100) / 100,
                      },
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="X"
                  suffix="%"
                  width={AXIS_FIELD_WIDTH}
                  min={anchor.min * 100}
                  max={anchor.max * 100}
                  allowDecimal
                  decimalScale={1}
                />
                <NumberInput
                  value={pivotPercent(position.pivot.y)}
                  onChange={(value) =>
                    commitFields({
                      pivot: {
                        ...position.pivot,
                        y: clamp(value, 0, 100) / 100,
                      },
                    })
                  }
                  onPreview={(value) =>
                    previewFields({
                      pivot: {
                        ...position.pivot,
                        y: clamp(value, 0, 100) / 100,
                      },
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="Y"
                  suffix="%"
                  width={AXIS_FIELD_WIDTH}
                  min={anchor.min * 100}
                  max={anchor.max * 100}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>
            </PropertySection>

            {/* 대기 자세 */}
            <PropertySection>
              <div className="flex items-center w-full min-h-[28px]">
                <p className="text-fg-muted text-label">
                  {t('propertiesPanel.spriteIdlePose') || '대기 자세'}
                </p>
              </div>
              <SpriteTransformFields
                transform={position.idleTransform}
                onCommit={(next) => commitFields({ idleTransform: next })}
                onPreview={(next) => previewFields({ idleTransform: next })}
                t={t}
              />
            </PropertySection>

            {/* 자세 목록: 자세마다 담당 키 + 변환 + 이미지 교체 */}
            {displayPoses.map((pose, poseIndex) => {
              const isDuplicate = duplicatePose?.poseId === pose.poseId;
              const isEmpty = pose.triggers.length === 0;
              const deadTriggers = pose.triggers.filter(
                (id) => !keyOptionIds.has(id),
              );
              return (
                <PropertySection key={pose.poseId}>
                  <div className="flex justify-between items-center w-full min-h-[28px]">
                    <p className="text-fg-muted text-label">
                      {`${t('propertiesPanel.spritePose') || '자세'} ${
                        poseIndex + 1
                      }`}
                    </p>
                    <button
                      type="button"
                      title={
                        t('propertiesPanel.spriteRemovePose') || '자세 삭제'
                      }
                      onClick={() => removePose(poseIndex)}
                      className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0"
                    >
                      <CloseIcon />
                    </button>
                  </div>

                  <div className="flex flex-col gap-[6px] w-full pb-[6px]">
                    <p className="text-fg-faint text-label">
                      {t('propertiesPanel.spriteTriggerKeys') || '담당 키'}
                    </p>
                    {keyOptions.length === 0 && deadTriggers.length === 0 ? (
                      <p className="text-fg-faint text-label">
                        {t('propertiesPanel.spriteNoKeys') ||
                          '이 모드에 키 요소가 없습니다'}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-[4px] w-full">
                        {keyOptions.map((option) => {
                          const selected = pose.triggers.includes(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              title={option.label}
                              onClick={() =>
                                togglePoseTrigger(poseIndex, option.id)
                              }
                              className={`px-[8px] h-[23px] rounded-md text-body transition-colors duration-fast ${
                                selected
                                  ? 'bg-fill-active text-fg shadow-focus-ring'
                                  : 'bg-fill hover:bg-fill-hover text-fg-muted'
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                        {/* 죽은 참조는 표시하고 클릭으로 제거 */}
                        {deadTriggers.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => togglePoseTrigger(poseIndex, id)}
                            className="px-[8px] h-[23px] rounded-md text-body bg-danger-muted hover:bg-danger-muted-hover active:bg-danger-muted-active text-danger-fg transition-colors duration-fast"
                          >
                            {t('propertiesPanel.spriteMissingKey') ||
                              '삭제된 키'}
                          </button>
                        ))}
                      </div>
                    )}
                    {isEmpty || isDuplicate ? (
                      <p className="text-danger-fg text-label">
                        {isEmpty
                          ? t('propertiesPanel.spriteEmptyTriggers') ||
                            '담당 키를 선택하면 저장됩니다'
                          : t('propertiesPanel.spriteDuplicateTriggers') ||
                            '같은 키 조합의 자세가 있어 저장되지 않습니다'}
                      </p>
                    ) : null}
                  </div>

                  <SpriteTransformFields
                    transform={pose.transform}
                    onCommit={(next) =>
                      replacePose(poseIndex, { transform: next })
                    }
                    onPreview={
                      posesCommittable
                        ? (next) =>
                            previewFields({
                              poses: displayPoses.map((entry, index) =>
                                index === poseIndex
                                  ? { ...entry, transform: next }
                                  : entry,
                              ),
                            })
                        : undefined
                    }
                    t={t}
                  />

                  <PropertyRow
                    label={
                      t('propertiesPanel.spriteImageOverride') || '자세 이미지'
                    }
                  >
                    <button
                      type="button"
                      className={ACTION_BUTTON_CLASS}
                      onClick={() => void handlePoseImageSelect(poseIndex)}
                    >
                      {t('propertiesPanel.spriteImageSelect') || '선택'}
                    </button>
                    {pose.imageOverride ? (
                      <button
                        type="button"
                        className={ACTION_BUTTON_CLASS}
                        onClick={() =>
                          replacePose(poseIndex, { imageOverride: null })
                        }
                      >
                        {t('propertiesPanel.spriteImageRemove') || '제거'}
                      </button>
                    ) : null}
                  </PropertyRow>
                </PropertySection>
              );
            })}

            <button
              type="button"
              onClick={addPose}
              disabled={displayPoses.length >= SPRITE_CONSTRAINTS.maxPoses}
              className="w-full h-[28px] bg-fill hover:bg-fill-hover active:bg-fill-active disabled:opacity-50 disabled:pointer-events-none transition-colors duration-fast rounded-md flex items-center justify-center text-fg text-body"
            >
              {t('propertiesPanel.spriteAddPose') || '자세 추가'}
            </button>

            {/* 전환 */}
            <PropertySection>
              <PropertyRow
                label={t('propertiesPanel.spriteTransition') || '전환 시간'}
              >
                <NumberInput
                  value={position.transitionMs}
                  onChange={(value) =>
                    commitFields({
                      transitionMs: clamp(
                        value,
                        transitionMs.min,
                        transitionMs.max,
                      ),
                    })
                  }
                  onPreview={(value) =>
                    previewFields({
                      transitionMs: clamp(
                        value,
                        transitionMs.min,
                        transitionMs.max,
                      ),
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  suffix="ms"
                  min={transitionMs.min}
                  max={transitionMs.max}
                />
              </PropertyRow>

              <PropertyRow
                label={t('propertiesPanel.spriteEasing') || '가속 곡선'}
              >
                <Dropdown
                  options={easingOptions}
                  value={easingValue}
                  onChange={(value) =>
                    commitFields({ transitionEasing: value })
                  }
                  align="right"
                  widthClass="w-[110px]"
                />
              </PropertyRow>
            </PropertySection>
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};

export default SingleSpritePanel;
