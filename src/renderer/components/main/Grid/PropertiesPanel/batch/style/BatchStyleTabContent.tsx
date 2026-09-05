import React, { useState, useEffect, useMemo } from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import { paintDescriptor, resolveStatePair } from '@src/types/color';
import { parseAlphaPercent, toRgbHexColor } from '@utils/color/colorUtils';
import {
  PropertyRow,
  NumberInput,
  ColorInput,
  TextInput,
  PropertySection,
} from '../../controls/PropertyInputs';
import Checkbox from '@components/main/common/checkbox/Checkbox';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_ACTIVE_BORDER,
  DEFAULT_ELEMENT_BORDER_WIDTH,
  DEFAULT_ELEMENT_RADIUS,
} from '@utils/element/elementDefaults';
import {
  elementImageReplacesSurface,
  resolveElementBorder,
} from '@utils/element/elementBorder';
import {
  EMPTY_BATCH_ELEMENT_BINDING,
  type BatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import BatchGeometrySection from '../geometry/BatchGeometrySection';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import type {
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
  EditorShadowPropertyPatchV1,
} from '@src/types/editor';
import type { BatchElementPropertyUpdate } from '../../types';
import BatchSoundSection from './BatchSoundSection';
import BatchShadowSection from './BatchShadowSection';
import BatchTypographySection, {
  type BatchTypographyKeyData,
} from './BatchTypographySection';

export { BATCH_STYLE_SOUND_PAGE_KEY } from './BatchSoundSection';

interface BatchStyleTabContentProps {
  // 다중 선택 정보
  selectedCount: number;
  // native+plugin 합산 개수 - 분배 게이트 판정용 (미전달 시 selectedCount)
  totalCount?: number;
  // 사운드 완료의 시작 시점 결합. 소유자는 EditSessionBoundary 밖 부모다 -
  // 이 컴포넌트는 선택 변경 시 리마운트되어 open 중 재캡처가 일어난다
  soundBinding?: BatchElementBinding;
  onSoundPathCommit?: (soundPath: string) => void;
  onSoundEnabledCommit?: (soundEnabled: boolean) => void;
  onSoundVolumeCommit?: (soundVolume: number) => void;
  onStylePropertyPreview?: (patch: EditorStylePropertyPreviewPatchV1) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onPaintPreview?: (patch: EditorPaintPropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  onFontColorPreview?: (patch: EditorPaintPropertyPatchV1) => void;
  onFontColorCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  onShadowCommit?: (patch: EditorShadowPropertyPatchV1) => void;
  hideDisplayText?: boolean;
  hideFontControls?: boolean;
  showSoundControls?: boolean;
  showShadowControls?: boolean;
  // 선택에 키·노브가 없으면(통계뿐) 그림자 대기만 편집
  shadowActiveState?: boolean;
  shadowKind?: 'key' | 'knob';
  /** 이미지가 기본 립을 억제하는 요소인지 - 키·통계만 (그래프·노브 렌더는 억제하지 않는다) */
  imageSuppressesDefaultBorder?: boolean;
  afterSizeContent?: React.ReactNode;
  // getMixedValue 함수
  getMixedValue: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  // getSelectedKeysData 함수 (displayText Mixed 판단용)
  getSelectedKeysData: () => BatchTypographyKeyData[];
  // 핸들러
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string },
  ) => void;
  handleBatchSpacingPreview?: (spacing: number) => void;
  handleBatchSpacingCommit?: (
    spacing: number,
    options?: { gestureId?: string },
  ) => void;
  batchSpacing: { isMixed: boolean; value: number };
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchResizePreview: (
    dimension: 'width' | 'height',
    value: number,
  ) => void;
  onElementPropertyCommit?: (
    updates: BatchElementPropertyUpdate,
    options?: { gestureId?: string },
  ) => void;
  // 키 전용 (사운드 등)
  getKeyOnlyMixedValue?: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  // 눌림 가능(키·노브) — active 상태 집계·쓰기가 통계만 제외
  getActiveCapableMixedValue?: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  // 이미지 피커
  showBatchImagePicker: boolean;
  onToggleBatchImagePicker: () => void;
  batchImageButtonRef: React.RefObject<HTMLButtonElement>;
  // 기타
  panelElement: HTMLElement | null;
  useCustomCSS: boolean;
  t: (key: string) => string;
}

