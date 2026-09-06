import React, { useEffect } from 'react';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { flushPluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import type { ImageFit, KeyPosition, KeySlot } from '@src/types/key/keys';
import {
  STAT_BASE_OPTIONS,
  STAT_KPS_OPTIONS,
  type StatItemPosition,
  type StatItemType,
} from '@src/types/key/statItems';
import type { PluginGeometryField } from '@hooks/Grid/usePluginGeometryGesture';
import type {
  CounterTabContentProps,
  NoteTabContentProps,
  StyleTabContentProps,
} from '../types';
import type {
  PluginSettingSchema,
  PluginMessages,
  PluginDefinitionInternal,
  PluginPanelElementView,
} from '@src/types/plugin/api';
import type { KeyInfo } from '@utils/input/KeyMaps';
import {
  PANEL_ROOT_CLASS,
  PANEL_HEADER_CLASS,
} from '../navigation/panelChrome';
import {
  hasRenderableSettings,
  type SettingsNormalizationErrorKind,
} from '@plugins/runtime/settingsSections';
import {
  PropertyRow,
  NumberInput,
  PropertySection,
  Tabs,
  StyleTabContent,
  NoteTabContent,
  CounterTabContent,
  TABS,
  TabType,
} from '../index';
import Dropdown from '@components/main/common/dropdown/Dropdown';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import EditSessionBoundary from '../selection/EditSessionBoundary';
import type { GeometryField } from '@src/renderer/editor/runtime/operations/elementOps';
import type {
  EditorPaintPropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
} from '@src/types/editor';
import { getStatTypeLabel } from '@utils/grid/statTypeLabel';
import SinglePanelRenameHeader from './SinglePanelRenameHeader';

// ============================================================================
// Plugin Selection Panel
// ============================================================================

interface PluginSelectionPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  pluginTitle: string;
  setPluginScrollRef: (node: HTMLDivElement | null) => void;
  isPluginResizable: boolean;
  selectedPluginElement: PluginPanelElementView | null;
  pluginDisplaySize: { width: number; height: number };
  handlePluginGeometryPreview: (
    field: PluginGeometryField,
    value: number,
  ) => void;
  handlePluginGeometryCommit: (
    field: PluginGeometryField,
    value: number,
  ) => void;
  handlePluginGeometryCancel: () => void;
  hasSinglePluginSelection: boolean;
  showModalHint: boolean;
  showSettings: boolean;
  renderPluginSettingsForm: (
    schema: Record<string, PluginSettingSchema> | undefined,
    values: Record<string, unknown>,
    messages: PluginMessages | undefined,
    pluginId: string,
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
  ) => React.ReactNode;
  reportNormalizationError: (
    pluginId: string,
    key: string,
    error: unknown,
    kind: SettingsNormalizationErrorKind,
  ) => void;
  selectedPluginDefinition: PluginDefinitionInternal | null;
  resolvedPluginSettings: Record<string, unknown>;
  handlePluginSettingChange: (key: string, value: unknown) => void;
  t: (key: string) => string | undefined;
}

interface PluginGeometrySectionProps {
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPreview: (field: PluginGeometryField, value: number) => void;
  onCommit: (field: PluginGeometryField, value: number) => void;
  onCancel: () => void;
  t: (key: string) => string | undefined;
}

// 입력 트리와 세션 취소 경계를 같은 서브트리에 둔다 - 선택 지문이 같아도
// 라우트 전환으로 이 섹션만 언마운트되면 미확정 세션을 닫아야 한다
const PluginGeometrySection = ({
  position,
  size,
  onPreview,
  onCommit,
  onCancel,
  t,
}: PluginGeometrySectionProps) => {
  useEffect(() => () => onCancel(), [onCancel]);
  return (
    <PropertySection>
      <PropertyRow label={t('propertiesPanel.position') || '위치'}>
        <NumberInput
          value={position.x}
          onChange={(value) => onCommit('x', value)}
          onPreview={(value) => onPreview('x', value)}
          onCancel={onCancel}
          prefix="X"
          width={AXIS_FIELD_WIDTH}
          min={-9999}
          max={9999}
          allowDecimal
          decimalScale={1}
        />
        <NumberInput
          value={position.y}
          onChange={(value) => onCommit('y', value)}
          onPreview={(value) => onPreview('y', value)}
          onCancel={onCancel}
          prefix="Y"
          width={AXIS_FIELD_WIDTH}
          min={-9999}
          max={9999}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>
      <PropertyRow label={t('propertiesPanel.size') || '크기'}>
        <NumberInput
          value={size.width}
          onChange={(value) => onCommit('width', value)}
          onPreview={(value) => onPreview('width', value)}
          onCancel={onCancel}
          prefix="W"
          width={AXIS_FIELD_WIDTH}
          min={10}
          max={9999}
          allowDecimal
          decimalScale={1}
        />
        <NumberInput
          value={size.height}
          onChange={(value) => onCommit('height', value)}
          onPreview={(value) => onPreview('height', value)}
          onCancel={onCancel}
          prefix="H"
          width={AXIS_FIELD_WIDTH}
          min={10}
          max={9999}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>
    </PropertySection>
  );
};