const BatchStyleTabContent: React.FC<BatchStyleTabContentProps> = ({
  selectedCount,
  totalCount,
  hideDisplayText = false,
  hideFontControls = false,
  soundBinding = EMPTY_BATCH_ELEMENT_BINDING,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onPaintPreview,
  onPaintCommit,
  onFontColorPreview,
  onFontColorCommit,
  onShadowCommit,
  showSoundControls = false,
  showShadowControls = true,
  shadowActiveState = true,
  shadowKind = 'key',
  imageSuppressesDefaultBorder = true,
  afterSizeContent,
  getMixedValue,
  getSelectedKeysData,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingCommit,
  batchSpacing,
  handleBatchResize,
  handleBatchResizePreview,
  onElementPropertyCommit,
  getKeyOnlyMixedValue,
  getActiveCapableMixedValue,
  showBatchImagePicker,
  onToggleBatchImagePicker,
  batchImageButtonRef,
  panelElement,
  useCustomCSS,
  t,
}) => {
  const [colorState, setColorState] = useState<'idle' | 'active'>('idle');
  const effectiveColorState = shadowActiveState ? colorState : 'idle';
  const activeMixedValue =
    getActiveCapableMixedValue ?? getKeyOnlyMixedValue ?? getMixedValue;
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  // 선택 구성 시그니처 — 형식 왕복 기억·드래그 소유권이 다른 배치 선택과
  // 교차하지 않게 keyType + 정렬된 대상 목록을 키에 포함
  const batchSelectionKey = useMemo(
    () =>
      `${selectedKeyType}:${selectedElements
        .map((el) => el.id)
        .sort()
        .join(',')}`,
    [selectedKeyType, selectedElements],
  );
  useEffect(() => {
    // 눌림 상태 편집 능력이 사라지면 저장된 active 탭 선택도 리셋
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!shadowActiveState) setColorState('idle');
  }, [shadowActiveState]);

  const colorPairFor = (
    position: KeyPosition,
    target: 'backgroundColor' | 'borderColor' | 'fontColor',
    active: boolean,
  ) => {
    if (target === 'fontColor') {
      return resolveStatePair(
        active,
        { color: position.fontColor, gradient: position.fontGradient },
        {
          color: position.activeFontColor,
          gradient: position.activeFontGradient,
        },
      );
    }
    if (target === 'backgroundColor') {
      return resolveStatePair(
        active,
        {
          color: position.backgroundColor,
          gradient: position.backgroundGradient,
        },
        {
          color: position.activeBackgroundColor,
          gradient: position.activeBackgroundGradient,
        },
      );
    }
    // 테두리는 미지정 시 앱 기본 립이 들어가므로 렌더와 같은 해석기로 읽는다
    const border = resolveElementBorder(position, active, {
      suppressDefault:
        imageSuppressesDefaultBorder &&
        elementImageReplacesSurface(position, active),
    });
    return { color: border.color, gradient: border.gradient };
  };

  // 피커 칸은 hex와 알파를 따로 판단한다. 색이 같고 알파만 갈리면 hex는 공통값이다
  const mixedColorParts = (
    getColor: (position: KeyPosition) => string | undefined,
    fallback: string,
  ) => {
    const mixedFn =
      effectiveColorState === 'active' ? activeMixedValue : getMixedValue;
    return {
      hexMixed: mixedFn((pos) => toRgbHexColor(getColor(pos) ?? fallback), '')
        .isMixed,
      alphaMixed: mixedFn(
        (pos) => parseAlphaPercent(getColor(pos) ?? fallback),
        100,
      ).isMixed,
    };
  };

  return (
    <>
      <PropertySection>
        {/* 정렬·분배·간격 - 공통 기하 섹션 */}
        <BatchGeometrySection
          totalCount={totalCount ?? selectedCount}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          batchSpacing={batchSpacing}
          t={t}
        />

        {/* 크기 */}
        <PropertyRow label={t('propertiesPanel.size') || '크기'}>
          <NumberInput
            value={getMixedValue((pos) => pos.width, 60).value}
            onChange={(value) => handleBatchResize('width', value)}
            onPreview={(value) => handleBatchResizePreview('width', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="W"
            width={AXIS_FIELD_WIDTH}
            min={10}
            max={9999}
            allowDecimal
            decimalScale={1}
            isMixed={getMixedValue((pos) => pos.width, 60).isMixed}
          />
          <NumberInput
            value={getMixedValue((pos) => pos.height, 60).value}
            onChange={(value) => handleBatchResize('height', value)}
            onPreview={(value) => handleBatchResizePreview('height', value)}
            onCancel={() => editGestureController.cancel()}
            prefix="H"
            width={AXIS_FIELD_WIDTH}
            min={10}
            max={9999}
            allowDecimal
            decimalScale={1}
            isMixed={getMixedValue((pos) => pos.height, 60).isMixed}
          />
        </PropertyRow>
      </PropertySection>

      {afterSizeContent ? (
        <PropertySection>{afterSizeContent}</PropertySection>
      ) : null}

      <PropertySection>
        {/* 배경색 */}
        <PropertyRow label={t('propertiesPanel.backgroundColor') || '배경색'}>
          {(
            effectiveColorState === 'active'
              ? activeMixedValue(
                  (pos) => colorPairFor(pos, 'backgroundColor', true).color,
                  DEFAULT_ELEMENT_ACTIVE_BG,
                ).isMixed
              : getMixedValue(
                  (pos) => colorPairFor(pos, 'backgroundColor', false).color,
                  DEFAULT_ELEMENT_BG,
                ).isMixed
          ) ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <ColorInput
            colorId={`batch-background:${batchSelectionKey}`}
            {...mixedColorParts(
              (pos) =>
                colorPairFor(
                  pos,
                  'backgroundColor',
                  effectiveColorState === 'active',
                ).color,
              effectiveColorState === 'active'
                ? DEFAULT_ELEMENT_ACTIVE_BG
                : DEFAULT_ELEMENT_BG,
            )}
            value={
              getMixedValue(
                (pos) => colorPairFor(pos, 'backgroundColor', false).color,
                DEFAULT_ELEMENT_BG,
              ).value
            }
            activeValue={
              activeMixedValue(
                (pos) => colorPairFor(pos, 'backgroundColor', true).color,
                DEFAULT_ELEMENT_ACTIVE_BG,
              ).value
            }
            showStateTabs={shadowActiveState}
            stateMode={effectiveColorState}
            onStateModeChange={setColorState}
            onChange={() => {}}
            onChangeComplete={() => {}}
            onActiveChangeComplete={() => {}}
            onCancel={() => editGestureController.cancel()}
            panelElement={panelElement}
            canvasAnchor={{ kind: 'batch' }}
            gradientValue={
              getMixedValue(
                (pos) =>
                  colorPairFor(pos, 'backgroundColor', false).gradient ?? null,
                null,
              ).value
            }
            activeGradientValue={
              activeMixedValue(
                (pos) =>
                  colorPairFor(pos, 'backgroundColor', true).gradient ?? null,
                null,
              ).value
            }
            onModePreview={(state, modeValue) =>
              onPaintPreview?.(
                state === 'active'
                  ? {
                      property: 'activeBackgroundPaint',
                      value: paintDescriptor(modeValue),
                    }
                  : {
                      property: 'backgroundPaint',
                      value: paintDescriptor(modeValue),
                    },
              )
            }
            onModeCommit={(state, modeValue) =>
              onPaintCommit?.(
                state === 'active'
                  ? {
                      property: 'activeBackgroundPaint',
                      value: paintDescriptor(modeValue),
                    }
                  : {
                      property: 'backgroundPaint',
                      value: paintDescriptor(modeValue),
                    },
              )
            }
          />
        </PropertyRow>

        {/* 테두리 색상 */}
        <PropertyRow label={t('propertiesPanel.borderColor') || '테두리 색상'}>
          {(
            effectiveColorState === 'active'
              ? activeMixedValue(
                  (pos) => colorPairFor(pos, 'borderColor', true).color,
                  DEFAULT_ELEMENT_ACTIVE_BORDER,
                ).isMixed
              : getMixedValue(
                  (pos) => colorPairFor(pos, 'borderColor', false).color,
                  DEFAULT_ELEMENT_BORDER,
                ).isMixed
          ) ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <ColorInput
            colorId={`batch-border:${batchSelectionKey}`}
            {...mixedColorParts(
              (pos) =>
                colorPairFor(
                  pos,
                  'borderColor',
                  effectiveColorState === 'active',
                ).color,
              effectiveColorState === 'active'
                ? DEFAULT_ELEMENT_ACTIVE_BORDER
                : DEFAULT_ELEMENT_BORDER,
            )}
            gradientSurface="border"
            value={
              getMixedValue(
                (pos) => colorPairFor(pos, 'borderColor', false).color,
                DEFAULT_ELEMENT_BORDER,
              ).value
            }
            activeValue={
              activeMixedValue(
                (pos) => colorPairFor(pos, 'borderColor', true).color,
                DEFAULT_ELEMENT_ACTIVE_BORDER,
              ).value
            }
            showStateTabs={shadowActiveState}
            stateMode={effectiveColorState}
            onStateModeChange={setColorState}
            onChange={() => {}}
            onChangeComplete={() => {}}
            onActiveChangeComplete={() => {}}
            onCancel={() => editGestureController.cancel()}
            panelElement={panelElement}
            canvasAnchor={{ kind: 'batch' }}
            gradientValue={
              getMixedValue(
                (pos) =>
                  colorPairFor(pos, 'borderColor', false).gradient ?? null,
                null,
              ).value
            }
            activeGradientValue={
              activeMixedValue(
                (pos) =>
                  colorPairFor(pos, 'borderColor', true).gradient ?? null,
                null,
              ).value
            }
            onModePreview={(state, modeValue) =>
              onPaintPreview?.(
                state === 'active'
                  ? {
                      property: 'activeBorderPaint',
                      value: paintDescriptor(modeValue),
                    }
                  : {
                      property: 'borderPaint',
                      value: paintDescriptor(modeValue),
                    },
              )
            }
            onModeCommit={(state, modeValue) =>
              onPaintCommit?.(
                state === 'active'
                  ? {
                      property: 'activeBorderPaint',
                      value: paintDescriptor(modeValue),
                    }
                  : {
                      property: 'borderPaint',
                      value: paintDescriptor(modeValue),
                    },
              )
            }
          />
        </PropertyRow>

        {/* 테두리 두께 */}
        <PropertyRow label={t('propertiesPanel.borderWidth') || '테두리 두께'}>
          {getMixedValue(
            (pos) => pos.borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH,
            DEFAULT_ELEMENT_BORDER_WIDTH,
          ).isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <NumberInput
            value={
              getMixedValue(
                (pos) => pos.borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH,
                DEFAULT_ELEMENT_BORDER_WIDTH,
              ).value
            }
            onChange={(value) =>
              onStylePropertyCommit?.({ property: 'borderWidth', value: value })
            }
            onPreview={(value) =>
              onStylePropertyPreview?.({
                property: 'borderWidth',
                value: value,
              })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={20}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 모서리 반경 */}
        <PropertyRow label={t('propertiesPanel.borderRadius') || '모서리 반경'}>
          {getMixedValue((pos) => pos.borderRadius, DEFAULT_ELEMENT_RADIUS)
            .isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <NumberInput
            value={
              getMixedValue((pos) => pos.borderRadius, DEFAULT_ELEMENT_RADIUS)
                .value
            }
            onChange={(value) =>
              onStylePropertyCommit?.({
                property: 'borderRadius',
                value: value,
              })
            }
            onPreview={(value) =>
              onStylePropertyPreview?.({
                property: 'borderRadius',
                value: value,
              })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={100}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {/* 커스텀 이미지 */}
        <PropertyRow
          label={t('propertiesPanel.customImage') || '커스텀 이미지'}
        >
          <button
            ref={batchImageButtonRef}
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              showBatchImagePicker ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={onToggleBatchImagePicker}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>
      </PropertySection>

      {showShadowControls ? (
        <BatchShadowSection
          getMixedValue={getMixedValue}
          getActiveMixedValue={activeMixedValue}
          showActiveState={shadowActiveState}
          shadowKind={shadowKind}
          onShadowCommit={onShadowCommit}
          onStylePropertyPreview={onStylePropertyPreview}
          panelElement={panelElement}
          t={t}
        />
      ) : null}

      {(!hideDisplayText || !hideFontControls) && (
        <BatchTypographySection
          hideDisplayText={hideDisplayText}
          hideFontControls={hideFontControls}
          getMixedValue={getMixedValue}
          getActiveMixedValue={activeMixedValue}
          getSelectedKeysData={getSelectedKeysData}
          effectiveColorState={effectiveColorState}
          showActiveState={shadowActiveState}
          onColorStateChange={setColorState}
          batchSelectionKey={batchSelectionKey}
          onStylePropertyPreview={onStylePropertyPreview}
          onStylePropertyCommit={onStylePropertyCommit}
          onFontColorPreview={onFontColorPreview}
          onFontColorCommit={onFontColorCommit}
          onElementPropertyCommit={onElementPropertyCommit}
          panelElement={panelElement}
          t={t}
        />
      )}

      {/* 커스텀 CSS 활성화 시에만 클래스명 및 CSS 우선순위 표시 */}
      {useCustomCSS && (
        <PropertySection>
          {/* CSS 우선순위 토글 */}
          <div className="flex justify-between items-center w-full min-h-[32px]">
            <p className="text-fg-muted text-label">
              {t('propertiesPanel.useInlineStyles') || '인라인 스타일 우선'}
            </p>
            <Checkbox
              commitStrategy="after-paint"
              checked={getMixedValue((pos) => pos.useInlineStyles, false).value}
              onChange={() => {
                const currentValue = getMixedValue(
                  (pos) => pos.useInlineStyles,
                  false,
                ).value;
                onElementPropertyCommit?.({ useInlineStyles: !currentValue });
              }}
            />
          </div>

          {/* 클래스명 */}
          <PropertyRow label={t('propertiesPanel.className') || '클래스'}>
            <TextInput
              value={
                getMixedValue((pos) => pos.className, '').isMixed
                  ? ''
                  : getMixedValue((pos) => pos.className, '').value
              }
              onChange={(value) =>
                onStylePropertyCommit?.({ property: 'className', value: value })
              }
              onPreview={(value) =>
                onStylePropertyPreview?.({
                  property: 'className',
                  value: value,
                })
              }
              onCancel={() => editGestureController.cancel()}
              placeholder={
                getMixedValue((pos) => pos.className, '').isMixed
                  ? 'Mixed'
                  : 'className'
              }
              width="90px"
              isMixed={getMixedValue((pos) => pos.className, '').isMixed}
            />
          </PropertyRow>
        </PropertySection>
      )}

      {showSoundControls ? (
        <BatchSoundSection
          soundBinding={soundBinding}
          onSoundPathCommit={onSoundPathCommit}
          onSoundEnabledCommit={onSoundEnabledCommit}
          onSoundVolumeCommit={onSoundVolumeCommit}
          getMixedValue={getMixedValue}
          getKeyOnlyMixedValue={getKeyOnlyMixedValue}
          t={t}
        />
      ) : null}
    </>
  );
};

export default BatchStyleTabContent;