export const PluginSelectionPanel: React.FC<PluginSelectionPanelProps> = ({
  setPanelElement,
  pluginTitle,
  setPluginScrollRef,
  isPluginResizable,
  selectedPluginElement,
  pluginDisplaySize,
  handlePluginGeometryPreview,
  handlePluginGeometryCommit,
  handlePluginGeometryCancel,
  hasSinglePluginSelection,
  showModalHint,
  showSettings,
  renderPluginSettingsForm,
  reportNormalizationError,
  selectedPluginDefinition,
  resolvedPluginSettings,
  handlePluginSettingChange,
  t,
}) => {
  // 위치 섹션도 설정 폼도 없을 때는 안내 문구만 남음 — 패널 세로 중앙에 배치
  // notice-only로 단락돼도 visibility 예외가 기록되도록 폼과 같은 리포터 전달
  const settingsRenderable =
    showSettings &&
    hasRenderableSettings(
      selectedPluginDefinition?.settings,
      resolvedPluginSettings,
      (key, error, kind) =>
        reportNormalizationError(
          selectedPluginDefinition?.pluginId ?? 'unknown',
          key,
          error,
          kind,
        ),
    );
  const noticeOnly = !isPluginResizable && !settingsRenderable;
  const noticeText = !hasSinglePluginSelection
    ? t('propertiesPanel.pluginMultiSelection') ||
      '플러그인 요소는 한 번에 하나만 편집할 수 있습니다.'
    : showModalHint
    ? t('propertiesPanel.pluginModalHint') ||
      '이 플러그인은 설정 모달을 사용합니다. 요소를 클릭해 설정하세요.'
    : t('propertiesPanel.pluginNoSettings') || '설정할 항목이 없습니다.';

  if (noticeOnly) {
    return (
      <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
        <div className={PANEL_HEADER_CLASS}>
          <span className="text-fg text-label leading-none truncate max-w-[120px]">
            {pluginTitle}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center px-[24px] pb-[48px]">
          <p className="text-fg-faint text-body text-center">{noticeText}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className={PANEL_HEADER_CLASS}>
        <span className="text-fg text-label leading-none truncate max-w-[120px]">
          {pluginTitle}
        </span>
      </div>
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={setPluginScrollRef}
          className="properties-panel-overlay-viewport"
          // blur가 확정 경계 - keystroke 단위가 아니라 포커스 이탈 시 즉시 커밋
          onBlurCapture={() => {
            const pluginId =
              selectedPluginElement?.pluginId ??
              selectedPluginDefinition?.pluginId;
            if (pluginId) flushPluginInstancesEditSession(pluginId);
          }}
        >
          <EditSessionBoundary>
            {isPluginResizable && (
              <PluginGeometrySection
                position={selectedPluginElement?.position ?? { x: 0, y: 0 }}
                size={pluginDisplaySize}
                onPreview={handlePluginGeometryPreview}
                onCommit={handlePluginGeometryCommit}
                onCancel={handlePluginGeometryCancel}
                t={t}
              />
            )}
            {!hasSinglePluginSelection && (
              <p className="text-fg-faint text-body text-center">
                {t('propertiesPanel.pluginMultiSelection') ||
                  '플러그인 요소는 한 번에 하나만 편집할 수 있습니다.'}
              </p>
            )}
            {hasSinglePluginSelection && showModalHint && (
              <p className="text-fg-faint text-body text-center">
                {t('propertiesPanel.pluginModalHint') ||
                  '이 플러그인은 설정 모달을 사용합니다. 요소를 클릭해 설정하세요.'}
              </p>
            )}
            {settingsRenderable &&
              renderPluginSettingsForm(
                selectedPluginDefinition?.settings,
                resolvedPluginSettings,
                selectedPluginDefinition?.messages,
                selectedPluginDefinition?.pluginId ?? 'unknown',
                `plugin-element-${selectedPluginElement?.fullId ?? 'unknown'}`,
                handlePluginSettingChange,
              )}
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};

export { SingleGraphPanel } from './SingleGraphPanel';
export { SingleKnobPanel } from './SingleKnobPanel';

// ============================================================================
// Single Key/Stat Selection Panel
// ============================================================================

interface SingleKeyStatPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // 혼합 선택 시 패널 본문 상단에 표시할 플러그인 개수 안내
  isSingleStat: boolean;
  isSingleKey: boolean;
  singleKeyIndex: number | null;
  singleStatIndex: number | null;
  singleKeyPosition: KeyPosition | null;
  canonicalKeyPosition: KeyPosition | null;
  singleStatPosition: StatItemPosition | null;
  singleKeyCode: string | null;
  singleKeySlot: KeySlot | null;
  singleKeyInfo: KeyInfo | null;
  selectedKeyType: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onKeyMappingChange?: (index: number, newSlot: KeySlot) => void;
  localState: Partial<KeyPosition> & { dx?: number; dy?: number };
  setLocalState: React.Dispatch<
    React.SetStateAction<Partial<KeyPosition> & { dx?: number; dy?: number }>
  >;
  handleGeometryPreview?: (field: GeometryField, value: number) => void;
  handleGeometryCommit?: (field: GeometryField, value: number) => void;
  onElementPropertyCommit?: StyleTabContentProps['onElementPropertyCommit'];
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onActiveImageCommit?: (activeImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onActiveTransparentCommit?: (activeTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onActiveImageFitCommit?: (activeImageFit: ImageFit) => void;
  onSoundPathCommit?: (soundPath: string) => void;
  onSoundEnabledCommit?: (soundEnabled: boolean) => void;
  onSoundVolumeCommit?: (soundVolume: number) => void;
  onStylePropertyPreview?: (patch: EditorStylePropertyPreviewPatchV1) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onPaintPreview?: (patch: EditorPaintPropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  onShadowCommit?: (patch: EditorShadowPropertyPatchV1) => void;
  onNotePaintCommit?: NoteTabContentProps['onNotePaintCommit'];
  onNotePaintPreview?: NoteTabContentProps['onNotePaintPreview'];
  onCounterAnimationPresetCommit?: CounterTabContentProps['onCounterAnimationPresetCommit'];
  onCounterEnabledCommit?: CounterTabContentProps['onCounterEnabledCommit'];
  onCounterAnimationEnabledCommit?: CounterTabContentProps['onCounterAnimationEnabledCommit'];
  onCounterLayoutCommit?: CounterTabContentProps['onCounterLayoutCommit'];
  onCounterTypographyCommit?: CounterTabContentProps['onCounterTypographyCommit'];
  onCounterFillCommit?: CounterTabContentProps['onCounterFillCommit'];
  showImagePicker: boolean;
  setShowImagePicker: (value: boolean) => void;
  imageButtonRef: React.RefObject<HTMLButtonElement | null>;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  t: (key: string) => string | undefined;
}

export const SingleKeyStatPanel: React.FC<SingleKeyStatPanelProps> = ({
  setPanelElement,
  isSingleStat,
  isSingleKey: _isSingleKey,
  singleKeyIndex,
  singleStatIndex,
  singleKeyPosition,
  canonicalKeyPosition,
  singleStatPosition,
  singleKeyCode,
  singleKeySlot,
  singleKeyInfo,
  selectedKeyType: _selectedKeyType,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  activeTab,
  setActiveTab,
  onKeyMappingChange,
  localState,
  setLocalState,
  handleGeometryPreview,
  handleGeometryCommit,
  onElementPropertyCommit,
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onStylePropertyPreview,
  onStylePropertyCommit,
  onPaintPreview,
  onPaintCommit,
  onShadowCommit,
  onNotePaintCommit,
  onNotePaintPreview,
  onCounterAnimationPresetCommit,
  onCounterEnabledCommit,
  onCounterAnimationEnabledCommit,
  onCounterLayoutCommit,
  onCounterTypographyCommit,
  onCounterFillCommit,
  showImagePicker,
  setShowImagePicker,
  imageButtonRef,
  panelElement,
  useCustomCSS,
  singleScrollRefFor,
  t,
}) => {
  const availableTabs = isSingleStat
    ? [TABS.STYLE, TABS.COUNTER]
    : [TABS.STYLE, TABS.NOTE, TABS.COUNTER];

  const resolvedStatType =
    (singleStatPosition?.statType as StatItemType) || 'kps';
  const statBaseValue = resolvedStatType === 'total' ? 'total' : 'kps';
  const statTitle = getStatTypeLabel(resolvedStatType);

  const keyLikeIndex = isSingleStat ? singleStatIndex! : singleKeyIndex!;
  const keyLikePosition: KeyPosition = isSingleStat
    ? singleStatPosition!
    : singleKeyPosition!;

  const keyLikeDefaultTitle = isSingleStat
    ? statTitle
    : singleKeyInfo?.displayName || singleKeyCode || 'Key';
  const keyLikeTitle = keyLikePosition?.layerName || keyLikeDefaultTitle;

  const keyLikeCode = isSingleStat ? null : singleKeyCode;
  const keyLikeInfo: KeyInfo | null = isSingleStat
    ? {
        browserKey: statTitle,
        globalKey: statTitle,
        displayName: statTitle,
      }
    : singleKeyInfo;

  const mappingControlLayout = isSingleStat ? (
    <>
      <PropertyRow label={t('propertiesPanel.statType') || 'Stat Type'}>
        <Dropdown
          commitStrategy="after-paint"
          options={STAT_BASE_OPTIONS}
          value={statBaseValue}
          onChange={(value) => {
            if (value === 'total') {
              onElementPropertyCommit?.({
                property: 'statType',
                value: 'total',
              });
              return;
            }
            onElementPropertyCommit?.({
              property: 'statType',
              value: resolvedStatType === 'total' ? 'kps' : resolvedStatType,
            });
          }}
        />
      </PropertyRow>
      {statBaseValue === 'kps' ? (
        <PropertyRow label={t('propertiesPanel.statKpsType') || 'KPS Type'}>
          <Dropdown
            commitStrategy="after-paint"
            options={STAT_KPS_OPTIONS}
            value={resolvedStatType}
            onChange={(value) =>
              onElementPropertyCommit?.({
                property: 'statType',
                value: value as StatItemType,
              })
            }
          />
        </PropertyRow>
      ) : null}
    </>
  ) : undefined;

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0">
        {/* 헤더 */}
        <SinglePanelRenameHeader
          title={keyLikeTitle}
          titleClassName="text-fg text-label leading-none cursor-default truncate max-w-[110px]"
          renameButtonTitle={
            isRenaming ? '' : t('contextMenu.rename') || 'Rename'
          }
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
        />

        {/* 탭 */}
        <div className="px-[12px] pb-[12px]">
          <Tabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            t={t}
            availableTabs={availableTabs}
          />
        </div>
      </div>

      {/* 스크롤 가능한 속성 영역 (탭별 독립 스크롤) */}
      <div className="flex-1 properties-panel-overlay-scroll">
        {/* STYLE 탭 viewport */}
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className={`properties-panel-overlay-viewport ${
            activeTab === TABS.STYLE ? '' : 'hidden'
          }`}
        >
          <EditSessionBoundary>
            <StyleTabContent
              keyIndex={keyLikeIndex}
              keyPosition={keyLikePosition}
              keyCode={keyLikeCode}
              keyInfo={keyLikeInfo}
              onGeometryPreview={handleGeometryPreview}
              onGeometryCommit={handleGeometryCommit}
              onElementPropertyCommit={onElementPropertyCommit}
              canvasAnchor={
                keyLikePosition.id && isNativeElementId(keyLikePosition.id)
                  ? {
                      kind: isSingleStat ? 'stat' : 'key',
                      id: keyLikePosition.id,
                    }
                  : undefined
              }
              onKeyMappingChange={isSingleStat ? undefined : onKeyMappingChange}
              keySlot={isSingleStat ? undefined : singleKeySlot}
              mappingControlLayout={mappingControlLayout}
              mappingLabel={
                isSingleStat
                  ? t('propertiesPanel.statType') || 'Stat Type'
                  : undefined
              }
              showSoundControls={!isSingleStat}
              shadowActiveState={!isSingleStat}
              showImagePicker={showImagePicker}
              onToggleImagePicker={() => setShowImagePicker(!showImagePicker)}
              onInactiveImageCommit={onInactiveImageCommit}
              onActiveImageCommit={onActiveImageCommit}
              onIdleTransparentCommit={onIdleTransparentCommit}
              onActiveTransparentCommit={onActiveTransparentCommit}
              onIdleImageFitCommit={onIdleImageFitCommit}
              onActiveImageFitCommit={onActiveImageFitCommit}
              onSoundPathCommit={onSoundPathCommit}
              onSoundEnabledCommit={onSoundEnabledCommit}
              onSoundVolumeCommit={onSoundVolumeCommit}
              onStylePropertyPreview={onStylePropertyPreview}
              onStylePropertyCommit={onStylePropertyCommit}
              onPaintPreview={onPaintPreview}
              onPaintCommit={onPaintCommit}
              onShadowCommit={onShadowCommit}
              imageButtonRef={imageButtonRef}
              panelElement={panelElement}
              useCustomCSS={useCustomCSS}
              t={t}
              localDx={localState.dx}
              localDy={localState.dy}
              localWidth={localState.width}
              localHeight={localState.height}
              onLocalDxChange={(value) =>
                setLocalState((prev) => ({ ...prev, dx: value }))
              }
              onLocalDyChange={(value) =>
                setLocalState((prev) => ({ ...prev, dy: value }))
              }
              onLocalWidthChange={(value) =>
                setLocalState((prev) => ({ ...prev, width: value }))
              }
              onLocalHeightChange={(value) =>
                setLocalState((prev) => ({ ...prev, height: value }))
              }
            />
          </EditSessionBoundary>
        </div>

        {/* NOTE 탭 viewport */}
        {!isSingleStat && (
          <div
            ref={singleScrollRefFor(TABS.NOTE)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.NOTE ? '' : 'hidden'
            }`}
          >
            <EditSessionBoundary>
              <NoteTabContent
                keyPosition={singleKeyPosition!}
                canonicalKeyPosition={canonicalKeyPosition ?? undefined}
                onElementPropertyCommit={onElementPropertyCommit}
                onStylePropertyPreview={onStylePropertyPreview}
                onStylePropertyCommit={onStylePropertyCommit}
                onNotePaintPreview={onNotePaintPreview}
                onNotePaintCommit={onNotePaintCommit}
                panelElement={panelElement}
                t={t}
              />
            </EditSessionBoundary>
          </div>
        )}

        {/* COUNTER 탭 viewport */}
        <div
          ref={singleScrollRefFor(TABS.COUNTER)}
          className={`properties-panel-overlay-viewport ${
            activeTab === TABS.COUNTER ? '' : 'hidden'
          }`}
        >
          <EditSessionBoundary>
            <CounterTabContent
              keyPosition={keyLikePosition}
              keyDisplayName={keyLikeInfo?.displayName}
              isStat={isSingleStat}
              onCounterEnabledCommit={onCounterEnabledCommit}
              onCounterAnimationEnabledCommit={onCounterAnimationEnabledCommit}
              onCounterLayoutCommit={onCounterLayoutCommit}
              onCounterTypographyCommit={onCounterTypographyCommit}
              onCounterFillCommit={onCounterFillCommit}
              onCounterAnimationPresetCommit={onCounterAnimationPresetCommit}
              panelElement={panelElement}
              t={t}
            />
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};
