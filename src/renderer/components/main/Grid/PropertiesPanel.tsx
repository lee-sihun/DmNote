import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { usePanelHost } from '@contexts/PanelHostContext';
import { isHTMLElementNode } from '@utils/dom/isElementNode';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  selectPropertyPanelPluginElements,
  usePluginDisplayElementStore,
} from '@stores/plugin/usePluginDisplayElementStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import {
  getDefaultSettings,
  normalizeSettingsSections,
  omitLayoutSettingValues,
  type SettingsNormalizationErrorKind,
} from '@plugins/runtime/settingsSections';
import { updatePluginElement } from '@plugins/runtime/displayElement/pluginElementActions';
import type { NativeLayerBoundsTarget } from '@plugins/runtime/displayElement/pluginElementActions';
import {
  toRgbHexColor,
  parseAlphaPercent,
  hexWithAlphaPercent,
} from '@utils/color/colorUtils';
import type { ImageFit, KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition, StatItemType } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { BatchElementPropertyUpdate } from './PropertiesPanel/types';
import type {
  EditorFontStylePropertyPatchV1,
  EditorFontFamilyPropertyPatchV1,
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
  EditorNotePropertyPatchV1,
  EditorElementTypeV1,
  EditorCounterAnimationPresetIntentV1,
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
  EditorCounterStrokePropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
  EditorFontColorPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
  EditorElementPropertyPatchV1,
  CanonicalKeyPosition,
  CanonicalKnobItemPosition,
} from '@src/types/editor';
import type {
  PluginSettingSchema,
  PluginMessages,
} from '@src/types/plugin/api';
import { normalizeCounterSettings } from '@src/types/key/keys';
import { slotCanonical, slotDisplayName } from '@utils/keySlot';
import { useLenis } from '@hooks/useLenis';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';
import {
  composePreviewPositions,
  getPreviewOverlayVersion,
  subscribePreviewOverlay,
} from '@src/renderer/editor/runtime/previewOverlay';
import {
  commitBatchGeometryByIds,
  patchElementLayerNameById,
  renameLayerGroupById,
  commitElementGeometryById,
  patchActiveImageById,
  patchActiveImageFitById,
  patchActiveTransparentById,
  patchFontFamilyByTargets,
  patchStylePropertyById,
  patchPaintById,
  patchShadowById,
  patchNotePaintById,
  patchInactiveImageById,
  patchIdleImageFitById,
  patchIdleTransparentById,
  patchSoundPathById,
  patchSoundEnabledById,
  patchSoundVolumeById,
  patchCounterAnimationEnabledById,
  patchCounterAnimationPresetById,
  patchCounterEnabledById,
  patchCounterLayoutById,
  patchCounterTypographyById,
  patchCounterStrokeById,
  patchCounterStrokeByTargets,
  patchCounterFillById,
  patchFontColorById,
  patchFontStyleByTargets,
  patchGraphColorsByIds,
  patchGraphPropertiesByIds,
  patchGraphTypesByIds,
  patchKnobPropertiesByIds,
  patchNotePropertiesByIds,
  patchUseInlineStylesByTargets,
  patchElementPropertyById,
} from '@src/renderer/editor/runtime/elementOps';
import type { GeometryField } from '@src/renderer/editor/runtime/elementOps';
import type {
  BatchGeometryDescriptor,
  BatchGeometryTarget,
} from '@src/renderer/editor/runtime/elementOps';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { computeBatchGeometryPlan } from '@src/renderer/editor/runtime/batchGeometryPlan';
import { commitMixedBatchGeometry } from '@src/renderer/editor/runtime/mixedBatchGeometry';
import { isPluginVisibleInMode } from '@utils/layerGroupUtils';
import { resolveResizablePluginElementSize } from '@utils/plugin/pluginElementMeasurement';

// 분리된 컴포넌트들 및 훅
import {
  TABS,
  PropertyRow,
  PropertySection,
  NumberInput,
  ColorInput,
  TextInput,
  LayerPanel,
  PluginSelectionPanel,
  SingleGraphPanel,
  SingleKnobPanel,
  SingleKeyStatPanel,
  BatchKeyLikePanel,
  BatchGraphOnlyPanel,
  BatchKnobOnlyPanel,
  BatchPluginOnlyPanel,
  PluginSettingsPanelView,
  useBatchHandlers,
  usePanelScroll,
} from './PropertiesPanel/index';
import {
  SIDE_PANEL_FRAME_CLASS,
  WINDOW_PANEL_FRAME_CLASS,
} from './PropertiesPanel/panelChrome';
import { resolveSelectionPanelRoute } from './PropertiesPanel/selectionPanelRoute';
import { PanelNavProvider } from './PropertiesPanel/PanelNavContext';
import PanelHeaderActions from './PropertiesPanel/PanelHeaderActions';
import PanelToggleButton from './PropertiesPanel/PanelToggleButton';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import type { NoteColor } from '@src/types/key/keys';
import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { projectNotePaintPatch } from '@src/types/key/notePaint';
import { previewSingleStyleProperty } from './PropertiesPanel/previewPatchForwarders';
import { reportElementOpSkipped } from '@src/renderer/editor/runtime/elementIntent';

const getStatTypeLabel = (statType?: StatItemType | null): string => {
  switch (statType) {
    case 'kpsAvg':
      return 'AVG';
    case 'kpsMax':
      return 'MAX';
    case 'total':
      return 'Total';
    case 'kps':
    default:
      return 'KPS';
  }
};

const geometryAxisPatch = (
  field: GeometryField,
  value: number,
): NativeLayerBoundsTarget['patch'] => {
  switch (field) {
    case 'dx':
      return { dx: value };
    case 'dy':
      return { dy: value };
    case 'width':
      return { width: value };
    case 'height':
      return { height: value };
  }
};

const shouldNormalizePropertyTabToStyle = (
  elements: Array<{ type: string }>,
  activeTab: (typeof TABS)[keyof typeof TABS],
): boolean => {
  if (activeTab === TABS.STYLE) return false;
  const hasKey = elements.some((element) => element.type === 'key');
  const hasStat = elements.some((element) => element.type === 'stat');
  const hasGraph = elements.some((element) => element.type === 'graph');

  // 플러그인 혼합도 native 구성 기준으로 정규화 - stat+plugin에서 NOTE 탭이
  // 남으면 배치 패널 본문이 비어 보인다
  if (activeTab === TABS.NOTE && hasStat && !hasKey) {
    return true;
  }
  return hasGraph && !hasKey && !hasStat;
};

// 서브 페이지 exit 전환 시간 — --ui-duration-page와 동기
const PAGE_EXIT_MS = 250;

const getGraphRuntimePropertyPatch = (
  updates: Partial<GraphItemPosition>,
): EditorGraphRuntimePropertyPatchV1 | null => {
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (keys[0] === 'showAvgLine' && typeof updates.showAvgLine === 'boolean') {
    return { property: 'showAvgLine', value: updates.showAvgLine };
  }
  if (
    keys[0] === 'graphAnimationEnabled' &&
    typeof updates.graphAnimationEnabled === 'boolean'
  ) {
    return {
      property: 'graphAnimationEnabled',
      value: updates.graphAnimationEnabled,
    };
  }
  if (
    keys[0] === 'graphSpeed' &&
    Number.isSafeInteger(updates.graphSpeed) &&
    (updates.graphSpeed as number) >= 0 &&
    (updates.graphSpeed as number) <= 4_294_967_295
  ) {
    return { property: 'graphSpeed', value: updates.graphSpeed as number };
  }
  return null;
};

const getKnobRuntimePropertyPatch = (
  updates: Partial<KnobItemPosition>,
): EditorKnobRuntimePropertyPatchV1 | null => {
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (keys[0] === 'reverse' && typeof updates.reverse === 'boolean') {
    return { property: 'reverse', value: updates.reverse };
  }
  if (
    keys[0] === 'sensitivity' &&
    typeof updates.sensitivity === 'number' &&
    Number.isFinite(updates.sensitivity)
  ) {
    return { property: 'sensitivity', value: updates.sensitivity };
  }
  return null;
};

const getUseInlineStylesPatch = (updates: object): boolean | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  return keys.length === 1 &&
    keys[0] === 'useInlineStyles' &&
    typeof values.useInlineStyles === 'boolean'
    ? values.useInlineStyles
    : null;
};

const getFontStylePatch = (
  updates: object,
): EditorFontStylePropertyPatchV1 | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (
    keys[0] === 'fontWeight' &&
    Number.isSafeInteger(values.fontWeight) &&
    (values.fontWeight as number) >= 0 &&
    (values.fontWeight as number) <= 4_294_967_295
  ) {
    return { property: 'fontWeight', value: values.fontWeight as number };
  }
  if (keys[0] === 'fontItalic' && typeof values.fontItalic === 'boolean') {
    return { property: 'fontItalic', value: values.fontItalic };
  }
  if (
    keys[0] === 'fontUnderline' &&
    typeof values.fontUnderline === 'boolean'
  ) {
    return { property: 'fontUnderline', value: values.fontUnderline };
  }
  if (
    keys[0] === 'fontStrikethrough' &&
    typeof values.fontStrikethrough === 'boolean'
  ) {
    return { property: 'fontStrikethrough', value: values.fontStrikethrough };
  }
  return null;
};

const getFontFamilyPatch = (
  updates: object,
): EditorFontFamilyPropertyPatchV1 | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  return keys.length === 1 &&
    keys[0] === 'fontFamily' &&
    typeof values.fontFamily === 'string'
    ? { property: 'fontFamily', value: values.fontFamily }
    : null;
};

const getNotePropertyPatch = (
  updates: object,
): EditorNotePropertyPatchV1 | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (
    keys[0] === 'noteEffectEnabled' &&
    typeof values.noteEffectEnabled === 'boolean'
  ) {
    return { property: 'noteEffectEnabled', value: values.noteEffectEnabled };
  }
  if (
    keys[0] === 'noteAutoYCorrection' &&
    typeof values.noteAutoYCorrection === 'boolean'
  ) {
    return {
      property: 'noteAutoYCorrection',
      value: values.noteAutoYCorrection,
    };
  }
  if (
    keys[0] === 'noteGlowEnabled' &&
    typeof values.noteGlowEnabled === 'boolean'
  ) {
    return { property: 'noteGlowEnabled', value: values.noteGlowEnabled };
  }
  if (
    keys[0] === 'noteAlignment' &&
    ['left', 'center', 'right'].includes(values.noteAlignment as string)
  ) {
    return {
      property: 'noteAlignment',
      value: values.noteAlignment as 'left' | 'center' | 'right',
    };
  }
  if (
    keys[0] === 'noteBorderSide' &&
    ['all', 'vertical', 'horizontal'].includes(values.noteBorderSide as string)
  ) {
    return {
      property: 'noteBorderSide',
      value: values.noteBorderSide as 'all' | 'vertical' | 'horizontal',
    };
  }
  return null;
};

// ============================================================================
// 메인 컴포넌트 Props
// ============================================================================

interface PropertiesPanelProps {
  onKeyMappingChange?: (index: number, newKey: string) => void;
  // 분리 창 전환 액션 - 메인은 detach, 분리 창은 reattach
  detachAction?: 'detach' | 'reattach';
  onDetachAction?: () => void;
  // 분리 창에서는 인셋 채움 프레임 사용
  frameVariant?: 'inline' | 'window';
}

// ============================================================================
// 메인 컴포넌트
// ============================================================================

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  detachAction,
  onDetachAction,
  frameVariant = 'inline',
  onKeyMappingChange,
}) => {
  const { t, i18n } = useTranslation();
  // 패널이 분리 창에 있으면 키·마우스 이벤트는 그 창의 document로 온다
  const { document: hostDocument } = usePanelHost();
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const positions = useKeyStore((state) => state.positions);
  const canonicalPositions = useKeyStore((state) => state.canonicalPositions);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const canonicalStatItemPositions = useStatItemStore(
    (state) => state.positions,
  );
  const canonicalGraphItemPositions = useGraphItemStore(
    (state) => state.positions,
  );
  const canonicalKnobItemPositions = useKnobItemStore(
    (state) => state.positions,
  );
  useSyncExternalStore(
    subscribePreviewOverlay,
    getPreviewOverlayVersion,
    getPreviewOverlayVersion,
  );
  const statItemPositions = composePreviewPositions(
    'statPosition',
    canonicalStatItemPositions,
  );
  const graphItemPositions = composePreviewPositions(
    'graphPosition',
    canonicalGraphItemPositions,
  );
  const knobItemPositions = composePreviewPositions(
    'knobPosition',
    canonicalKnobItemPositions,
  );
  const { useCustomCSS } = useSettingsStore();
  const pluginElements = usePluginDisplayElementStore(
    selectPropertyPanelPluginElements,
  );
  const pluginDefinitions = usePluginDisplayElementStore(
    (state) => state.definitions,
  );
  const pluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.pluginSettingsPanel,
  );
  const closePluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.closePluginSettingsPanel,
  );
  const isPanelVisibleStore = usePropertiesPanelStore(
    (state) => state.isCanvasPanelOpen,
  );
  // 분리 창은 창 자체가 패널 - 가시성 개념이 없어 항상 열림으로 취급해야
  // 선택 도착·해제가 모드를 property로 강제하거나 내용을 숨기지 않음
  const isPanelVisible = frameVariant === 'window' || isPanelVisibleStore;
  const setIsPanelVisible = usePropertiesPanelStore(
    (state) => state.setCanvasPanelOpen,
  );
  const canvasPanelToggleSignal = usePropertiesPanelStore(
    (state) => state.canvasPanelToggleSignal,
  );
  const locale = i18n.language;

  // 선택된 키 요소 필터링
  const selectedKeyElements = selectedElements.filter(
    (el) => el.type === 'key',
  );
  const selectedStatElements = selectedElements.filter(
    (el) => el.type === 'stat',
  );
  const selectedGraphElements = selectedElements.filter(
    (el) => el.type === 'graph',
  );
  const selectedKnobElements = selectedElements.filter(
    (el) => el.type === 'knob',
  );
  const selectedKeyLikeElements = selectedElements.filter(
    (el) => el.type === 'key' || el.type === 'stat',
  );
  const selectedBatchStyleElements = selectedElements.filter(
    (el) =>
      el.type === 'key' ||
      el.type === 'stat' ||
      el.type === 'graph' ||
      el.type === 'knob',
  );
  const selectedPluginElements = selectedElements.filter(
    (el) => el.type === 'plugin',
  );

  const selectedPluginElement = (() => {
    if (selectedPluginElements.length !== 1) return null;
    return (
      pluginElements.find((el) => el.fullId === selectedPluginElements[0].id) ||
      null
    );
  })();
  // plugin 단독 배치는 native 대상 0개(빈 배열)로 성립 - invalid ID가
  // 하나라도 섞이면 null (fail-closed)
  const stableBatchGeometryTargets: BatchGeometryTarget[] | null =
    selectedBatchStyleElements.every(
      (element) => element.id.length > 0 && isNativeElementId(element.id),
    )
      ? selectedBatchStyleElements.map((element) => ({
          type: element.type as EditorElementTypeV1,
          id: element.id,
        }))
      : null;
  // 혼합 선택의 plugin 기하 대상 bounds - 소실·모드 이탈이 하나라도 있으면
  // null (fail-closed). 크기는 캔버스 렌더와 동일한 measured/estimated 폴백
  const stablePluginGeometryElements = (() => {
    const resolved: Array<{
      fullId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    for (const selected of selectedPluginElements) {
      const element = pluginElements.find(
        (candidate) => candidate.fullId === selected.id,
      );
      if (!element || !isPluginVisibleInMode(element, selectedKeyType)) {
        return null;
      }
      const size = resolveResizablePluginElementSize(element);
      resolved.push({
        fullId: element.fullId,
        x: element.position.x,
        y: element.position.y,
        width: size.width,
        height: size.height,
      });
    }
    return resolved;
  })();
  const stablePluginGeometryTargets: string[] | null =
    stablePluginGeometryElements?.map((element) => element.fullId) ?? null;

  const selectedPluginDefinition = selectedPluginElement?.definitionId
    ? pluginDefinitions.get(selectedPluginElement.definitionId) ?? null
    : null;

  const pluginSettingsUI = selectedPluginDefinition?.settingsUI ?? 'panel';
  const hasSinglePluginSelection =
    selectedPluginElements.length === 1 && !!selectedPluginElement;
  const showModalHint =
    hasSinglePluginSelection && pluginSettingsUI === 'modal';
  const showSettings = hasSinglePluginSelection && pluginSettingsUI !== 'modal';
  const isPluginResizable =
    hasSinglePluginSelection && !!selectedPluginDefinition?.resizable;

  const pluginDisplaySize = (() => {
    const measured = selectedPluginElement?.measuredSize;
    const estimated = selectedPluginElement?.estimatedSize;
    return {
      width: measured?.width ?? estimated?.width ?? 200,
      height: measured?.height ?? estimated?.height ?? 150,
    };
  })();

  // 단일 키 선택인 경우의 데이터
  const singleKeyId =
    selectedKeyElements.length === 1 ? selectedKeyElements[0].id : null;
  const singleKeyIndex = singleKeyId
    ? (positions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleKeyId,
      )
    : -1;
  const singleKeyPosition =
    singleKeyIndex >= 0 ? positions[selectedKeyType]?.[singleKeyIndex] : null;
  const singleKeySlot =
    singleKeyIndex >= 0
      ? keyMappings[selectedKeyType]?.[singleKeyIndex] ?? null
      : null;
  const singleKeyCode =
    singleKeySlot != null ? slotCanonical(singleKeySlot) : null;
  const singleKeyInfo =
    singleKeySlot != null && singleKeyCode
      ? typeof singleKeySlot === 'string'
        ? getKeyInfoByGlobalKey(singleKeySlot)
        : {
            browserKey: singleKeyCode,
            globalKey: singleKeyCode,
            displayName: slotDisplayName(singleKeySlot),
          }
      : null;

  // 단일 통계 요소 선택인 경우의 데이터
  const singleStatId =
    selectedStatElements.length === 1 ? selectedStatElements[0].id : null;
  const singleStatIndex = singleStatId
    ? (statItemPositions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleStatId,
      )
    : -1;
  const singleStatPosition: StatItemPosition | null =
    singleStatIndex >= 0
      ? statItemPositions[selectedKeyType]?.[singleStatIndex] ?? null
      : null;
  const singleGraphId =
    selectedGraphElements.length === 1 ? selectedGraphElements[0].id : null;
  const singleGraphIndex = singleGraphId
    ? (graphItemPositions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleGraphId,
      )
    : -1;
  const singleGraphPosition: GraphItemPosition | null =
    singleGraphIndex >= 0
      ? graphItemPositions[selectedKeyType]?.[singleGraphIndex] ?? null
      : null;
  const singleKnobId =
    selectedKnobElements.length === 1 ? selectedKnobElements[0].id : null;
  const singleKnobIndex = singleKnobId
    ? (knobItemPositions[selectedKeyType] ?? []).findIndex(
        (position) => position.id === singleKnobId,
      )
    : -1;
  const singleKnobPosition: KnobItemPosition | null =
    singleKnobIndex >= 0
      ? knobItemPositions[selectedKeyType]?.[singleKnobIndex] ?? null
      : null;
  const allLayerGroups = useLayerGroupStore((state) => state.layerGroups);
  const layerGroupsForMode = allLayerGroups[selectedKeyType] || [];
  const selectedGroupInfo = (() => {
    if (selectedElements.length < 2) {
      return null;
    }

    const keyModePositions = positions[selectedKeyType] || [];
    const statModePositions = statItemPositions[selectedKeyType] || [];
    const graphModePositions = graphItemPositions[selectedKeyType] || [];
    const knobModePositions = knobItemPositions[selectedKeyType] || [];
    // 플러그인 소속은 현재 모드에 def가 있는 groupId만 유효 (레이어 패널과
    // 동일 규칙)
    const modeGroupIds = new Set(layerGroupsForMode.map((group) => group.id));

    let groupId: string | undefined;

    for (const element of selectedElements) {
      let currentGroupId: string | undefined;
      if (element.type === 'key') {
        currentGroupId = keyModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'stat') {
        currentGroupId = statModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'graph') {
        currentGroupId = graphModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'knob') {
        currentGroupId = knobModePositions.find(
          (position) => position.id === element.id,
        )?.groupId;
      } else if (element.type === 'plugin') {
        const pluginGroupId = pluginElements.find(
          (candidate) => candidate.fullId === element.id,
        )?.groupId;
        currentGroupId =
          pluginGroupId && modeGroupIds.has(pluginGroupId)
            ? pluginGroupId
            : undefined;
      } else {
        return null;
      }

      if (!currentGroupId) return null;
      if (!groupId) {
        groupId = currentGroupId;
      } else if (groupId !== currentGroupId) {
        return null;
      }
    }

    if (!groupId) return null;

    const totalMembers =
      keyModePositions.filter((pos) => pos?.groupId === groupId).length +
      statModePositions.filter((pos) => pos?.groupId === groupId).length +
      graphModePositions.filter((pos) => pos?.groupId === groupId).length +
      knobModePositions.filter((pos) => pos?.groupId === groupId).length +
      pluginElements.filter(
        (el) =>
          isPluginVisibleInMode(el, selectedKeyType) && el.groupId === groupId,
      ).length;

    if (totalMembers < 2 || totalMembers !== selectedElements.length) {
      return null;
    }

    const groupDef = layerGroupsForMode.find((group) => group.id === groupId);
    if (!groupDef) return null;

    return { id: groupDef.id, name: groupDef.name, memberCount: totalMembers };
  })();

  // 로컬 상태 (실시간 편집용)
  const [localState, setLocalState] = useState<
    Partial<KeyPosition> & { dx?: number; dy?: number }
  >({});
  const pluginVisibilityErrorsRef = useRef(new Set<string>());
  const [pluginPanelSettings, setPluginPanelSettings] = useState<
    Record<string, unknown>
  >({});
  const [isPluginSettingsSaving, setIsPluginSettingsSaving] = useState(false);
  const pluginSettingsSavingRef = useRef(false);

  // 레이어 이름 변경 상태
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const renameRequestSignal = usePropertiesPanelStore(
    (state) => state.renameRequestSignal,
  );

  // 이미지 픽커 상태
  const [showImagePicker, setShowImagePicker] = useState(false);
  const imageButtonRef = useRef<HTMLButtonElement>(null);
  const [showGraphImagePicker, setShowGraphImagePicker] = useState(false);
  const graphImageButtonRef = useRef<HTMLButtonElement>(null);
  const [graphClassNameDraft, setGraphClassNameDraft] = useState('');

  // 다중 선택용 이미지 픽커 상태
  const [showBatchImagePicker, setShowBatchImagePicker] = useState(false);
  const batchImageButtonRef = useRef<HTMLButtonElement>(null);

  // 일괄 편집용 컬러 버튼 refs
  const batchNoteColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchGlowColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchBorderColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchCounterFillButtonRef = useRef<HTMLButtonElement>(null);
  const batchCounterStrokeButtonRef = useRef<HTMLButtonElement>(null);

  // 패널 ref (컬러픽커/이미지픽커 위치 기준)
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);

  // 패널 모드 (layer: 레이어 패널, property: 속성 패널)
  // 설정 왕복으로 리마운트돼도 열림 상태와 함께 보존되도록 store에 유지
  const panelMode = usePropertiesPanelStore((state) => state.canvasPanelMode);
  const setPanelMode = usePropertiesPanelStore(
    (state) => state.setCanvasPanelMode,
  );

  // panelMode를 ref로도 유지 (useEffect에서 최신 값 참조용)
  const panelModeRef = useRef(panelMode);
  panelModeRef.current = panelMode;

  // 이전 선택 상태 추적 (선택 해제 감지용)
  const prevHasSelectionRef = useRef(false);

  // 레이어 패널 내부에서 선택이 발생했는지 추적 (모드 전환 방지용)
  const selectionFromLayerPanelRef = useRef(false);

  // 이전 키 타입 추적 (탭 전환 감지용)
  const prevKeyTypeRef = useRef(selectedKeyType);

  // 탭 전환으로 인한 선택 해제인지 추적
  const keyTypeChangedRef = useRef(false);

  // 사용자가 명시적으로 패널을 닫았는지 추적
  const manuallyClosedRef = useRef(false);

  // selectedKeyType 변경 감지 (clearSelection보다 먼저 플래그 설정)
  useEffect(() => {
    if (prevKeyTypeRef.current !== selectedKeyType) {
      keyTypeChangedRef.current = true;
      prevKeyTypeRef.current = selectedKeyType;
    }
  }, [selectedKeyType]);

  const activeTab = usePropertiesPanelStore(
    (state) => state.propertyPanelActiveTab,
  );
  const setActiveTab = usePropertiesPanelStore(
    (state) => state.setPropertyPanelActiveTab,
  );

  // 인-패널 내비게이션 — 피커 서브 페이지 (키는 트리거 사이트별 유니크)
  // activePageKey는 애니메이션 상태, renderPageKey는 마운트 상태 —
  // exit 전환이 끝날 때까지 콘텐츠를 유지해 빈 페이지 슬라이드 방지
  const [activePageKey, setActivePageKey] = useState<string | null>(null);
  const [renderPageKey, setRenderPageKey] = useState<string | null>(null);
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const pageExitTimerRef = useRef<number | null>(null);

  const openPage = useCallback((key: string) => {
    if (pageExitTimerRef.current !== null) {
      window.clearTimeout(pageExitTimerRef.current);
      pageExitTimerRef.current = null;
    }
    setActivePageKey(key);
    setRenderPageKey(key);
  }, []);

  const closePage = useCallback(() => {
    setActivePageKey(null);
    if (pageExitTimerRef.current !== null) {
      window.clearTimeout(pageExitTimerRef.current);
    }
    pageExitTimerRef.current = window.setTimeout(() => {
      pageExitTimerRef.current = null;
      setRenderPageKey(null);
    }, PAGE_EXIT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (pageExitTimerRef.current !== null) {
        window.clearTimeout(pageExitTimerRef.current);
      }
    };
  }, []);

  // 탭/모드/패널 표시 전환 시 서브 페이지 닫기
  useEffect(() => {
    closePage();
  }, [activeTab, panelMode, isPanelVisible, selectedKeyType, closePage]);

  // 패널 본문 종류(단일/배치/플러그인 등)가 바뀌면 트리거 사이트가 함께
  // 사라지므로 서브 페이지 무효화 — 선택 이펙트의 early return 경로 보완
  const panelScopeKey = [
    pluginSettingsPanel ? 'plugin-settings' : 'grid',
    selectedKeyElements.length,
    selectedElements.length,
    selectedPluginElements.length,
    selectedGraphElements.length,
    selectedKnobElements.length,
  ].join('|');
  useEffect(() => {
    closePage();
  }, [panelScopeKey, closePage]);

  // Escape로 서브 페이지 닫기 — 입력 필드 편집·상위 레이어와 경합 방지
  useEffect(() => {
    if (!activePageKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (
        isHTMLElementNode(target) &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      // 모달·포털 메뉴 등 상위 레이어가 열려 있으면 그쪽이 Escape를 소유
      // 모달은 메인 문서에, 팝업 레이어는 패널이 있는 문서에 뜬다 - 둘 다 본다
      if (
        document.querySelector(
          '[data-dmn-modal-backdrop="true"], [data-dmn-popup-layer="true"]',
        ) ||
        (hostDocument !== document &&
          hostDocument.querySelector('[data-dmn-popup-layer="true"]'))
      ) {
        return;
      }
      // 이 레이어가 소비 — 그리드의 선택 해제까지 내려가지 않게
      event.preventDefault();
      event.stopPropagation();
      closePage();
    };
    hostDocument.addEventListener('keydown', onKey, true);
    return () => hostDocument.removeEventListener('keydown', onKey, true);
  }, [activePageKey, closePage, hostDocument]);

  // Escape로 플러그인 설정 세션 취소 - 서브 페이지·모달이 없을 때만
  useEffect(() => {
    if (!pluginSettingsPanel || activePageKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (
        isHTMLElementNode(target) &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      // 모달은 메인 문서에, 팝업 레이어는 패널이 있는 문서에 뜬다 - 둘 다 본다
      if (
        document.querySelector(
          '[data-dmn-modal-backdrop="true"], [data-dmn-popup-layer="true"]',
        ) ||
        (hostDocument !== document &&
          hostDocument.querySelector('[data-dmn-popup-layer="true"]'))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handlePluginSettingsPanelCancelImpl.current();
    };
    hostDocument.addEventListener('keydown', onKey, true);
    return () => hostDocument.removeEventListener('keydown', onKey, true);
  }, [pluginSettingsPanel, activePageKey, hostDocument]);

  // 이전 렌더의 effect가 최신 탭을 덮지 않도록 커밋 직전 재확인
  useEffect(() => {
    const latestTab = usePropertiesPanelStore.getState().propertyPanelActiveTab;
    const latestSelection = useGridSelectionStore.getState().selectedElements;
    if (shouldNormalizePropertyTabToStyle(latestSelection, latestTab)) {
      setActiveTab(TABS.STYLE);
    }
  }, [activeTab, selectedElements, setActiveTab]);

  // 레이어 이름 변경: 현재 선택된 요소의 layerName 가져오기
  const getCurrentLayerName = (): string => {
    if (selectedGroupInfo) return selectedGroupInfo.name || '';
    if (singleKeyPosition) return singleKeyPosition.layerName || '';
    if (singleStatPosition) return singleStatPosition.layerName || '';
    if (singleGraphPosition) return singleGraphPosition.layerName || '';
    if (singleKnobPosition) return singleKnobPosition.layerName || '';
    return '';
  };

  // 레이어 이름 변경: 현재 선택된 요소의 기본 표시 이름 가져오기
  const getCurrentDefaultTitle = (): string => {
    if (selectedGroupInfo) return selectedGroupInfo.name;
    if (singleKeyPosition) {
      return singleKeyInfo?.displayName || singleKeyCode || 'Key';
    }
    if (singleStatPosition) {
      return getStatTypeLabel(singleStatPosition.statType ?? null);
    }
    if (singleGraphPosition) {
      return `${getStatTypeLabel(singleGraphPosition.statType ?? null)} Graph`;
    }
    if (singleKnobPosition) return 'Knob';
    return '';
  };

  const handleGroupRenameCommit = async (groupId: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return;

    const currentGroups = useLayerGroupStore.getState().layerGroups;
    const currentModeGroups = currentGroups[selectedKeyType] || [];
    const currentGroup = currentModeGroups.find(
      (group) => group.id === groupId,
    );
    if (!currentGroup || currentGroup.name === trimmed) return;

    try {
      await renameLayerGroupById(selectedKeyType, groupId, trimmed);
    } catch (error) {
      console.error('Failed to rename group', error);
    }
  };

  // 레이어 이름 변경 시작
  const handleRenameStartImpl = useRef<() => void>(() => {});
  handleRenameStartImpl.current = () => {
    const current = getCurrentLayerName();
    setRenameValue(current || getCurrentDefaultTitle());
    setIsRenaming(true);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  };
  const handleRenameStart = () => {
    handleRenameStartImpl.current();
  };

  // 레이어 이름 변경 커밋
  const handleRenameCommit = async (value: string) => {
    setIsRenaming(false);

    if (selectedGroupInfo) {
      await handleGroupRenameCommit(selectedGroupInfo.id, value);
      return;
    }

    const trimmed = value.trim();
    const defaultTitle = getCurrentDefaultTitle();
    const newLayerName =
      trimmed === defaultTitle || trimmed === '' ? null : trimmed;

    const selectedElement =
      selectedElements.length === 1 ? selectedElements[0] : null;
    const stableTarget =
      selectedElement && selectedElement.type !== 'plugin'
        ? { elementType: selectedElement.type, id: selectedElement.id }
        : null;
    if (stableTarget && isNativeElementId(stableTarget.id)) {
      const target = {
        ...stableTarget,
        patch: { property: 'layerName', value: newLayerName },
      } as const;
      try {
        await patchElementLayerNameById(
          target.elementType,
          target.id,
          target.patch.value,
        );
      } catch (error) {
        console.error('Failed to rename layer', error);
      }
    }
  };

  // 레이어 이름 변경 취소
  const handleRenameCancel = () => {
    renameCancelledRef.current = true;
    setIsRenaming(false);
  };

  // 캔버스 컨텍스트 메뉴에서 rename 요청 시 트리거
  const prevRenameSignalRef = useRef(renameRequestSignal);
  useEffect(() => {
    if (renameRequestSignal !== prevRenameSignalRef.current) {
      prevRenameSignalRef.current = renameRequestSignal;
      if (
        selectedGroupInfo ||
        singleKeyPosition ||
        singleStatPosition ||
        singleGraphPosition ||
        singleKnobPosition
      ) {
        setPanelMode('property');
        handleRenameStart();
      }
    }
  }, [
    renameRequestSignal,
    selectedGroupInfo,
    singleKeyPosition,
    singleStatPosition,
    singleGraphPosition,
    singleKnobPosition,
    setPanelMode,
  ]);

  // 선택이 변경되면 rename 모드 해제
  useEffect(() => {
    setIsRenaming(false);
  }, [selectedElements]);

  // 스크롤 훅 사용
  const { batchScrollRefFor, singleScrollRefFor } = usePanelScroll();

  // 플러그인 패널 스크롤
  const { scrollContainerRef: setPluginScrollRef } = useLenis();

  // 배치 편집용 로컬 ColorPicker 상태
  type BatchPickerTarget =
    | 'noteColor'
    | 'glowColor'
    | 'borderColor'
    | 'fill'
    | 'stroke'
    | null;
  const [batchPickerFor, setBatchPickerFor] = useState<BatchPickerTarget>(null);
  const [batchCounterColorState, setBatchCounterColorState] = useState<
    'idle' | 'active'
  >('idle');
  const effectiveBatchCounterColorState =
    selectedKeyElements.length > 0 ? batchCounterColorState : 'idle';

  useEffect(() => {
    if (selectedKeyElements.length === 0) {
      setBatchCounterColorState('idle');
      setBatchPickerFor((current) =>
        current === 'fill' || current === 'stroke' ? null : current,
      );
    }
  }, [selectedKeyElements.length]);

  const [batchLocalColors, setBatchLocalColors] = useState<{
    noteColor: NoteColor;
    glowColor: NoteColor;
    borderColor: string;
    borderOpacity: number;
    fillIdle: string;
    fillActive: string;
    strokeIdle: string;
    strokeActive: string;
  }>({
    noteColor: '#FFFFFF',
    glowColor: '#FFFFFF',
    borderColor: '#FFFFFF',
    borderOpacity: 100,
    fillIdle: '#FFFFFF',
    fillActive: '#FFFFFF',
    strokeIdle: '#000000',
    strokeActive: '#000000',
  });

  const [batchLocalOpacities, setBatchLocalOpacities] = useState<{
    noteOpacity: number;
    noteOpacityTop: number;
    noteOpacityBottom: number;
    glowOpacity: number;
    glowOpacityTop: number;
    glowOpacityBottom: number;
  }>({
    noteOpacity: 80,
    noteOpacityTop: 80,
    noteOpacityBottom: 80,
    glowOpacity: 70,
    glowOpacityTop: 70,
    glowOpacityBottom: 70,
  });

  // 선택이 변경되면 로컬 상태 초기화
  useEffect(() => {
    const targetPosition = singleKeyPosition || singleStatPosition;
    if (targetPosition) {
      setLocalState({
        dx: targetPosition.dx,
        dy: targetPosition.dy,
        width: targetPosition.width || 60,
        height: targetPosition.height || 60,
      });
    } else {
      setLocalState({});
    }
  }, [singleKeyPosition, singleStatPosition]);

  useEffect(() => {
    setGraphClassNameDraft(singleGraphPosition?.className || '');
  }, [selectedKeyType, singleGraphIndex, singleGraphPosition?.className]);

  useEffect(() => {
    if (pluginSettingsPanel) {
      setPluginPanelSettings(pluginSettingsPanel.settings || {});
      setIsPluginSettingsSaving(false);
      pluginSettingsSavingRef.current = false;
    }
  }, [pluginSettingsPanel]);

  // 선택된 키가 변경될 때 패널 열기/닫기
  useEffect(() => {
    const hasSelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    const hadSelection = prevHasSelectionRef.current;

    if (pluginSettingsPanel) {
      prevHasSelectionRef.current = hasSelection;
      return;
    }

    if (hasSelection) {
      // 열린 패널의 페이지는 sticky — 레이어 목록 표시 중 캔버스 클릭은 선택만 바꾸고
      // 편집(property) 진입은 더블클릭·목록 더블클릭·헤더 토글만 수행한다 (포토샵식)
      if (!hadSelection) {
        manuallyClosedRef.current = false;
        if (!isPanelVisible) {
          setPanelMode('property');
          setIsPanelVisible(true);
        }
      } else if (!isPanelVisible && !manuallyClosedRef.current) {
        setPanelMode('property');
        setIsPanelVisible(true);
      }
    } else if (hadSelection) {
      if (keyTypeChangedRef.current && isPanelVisible) {
        setPanelMode('layer');
      } else if (
        isPanelVisible &&
        (selectionFromLayerPanelRef.current || panelModeRef.current === 'layer')
      ) {
        setPanelMode('layer');
      } else if (!manuallyClosedRef.current) {
        setIsPanelVisible(false);
      }
    }

    prevHasSelectionRef.current = hasSelection;
    selectionFromLayerPanelRef.current = false;
    keyTypeChangedRef.current = false;

    setShowImagePicker(false);
    setShowGraphImagePicker(false);
    setShowBatchImagePicker(false);
    // 배치 색상 draft는 피커를 열 때 첫 요소에서 한 번만 떠 온다.
    // 열린 채로 선택이 바뀌면 옛 대상 색이 남아 다음 드래그가 그 값을 새 선택에 쓴다
    setBatchPickerFor(null);
    closePage();
  }, [
    singleKeyIndex,
    selectedKeyElements.length,
    selectedElements,
    isPanelVisible,
    pluginSettingsPanel,
    setIsPanelVisible,
    setPanelMode,
    closePage,
  ]);

  // 빈 선택 폴백으로 레이어 목록이 표시되는 동안 내부 모드도 layer로 정규화 —
  // property로 남아 있으면 다음 캔버스 클릭이 목록을 건너뛰고 편집으로 점프함
  // (플러그인 설정 패널 종료·설정 왕복 리마운트 경로 포함)
  useEffect(() => {
    if (
      isPanelVisible &&
      !pluginSettingsPanel &&
      panelMode === 'property' &&
      selectedKeyElements.length === 0 &&
      selectedElements.length === 0
    ) {
      setPanelMode('layer');
    }
  }, [
    isPanelVisible,
    pluginSettingsPanel,
    panelMode,
    selectedKeyElements.length,
    selectedElements,
    setPanelMode,
  ]);

  // 다중 선택 시 패널 자동 열기 - 개수는 native+plugin 합산
  useEffect(() => {
    if (
      selectedBatchStyleElements.length + selectedPluginElements.length > 1 &&
      !isPanelVisible &&
      !manuallyClosedRef.current
    ) {
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [
    selectedBatchStyleElements.length,
    selectedPluginElements.length,
    isPanelVisible,
    setIsPanelVisible,
    setPanelMode,
  ]);

  useEffect(() => {
    if (pluginSettingsPanel) {
      manuallyClosedRef.current = false;
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [pluginSettingsPanel, setIsPanelVisible, setPanelMode]);

  // 레이어 뷰가 표시된 상태(선택 없음)에서 그리드 빈 공간 클릭 시 패널 닫기
  // panelMode가 property로 남아 있어도 선택이 없으면 레이어 뷰가 표시되므로 동일하게 닫음.
  // 분리 창일 때는 접힘이 없다 - 여기서 스토어를 닫으면 도킹 뒤 패널이 접힌 채 돌아온다
  useEffect(() => {
    const hasSelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    if (frameVariant === 'window' || !isPanelVisible || hasSelection) {
      return undefined;
    }

    const handleGridClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      const gridContainer = target.closest('[data-grid-container]');
      if (!gridContainer) {
        return;
      }

      if (
        target.closest('[class*="properties-panel"]') ||
        target.closest('[class*="PropertiesPanel"]') ||
        target.closest('.absolute.right-0.top-0.bottom-0')
      ) {
        return;
      }

      if (
        target.closest('[data-key-element]') ||
        target.closest('[data-plugin-element]')
      ) {
        return;
      }

      setIsPanelVisible(false);
    };

    document.addEventListener('mousedown', handleGridClick);
    return () => {
      document.removeEventListener('mousedown', handleGridClick);
    };
  }, [
    frameVariant,
    isPanelVisible,
    selectedKeyElements.length,
    selectedKeyLikeElements.length,
    selectedElements.length,
    setIsPanelVisible,
  ]);

  // ============================================================================
  // 핸들러
  // ============================================================================

  const handleTogglePanelImpl = useRef<() => void>(() => {});
  handleTogglePanelImpl.current = () => {
    const willOpen = !isPanelVisible;

    if (willOpen) {
      manuallyClosedRef.current = false;
      setIsPanelVisible(true);
      const hasSelection = selectedElements.length > 0;
      if (!hasSelection) {
        setPanelMode('layer');
      }
    } else {
      manuallyClosedRef.current = true;
      setIsPanelVisible(false);
      setShowImagePicker(false);
      setShowGraphImagePicker(false);
      setShowBatchImagePicker(false);
    }
  };
  const handleTogglePanel = () => {
    handleTogglePanelImpl.current();
  };

  const handleToggleMode = () => {
    setPanelMode(panelMode === 'layer' ? 'property' : 'layer');
  };

  // 분리 창은 접힘 없음 - 창 자체가 패널이므로 항상 표시
  const showFrame =
    frameVariant === 'window' || isPanelVisible || !!pluginSettingsPanel;

  const pluginDefaultSettings = getDefaultSettings(
    selectedPluginDefinition?.settings,
  );

  const resolvedPluginSettings = {
    ...pluginDefaultSettings,
    ...omitLayoutSettingValues(
      selectedPluginDefinition?.settings,
      selectedPluginElement?.settings || {},
    ),
  };

  const handlePluginPositionXChange = (value: number) => {
    if (!selectedPluginElement) return;
    updatePluginElement(selectedPluginElement.fullId, {
      position: { x: value },
    });
  };

  const handlePluginPositionYChange = (value: number) => {
    if (!selectedPluginElement) return;
    updatePluginElement(selectedPluginElement.fullId, {
      position: { y: value },
    });
  };

  const handlePluginWidthChange = (value: number) => {
    if (!selectedPluginElement) return;
    updatePluginElement(selectedPluginElement.fullId, {
      measuredSize: { width: value },
    });
  };

  const handlePluginHeightChange = (value: number) => {
    if (!selectedPluginElement) return;
    updatePluginElement(selectedPluginElement.fullId, {
      measuredSize: { height: value },
    });
  };

  const handlePluginSettingChange = (key: string, value: unknown) => {
    if (!selectedPluginElement) return;
    updatePluginElement(selectedPluginElement.fullId, {
      settings: {
        [key]: value,
      },
    });
  };

  const handlePluginSettingsPanelChange = (key: string, value: unknown) => {
    if (!pluginSettingsPanel) return;
    setPluginPanelSettings((prev) => {
      const next = { ...prev, [key]: value };
      pluginSettingsPanel.onChange(next);
      return next;
    });
  };

  const handlePluginSettingsPanelConfirm = async () => {
    if (!pluginSettingsPanel || pluginSettingsSavingRef.current) return;
    pluginSettingsSavingRef.current = true;
    setIsPluginSettingsSaving(true);
    try {
      await pluginSettingsPanel.onConfirm(
        pluginPanelSettings,
        pluginSettingsPanel.originalSettings,
      );
      pluginSettingsPanel.resolve(true);
    } catch (error) {
      console.error('[Plugin Settings] Failed to apply settings:', error);
      pluginSettingsPanel.resolve(false);
    } finally {
      pluginSettingsSavingRef.current = false;
      setIsPluginSettingsSaving(false);
      closePluginSettingsPanel();
    }
  };

  const handlePluginSettingsPanelCancelImpl = useRef<() => void>(() => {});
  handlePluginSettingsPanelCancelImpl.current = () => {
    if (!pluginSettingsPanel || pluginSettingsSavingRef.current) return;
    try {
      pluginSettingsPanel.onCancel(pluginSettingsPanel.originalSettings);
    } catch (error) {
      console.error('[Plugin Settings] Failed to cancel settings:', error);
    } finally {
      pluginSettingsPanel.resolve(false);
      closePluginSettingsPanel();
    }
  };
  const handlePluginSettingsPanelCancel = () => {
    handlePluginSettingsPanelCancelImpl.current();
  };

  // 외부(단축키 등)에서 보낸 사이드 패널 토글 요청 처리
  const prevToggleSignalRef = useRef<number>(canvasPanelToggleSignal);
  useEffect(() => {
    if (prevToggleSignalRef.current === canvasPanelToggleSignal) return;
    prevToggleSignalRef.current = canvasPanelToggleSignal;

    if (pluginSettingsPanel) {
      handlePluginSettingsPanelCancel();
      return;
    }
    handleTogglePanel();
  });

  const commitSingleGeometry = (
    type: EditorElementTypeV1,
    id: string,
    field: GeometryField,
    value: number,
  ) => {
    const patch = geometryAxisPatch(field, value);
    const ownsPreviewGesture = type === 'key' || type === 'stat';
    const gestureId = ownsPreviewGesture
      ? editGestureController.activeGestureId() ?? undefined
      : undefined;
    const persisted = commitElementGeometryById(type, id, patch, { gestureId });
    if (ownsPreviewGesture) editGestureController.settleCommit(persisted);
    void persisted.catch((error) => {
      console.error('Failed to update element geometry', error);
    });
  };

  const stableGeometryHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (field: GeometryField, value: number) =>
          commitSingleGeometry(type, id, field, value)
      : undefined;

  const stableGeometryPreviewHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (field: GeometryField, value: number) => {
          const locator = resolveElementById(type, id);
          if (!locator) return;
          editGestureController.preview(
            locator.mode,
            [
              {
                id,
                patch: geometryAxisPatch(field, value),
              },
            ],
            {
              domain:
                type === 'key'
                  ? 'keyPosition'
                  : type === 'stat'
                  ? 'statPosition'
                  : type === 'graph'
                  ? 'graphPosition'
                  : 'knobPosition',
            },
          );
        }
      : undefined;

  const stableElementPropertyCommitHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorElementPropertyPatchV1) => {
          // 분리 창도 즉시 반영을 거친다 - RPC 왕복 전에 값이 되돌아가는 깜빡임 방지
          const persisted = patchElementPropertyById(type, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update element property', error);
          });
        }
      : undefined;

  const stableInactiveImageHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (inactiveImage: string) => {
          const persisted = patchInactiveImageById(type, id, inactiveImage);
          void persisted.catch((error) => {
            console.error('Failed to update inactive image', error);
          });
        }
      : undefined;

  const stableActiveImageHandler = (
    type: 'key' | 'knob',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (activeImage: string) => {
          const persisted = patchActiveImageById(type, id, activeImage);
          void persisted.catch((error) => {
            console.error('Failed to update active image', error);
          });
        }
      : undefined;

  const stableIdleTransparentHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (idleTransparent: boolean) => {
          const persisted = patchIdleTransparentById(type, id, idleTransparent);
          void persisted.catch((error) => {
            console.error('Failed to update idle transparency', error);
          });
        }
      : undefined;

  const stableActiveTransparentHandler = (
    type: 'key' | 'knob',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (activeTransparent: boolean) => {
          const persisted = patchActiveTransparentById(
            type,
            id,
            activeTransparent,
          );
          void persisted.catch((error) => {
            console.error('Failed to update active transparency', error);
          });
        }
      : undefined;

  const stableIdleImageFitHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (idleImageFit: ImageFit) => {
          const persisted = patchIdleImageFitById(type, id, idleImageFit);
          void persisted.catch((error) => {
            console.error('Failed to update idle image fit', error);
          });
        }
      : undefined;

  const stableActiveImageFitHandler = (
    type: 'key' | 'knob',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (activeImageFit: ImageFit) => {
          const persisted = patchActiveImageFitById(type, id, activeImageFit);
          void persisted.catch((error) => {
            console.error('Failed to update active image fit', error);
          });
        }
      : undefined;

  const stableSoundPathHandler = (id: string | undefined) =>
    id && isNativeElementId(id)
      ? (soundPath: string) => {
          const persisted = patchSoundPathById(id, soundPath);
          void persisted.catch((error) => {
            console.error('Failed to update sound path', error);
          });
        }
      : undefined;

  const stableSoundEnabledHandler = (id: string | undefined) =>
    id && isNativeElementId(id)
      ? (soundEnabled: boolean) => {
          const persisted = patchSoundEnabledById(id, soundEnabled);
          void persisted.catch((error) => {
            console.error('Failed to update sound enabled', error);
          });
        }
      : undefined;

  const stableSoundVolumeHandler = (id: string | undefined) =>
    id && isNativeElementId(id)
      ? (soundVolume: number) => {
          const gestureId =
            editGestureController.activeGestureId() ?? undefined;
          const persisted = patchSoundVolumeById(id, soundVolume, {
            gestureId,
          });
          editGestureController.settleCommit(persisted);
          void persisted.catch((error) => {
            console.error('Failed to update sound volume', error);
          });
        }
      : undefined;

  const stableStylePropertyPreviewHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorPreviewStylePropertyPatchV1) =>
          previewSingleStyleProperty(type, id, patch)
      : undefined;

  const stableStylePropertyCommitHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
    options: { settleGesture?: boolean } = {},
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorPreviewStylePropertyPatchV1) => {
          const gestureId = options.settleGesture
            ? editGestureController.activeGestureId() ?? undefined
            : undefined;
          const persisted = patchStylePropertyById(type, id, patch, {
            gestureId,
          });
          if (options.settleGesture) {
            editGestureController.settleCommit(persisted);
          }
          void persisted.catch((error) => {
            console.error('Failed to update style property', error);
          });
        }
      : undefined;

  const stablePaintCommitHandler = (
    type: EditorElementTypeV1,
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorPaintPropertyPatchV1) => {
          const persisted = patchPaintById(type, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update paint', error);
          });
        }
      : undefined;

  const stableFontColorCommitHandler = (
    type: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorFontColorPropertyPatchV1) => {
          const persisted = patchFontColorById(type, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update font color', error);
          });
        }
      : undefined;

  const stableShadowCommitHandler = (
    type: 'key' | 'stat' | 'knob',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorShadowPropertyPatchV1) => {
          const persisted = patchShadowById(type, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update shadow', error);
          });
        }
      : undefined;

  const stableNotePaintCommitHandler = (id: string | undefined) =>
    id && isNativeElementId(id)
      ? (patch: EditorNotePaintPropertyPatchV1) => {
          const gestureId =
            editGestureController.activeGestureId() ?? undefined;
          const persisted = patchNotePaintById(id, patch, { gestureId });
          editGestureController.settleCommit(persisted);
          void persisted.catch((error) => {
            console.error('Failed to update note paint', error);
          });
        }
      : undefined;

  const stableNotePaintPreviewHandler = (id: string | undefined) =>
    id && isNativeElementId(id)
      ? (patch: EditorNotePaintPropertyPatchV1) => {
          const locator = resolveElementById('key', id);
          if (!locator) return;
          editGestureController.preview(
            locator.mode,
            [{ id, patch: projectNotePaintPatch(patch) }],
            { domain: 'keyPosition' },
          );
        }
      : undefined;

  const stableCounterAnimationPresetHandler = (
    elementType: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (intent: EditorCounterAnimationPresetIntentV1) => {
          const persisted = patchCounterAnimationPresetById(
            elementType,
            id,
            intent,
          );
          void persisted.catch((error) => {
            console.error('Failed to update counter animation preset', error);
          });
        }
      : undefined;

  const stableCounterEnabledHandler = (
    elementType: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (enabled: boolean) => {
          // 분리 창도 즉시 반영을 거친다 - 배치 경로와 같은 래퍼를 대상 하나로 재사용
          const persisted = patchCounterEnabledById(elementType, id, enabled);
          void persisted.catch((error) => {
            console.error('Failed to update counter enabled', error);
          });
        }
      : undefined;

  const stableCounterAnimationEnabledHandler = (
    elementType: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (enabled: boolean) => {
          const persisted = patchCounterAnimationEnabledById(
            elementType,
            id,
            enabled,
          );
          void persisted.catch((error) => {
            console.error('Failed to update counter animation enabled', error);
          });
        }
      : undefined;

  const stableCounterLayoutHandler = (
    elementType: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorCounterLayoutPropertyPatchV1) => {
          const persisted = patchCounterLayoutById(elementType, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update counter layout', error);
          });
        }
      : undefined;

  const stableCounterTypographyHandler = (
    elementType: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorCounterTypographyPropertyPatchV1) => {
          const persisted = patchCounterTypographyById(elementType, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update counter typography', error);
          });
        }
      : undefined;

  const stableCounterStrokeHandler = (
    elementType: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorCounterStrokePropertyPatchV1) => {
          const persisted = patchCounterStrokeById(elementType, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update counter stroke', error);
          });
        }
      : undefined;

  const stableCounterFillHandler = (
    elementType: 'key' | 'stat',
    id: string | undefined,
  ) =>
    id && isNativeElementId(id)
      ? (patch: EditorCounterFillPropertyPatchV1) => {
          const persisted = patchCounterFillById(elementType, id, patch);
          void persisted.catch((error) => {
            console.error('Failed to update counter fill', error);
          });
        }
      : undefined;

  // ============================================================================
  // 다중 선택 헬퍼 함수들
  // ============================================================================

  const getSelectedKeysData = () => {
    return selectedKeyLikeElements
      .map((el) => {
        if (el.type === 'key') {
          const index = (positions[selectedKeyType] ?? []).findIndex(
            (position) => position.id === el.id,
          );
          if (index < 0) return null;
          const position = positions[selectedKeyType]?.[index];
          const slot = keyMappings[selectedKeyType]?.[index] ?? null;
          const keyCode = slot != null ? slotCanonical(slot) : null;
          const keyInfo =
            slot != null && keyCode
              ? typeof slot === 'string'
                ? getKeyInfoByGlobalKey(slot)
                : {
                    browserKey: keyCode,
                    globalKey: keyCode,
                    displayName: slotDisplayName(slot),
                  }
              : null;
          return { index, position, keyCode, keyInfo };
        }
        const index = (statItemPositions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return null;
        const position = statItemPositions[selectedKeyType]?.[index];
        const statLabel =
          (position?.displayText || '').trim() ||
          getStatTypeLabel(position?.statType ?? null);
        const keyInfo = { globalKey: statLabel, displayName: statLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter(
        (data): data is NonNullable<typeof data> =>
          data !== null && data.position !== undefined,
      );
  };

  const getSelectedGraphsData = () => {
    return selectedGraphElements
      .map((el) => {
        const index = (graphItemPositions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return null;
        const position = graphItemPositions[selectedKeyType]?.[index];
        const graphLabel = `${getStatTypeLabel(
          position?.statType ?? null,
        )} Graph`;
        const keyInfo = { globalKey: graphLabel, displayName: graphLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter(
        (data): data is NonNullable<typeof data> =>
          data !== null && data.position !== undefined,
      );
  };

  const getSelectedKnobsData = () => {
    return selectedKnobElements
      .map((el) => {
        const index = (knobItemPositions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return null;
        const position = knobItemPositions[selectedKeyType]?.[index];
        const knobLabel = (position?.displayText || '').trim() || 'Knob';
        const keyInfo = { globalKey: knobLabel, displayName: knobLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter(
        (data): data is NonNullable<typeof data> =>
          data !== null && data.position !== undefined,
      );
  };

  const getSelectedBatchStyleData = () => {
    return selectedBatchStyleElements
      .map((el) => {
        if (el.type === 'key') {
          const index = (positions[selectedKeyType] ?? []).findIndex(
            (position) => position.id === el.id,
          );
          if (index < 0) return null;
          const position = positions[selectedKeyType]?.[index];
          const slot = keyMappings[selectedKeyType]?.[index] ?? null;
          const keyCode = slot != null ? slotCanonical(slot) : null;
          const keyInfo =
            slot != null && keyCode
              ? typeof slot === 'string'
                ? getKeyInfoByGlobalKey(slot)
                : {
                    browserKey: keyCode,
                    globalKey: keyCode,
                    displayName: slotDisplayName(slot),
                  }
              : null;
          return { index, position, keyCode, keyInfo };
        }
        if (el.type === 'stat') {
          const index = (statItemPositions[selectedKeyType] ?? []).findIndex(
            (position) => position.id === el.id,
          );
          if (index < 0) return null;
          const position = statItemPositions[selectedKeyType]?.[index];
          const statLabel =
            (position?.displayText || '').trim() ||
            getStatTypeLabel(position?.statType ?? null);
          const keyInfo = { globalKey: statLabel, displayName: statLabel };
          return { index, position, keyCode: null, keyInfo };
        }
        if (el.type === 'knob') {
          const index = (knobItemPositions[selectedKeyType] ?? []).findIndex(
            (position) => position.id === el.id,
          );
          if (index < 0) return null;
          const position = knobItemPositions[selectedKeyType]?.[index];
          const knobLabel = (position?.displayText || '').trim() || 'Knob';
          const keyInfo = { globalKey: knobLabel, displayName: knobLabel };
          return { index, position, keyCode: null, keyInfo };
        }
        const index = (graphItemPositions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return null;
        const position = graphItemPositions[selectedKeyType]?.[index];
        const graphLabel = `${getStatTypeLabel(
          position?.statType ?? null,
        )} Graph`;
        const keyInfo = { globalKey: graphLabel, displayName: graphLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter(
        (data): data is NonNullable<typeof data> =>
          data !== null && data.position !== undefined,
      );
  };

  const getMixedValue = <T,>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    const keysData = getSelectedKeysData();
    if (keysData.length === 0) return { isMixed: false, value: defaultValue };

    const firstValue = getter(keysData[0].position!) ?? defaultValue;
    const isMixed = keysData.some((data) => {
      const val = getter(data.position!) ?? defaultValue;
      if (typeof val === 'object' && typeof firstValue === 'object') {
        return JSON.stringify(val) !== JSON.stringify(firstValue);
      }
      return val !== firstValue;
    });

    return { isMixed, value: firstValue };
  };

  // 게스처를 취소한 직후 로컬 대표값을 되돌릴 때 쓴다. positions는 프리뷰가 합성된
  // 렌더 상태라 취소 직전 클로저로는 되돌아간 값을 읽을 수 없다
  const getMixedValueCanonical = <T,>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    const modePositions = canonicalPositions[selectedKeyType] ?? [];
    const selected = selectedKeyLikeElements.flatMap((el) =>
      el.type === 'key'
        ? modePositions.filter((position) => position.id === el.id)
        : [],
    );
    if (selected.length === 0) return { isMixed: false, value: defaultValue };

    const firstValue = getter(selected[0]) ?? defaultValue;
    const isMixed = selected.some((position) => {
      const val = getter(position) ?? defaultValue;
      if (typeof val === 'object' && typeof firstValue === 'object') {
        return JSON.stringify(val) !== JSON.stringify(firstValue);
      }
      return val !== firstValue;
    });

    return { isMixed, value: firstValue };
  };

  const getMixedValueGraphs = <T,>(
    getter: (pos: GraphItemPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    const graphsData = getSelectedGraphsData();
    if (graphsData.length === 0) return { isMixed: false, value: defaultValue };

    const firstValue = getter(graphsData[0].position!) ?? defaultValue;
    const isMixed = graphsData.some((data) => {
      const val = getter(data.position!) ?? defaultValue;
      if (typeof val === 'object' && typeof firstValue === 'object') {
        return JSON.stringify(val) !== JSON.stringify(firstValue);
      }
      return val !== firstValue;
    });

    return { isMixed, value: firstValue };
  };

  const getMixedValueGraphsAsKey = <T,>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    return getMixedValueGraphs((pos) => getter(pos), defaultValue);
  };

  const getMixedValueKnobs = <T,>(
    getter: (pos: KnobItemPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    const knobsData = getSelectedKnobsData();
    if (knobsData.length === 0) return { isMixed: false, value: defaultValue };

    const firstValue = getter(knobsData[0].position!) ?? defaultValue;
    const isMixed = knobsData.some((data) => {
      const val = getter(data.position!) ?? defaultValue;
      if (typeof val === 'object' && typeof firstValue === 'object') {
        return JSON.stringify(val) !== JSON.stringify(firstValue);
      }
      return val !== firstValue;
    });

    return { isMixed, value: firstValue };
  };

  const getMixedValueKnobsAsKey = <T,>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    return getMixedValueKnobs((pos) => getter(pos), defaultValue);
  };

  const getMixedValueBatch = <T,>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    const batchData = getSelectedBatchStyleData();
    if (batchData.length === 0) return { isMixed: false, value: defaultValue };

    const firstValue =
      getter(batchData[0].position as KeyPosition) ?? defaultValue;
    const isMixed = batchData.some((data) => {
      const val = getter(data.position as KeyPosition) ?? defaultValue;
      if (typeof val === 'object' && typeof firstValue === 'object') {
        return JSON.stringify(val) !== JSON.stringify(firstValue);
      }
      return val !== firstValue;
    });

    return { isMixed, value: firstValue };
  };

  // ============================================================================
  // 다중 선택 일괄 편집 핸들러 (훅 사용)
  // ============================================================================

  const {
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchSpacing,
    handleBatchSpacingPreview,
    handleBatchSpacingCommit,
    getBatchSpacingValue,
    handleBatchResize,
    handleBatchResizePreview,
  } = useBatchHandlers({
    selectedKeyLikeElements: selectedBatchStyleElements as {
      type: 'key' | 'stat' | 'graph' | 'knob';
      id: string;
      index?: number;
    }[],
    keyPositions: positions,
    statPositions: statItemPositions,
    graphPositions: graphItemPositions,
    selectedKeyType,
    knobPositions: knobItemPositions,
    pluginLayoutElements: stablePluginGeometryElements,
    onStableGeometryPreview: (operation) => {
      if (!stableBatchGeometryTargets) return;
      if (stablePluginGeometryElements === null) return;
      const targetsByKey = new Map<
        string,
        {
          type: EditorElementTypeV1;
          position: KeyPosition;
        }
      >();
      for (const target of stableBatchGeometryTargets) {
        const locator = resolveElementById(target.type, target.id);
        if (!locator || locator.mode !== selectedKeyType) return;
        const record =
          target.type === 'key'
            ? positions
            : target.type === 'stat'
            ? statItemPositions
            : target.type === 'graph'
            ? graphItemPositions
            : knobItemPositions;
        const position = record[selectedKeyType]?.[locator.index];
        if (!position || position.id !== target.id) return;
        targetsByKey.set(`${target.type}:${target.id}`, {
          type: target.type,
          position,
        });
      }
      // 커밋과 같은 기준선을 쓰도록 plan 입력에는 plugin bounds를 합치되,
      // preview 반영은 native 4 domain 전용 - 플러그인은 dial 중 정지,
      // 커밋 시 착지 (v1). resize는 native 전용이라 plugin 미합류
      const pluginPlanInputs =
        operation.kind === 'resize' ? [] : stablePluginGeometryElements;
      const plan = computeBatchGeometryPlan(
        [
          ...[...targetsByKey].map(([key, { position }]) => ({
            key,
            x: position.dx,
            y: position.dy,
            width: position.width,
            height: position.height,
          })),
          ...pluginPlanInputs.map((element) => ({
            key: `plugin:${element.fullId}`,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
          })),
        ],
        operation,
      );
      if (!plan) return;
      const byType = new Map<
        EditorElementTypeV1,
        Array<{ id: string; patch: Record<string, unknown> }>
      >();
      for (const update of plan.updates) {
        if (update.key.startsWith('plugin:')) continue;
        const target = targetsByKey.get(update.key);
        if (!target) return;
        const entries = byType.get(target.type) ?? [];
        entries.push({
          id: target.position.id,
          patch: update.patch,
        });
        byType.set(target.type, entries);
      }
      for (const [type, entries] of byType) {
        editGestureController.preview(selectedKeyType, entries, {
          domain:
            type === 'key'
              ? 'keyPosition'
              : type === 'stat'
              ? 'statPosition'
              : type === 'graph'
              ? 'graphPosition'
              : 'knobPosition',
        });
      }
    },
    onStableGeometryCommit: (operation, options) => {
      if (!stableBatchGeometryTargets) return;
      // plugin 대상 미해결 상태의 커밋은 fail-closed
      if (stablePluginGeometryTargets === null) return;
      const descriptor: BatchGeometryDescriptor = {
        mode: selectedKeyType,
        targets: stableBatchGeometryTargets,
        operation,
      };
      const gestureId =
        options?.gestureId ??
        (operation.kind === 'resize'
          ? editGestureController.activeGestureId() ?? undefined
          : undefined);
      // 크기 일괄은 native 전용 - 플러그인 크기는 content-driven
      const pluginTargets =
        operation.kind === 'resize' ? [] : stablePluginGeometryTargets;
      const commit =
        pluginTargets.length > 0
          ? commitMixedBatchGeometry(descriptor, pluginTargets, {
              ...(gestureId ? { gestureId } : {}),
            })
          : commitBatchGeometryByIds(descriptor, {
              ...(gestureId ? { gestureId } : {}),
            });
      if (operation.kind === 'resize' || operation.kind === 'spacing') {
        editGestureController.settleCommit(commit);
      }
      void commit.catch((error) => {
        console.error('Failed to commit batch geometry', error);
      });
    },
  });

  // 단일 키 업데이트 객체를 받는다. 아래 get*Patch 헬퍼가 태그 유니온으로 바꿔 wire에 올린다
  const handleBatchElementPropertyCommit = (
    patch: BatchElementPropertyUpdate,
  ) => {
    const fontStylePatch = getFontStylePatch(patch);
    const fontFamilyPatch = getFontFamilyPatch(patch);
    const useInlineStyles = getUseInlineStylesPatch(patch);
    if (!fontStylePatch && !fontFamilyPatch && useInlineStyles === null) return;
    const targets = selectedBatchStyleElements.map((element) => ({
      elementType: element.type as EditorElementTypeV1,
      id: element.id,
    }));
    if (
      targets.length === 0 ||
      targets.some((target) => !isNativeElementId(target.id))
    )
      return;
    const commit =
      fontStylePatch !== null
        ? patchFontStyleByTargets(targets, fontStylePatch)
        : fontFamilyPatch !== null
        ? patchFontFamilyByTargets(targets, fontFamilyPatch)
        : patchUseInlineStylesByTargets(targets, useInlineStyles!);
    void commit.catch((error) => {
      console.error('Failed to batch update element style property', error);
    });
  };

  const handleBatchNoteElementPropertyCommit = (
    patch: BatchElementPropertyUpdate,
  ) => {
    const notePatch = getNotePropertyPatch(patch);
    if (!notePatch) return;
    const ids = selectedKeyElements.map((element) => element.id);
    if (ids.length === 0 || ids.some((id) => !isNativeElementId(id))) return;
    const commit = patchNotePropertiesByIds(ids, notePatch);
    void commit.catch((error) => {
      console.error('Failed to batch update note property', error);
    });
  };

  // NOTE 탭은 "키"에만 적용되어야 함
  const getSelectedKeyOnlyPositions = () => {
    return selectedKeyElements
      .map((el) => {
        const index = (positions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === el.id,
        );
        const position = positions[selectedKeyType]?.[index];
        return position ? { index, position } : null;
      })
      .filter(
        (
          v,
        ): v is {
          index: number;
          position: CanonicalKeyPosition;
        } => v !== null,
      );
  };

  // 눌림 가능(키·노브) 집계 — active 상태 표시가 통계만 제외하고 노브는 포함
  const getSelectedActiveCapablePositions = (): KeyPosition[] => {
    const keyData = getSelectedKeyOnlyPositions().map(
      ({ position }) => position,
    );
    const knobData = selectedKnobElements
      .map((el) =>
        knobItemPositions?.[selectedKeyType]?.find(
          (position) => position.id === el.id,
        ),
      )
      .filter((v): v is CanonicalKnobItemPosition => v != null);
    return [...keyData, ...knobData];
  };

  const getMixedValueActiveCapable = <T,>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    const data = getSelectedActiveCapablePositions();
    if (data.length === 0) return { isMixed: false, value: defaultValue };

    const firstValue = getter(data[0]) ?? defaultValue;
    const isMixed = data.some((position) => {
      const val = getter(position) ?? defaultValue;
      if (typeof val === 'object' && typeof firstValue === 'object') {
        return JSON.stringify(val) !== JSON.stringify(firstValue);
      }
      return val !== firstValue;
    });

    return { isMixed, value: firstValue };
  };

  const getMixedValueKeysOnly = <T,>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } => {
    const data = getSelectedKeyOnlyPositions();
    if (data.length === 0) return { isMixed: false, value: defaultValue };

    const firstValue = getter(data[0].position) ?? defaultValue;
    const isMixed = data.some(({ position }) => {
      const val = getter(position) ?? defaultValue;
      if (typeof val === 'object' && typeof firstValue === 'object') {
        return JSON.stringify(val) !== JSON.stringify(firstValue);
      }
      return val !== firstValue;
    });

    return { isMixed, value: firstValue };
  };

  const handleGraphBatchSharedSetting = (
    updates: Partial<GraphItemPosition>,
  ) => {
    const updateKeys = Object.keys(updates);
    const graphType = updates.graphType;
    const graphColor = updates.graphColor;
    const runtimePatch = getGraphRuntimePropertyPatch(updates);
    const stableGraphIds = selectedGraphElements.map((element) => element.id);
    if (
      updateKeys.length === 1 &&
      updateKeys[0] === 'graphType' &&
      (graphType === 'line' || graphType === 'bar') &&
      stableGraphIds.length > 0 &&
      stableGraphIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const commit = patchGraphTypesByIds(stableGraphIds, graphType);
      void commit.catch((error) => {
        console.error('Failed to batch update graph type', error);
      });
      return;
    }
    if (
      runtimePatch &&
      stableGraphIds.length > 0 &&
      stableGraphIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const commit = patchGraphPropertiesByIds(stableGraphIds, runtimePatch);
      void commit.catch((error) => {
        console.error('Failed to batch update graph property', error);
      });
      return;
    }
    if (
      updateKeys.length === 1 &&
      updateKeys[0] === 'graphColor' &&
      typeof graphColor === 'string' &&
      stableGraphIds.length > 0 &&
      stableGraphIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const commit = patchGraphColorsByIds(stableGraphIds, graphColor);
      void commit.catch((error) => {
        console.error('Failed to batch update graph color', error);
      });
      return;
    }
    reportElementOpSkipped(
      'batch graph property (unsupported payload or invalid target)',
    );
  };

  const handleKnobBatchSharedSetting = (updates: Partial<KnobItemPosition>) => {
    const runtimePatch = getKnobRuntimePropertyPatch(updates);
    const stableKnobIds = selectedKnobElements.map((element) => element.id);
    if (
      runtimePatch &&
      stableKnobIds.length > 0 &&
      stableKnobIds.every((id) => id.length > 0 && isNativeElementId(id))
    ) {
      const commit = patchKnobPropertiesByIds(stableKnobIds, runtimePatch);
      void commit.catch((error) => {
        console.error('Failed to batch update knob property', error);
      });
      return;
    }
    reportElementOpSkipped(
      'batch knob property (unsupported payload or invalid target)',
    );
  };

  // 정규화 진단 리포터 — 플러그인·키당 1회만 기록, empty-state 단락 경로의
  // hasRenderableSettings에도 동일 리포터를 전달해 로깅 누락 방지
  const reportPluginNormalizationError = (
    pluginId: string,
    key: string,
    error: unknown,
    kind: SettingsNormalizationErrorKind,
  ) => {
    const errorKey = `${pluginId}:${key}`;
    if (pluginVisibilityErrorsRef.current.has(errorKey)) return;
    pluginVisibilityErrorsRef.current.add(errorKey);
    const message =
      kind === 'unsupported-type'
        ? `Unsupported setting type for "${key}"`
        : `Failed to evaluate visibility for setting "${key}"`;
    console.error(`[Plugin ${pluginId}] ${message}:`, error);
  };

  const renderPluginSettingsForm = (
    schema: Record<string, PluginSettingSchema> | undefined,
    values: Record<string, unknown>,
    messages: PluginMessages | undefined,
    pluginId: string,
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
  ) => {
    const sections = normalizeSettingsSections(
      schema,
      values,
      (key, error, kind) =>
        reportPluginNormalizationError(pluginId, key, error, kind),
    );
    if (!sections.some((section) => section.renderVisible)) {
      return (
        <p className="text-fg-faint text-body text-center">
          {t('propertiesPanel.pluginNoSettings') || '설정할 항목이 없습니다.'}
        </p>
      );
    }

    const translate = (key?: string, fallback?: string) => {
      if (!key) return fallback || '';
      return translatePluginMessage({
        messages,
        locale,
        key,
        fallback,
      });
    };

    const getPluginInputWidth = (
      type: 'string' | 'number',
      value: unknown,
    ): string => {
      if (type === 'number') {
        return '60px';
      }
      const strVal = String(value ?? '');
      if (strVal.length <= 4) return '60px';
      if (strVal.length <= 10) return '100px';
      return '200px';
    };

    const renderEntry = (
      key: string,
      schemaValue: Exclude<PluginSettingSchema, { type: 'section' }>,
      renderVisible: boolean,
    ) => {
      if (!renderVisible) return null;
      const rawValue =
        values[key] !== undefined ? values[key] : schemaValue.default;
      const labelText = translate(schemaValue.label, schemaValue.label);
      const placeholderText =
        typeof schemaValue.placeholder === 'string'
          ? translate(schemaValue.placeholder, schemaValue.placeholder)
          : schemaValue.placeholder;

      let control: React.ReactNode = null;

      if (schemaValue.type === 'boolean') {
        const checked = !!rawValue;
        control = (
          <Checkbox
            commitStrategy="after-paint"
            checked={checked}
            onChange={() => onChange(key, !checked)}
          />
        );
      } else if (schemaValue.type === 'color') {
        const colorValue =
          typeof rawValue === 'string'
            ? rawValue
            : (schemaValue.default as string) || '#FFFFFF';
        control = (
          <ColorInput
            value={colorValue}
            onChange={(color) => onChange(key, color)}
            colorId={`${colorIdPrefix}-${key}`}
            panelElement={panelElement}
            solidOnly={true}
          />
        );
      } else if (schemaValue.type === 'number') {
        const numericValue = Number(rawValue);
        const normalizedValue = Number.isFinite(numericValue)
          ? numericValue
          : typeof schemaValue.default === 'number'
          ? schemaValue.default
          : 0;
        // step 값에서 소수 자릿수 자동 추론
        const stepStr =
          schemaValue.step != null ? String(schemaValue.step) : '';
        const dotIdx = stepStr.indexOf('.');
        const hasDecimal = dotIdx !== -1;
        const decimalScale = hasDecimal ? stepStr.length - dotIdx - 1 : 0;
        control = (
          <NumberInput
            value={normalizedValue}
            min={schemaValue.min}
            max={schemaValue.max}
            allowDecimal={hasDecimal}
            decimalScale={decimalScale}
            step={schemaValue.step}
            onChange={(nextValue) => onChange(key, nextValue)}
            width={getPluginInputWidth('number', rawValue)}
          />
        );
      } else if (schemaValue.type === 'string') {
        const stringValue =
          rawValue === undefined || rawValue === null ? '' : String(rawValue);
        control = (
          <TextInput
            value={stringValue}
            onChange={(nextValue) => onChange(key, nextValue)}
            placeholder={
              typeof placeholderText === 'string' ? placeholderText : undefined
            }
            width={getPluginInputWidth('string', stringValue)}
          />
        );
      } else if (schemaValue.type === 'select') {
        const options = (schemaValue.options || []).map((option) => ({
          label: translate(option.label, option.label),
          value: String(option.value),
        }));
        const optionMap = new Map(
          (schemaValue.options || []).map((option) => [
            String(option.value),
            option.value,
          ]),
        );
        const selectedValue = optionMap.has(String(rawValue))
          ? String(rawValue)
          : String(schemaValue.default ?? '');
        control = (
          <Dropdown
            commitStrategy="after-paint"
            value={selectedValue}
            options={options}
            placeholder={
              typeof placeholderText === 'string' &&
              placeholderText.trim().length > 0
                ? placeholderText
                : undefined
            }
            onChange={(nextValue) =>
              onChange(key, optionMap.get(nextValue) ?? nextValue)
            }
          />
        );
      }

      if (schemaValue.type === 'boolean') {
        return (
          <div
            key={key}
            className="flex justify-between items-center w-full min-h-[32px]"
          >
            <p className="text-fg-muted text-label">{labelText}</p>
            <div className="flex items-center gap-[10.5px]">{control}</div>
          </div>
        );
      }

      return (
        <PropertyRow key={key} label={labelText}>
          {control}
        </PropertyRow>
      );
    };

    return (
      // 대상이 바뀌면 폼을 통째로 새로 만든다. 설정 key만으로 묶으면 같은 스키마를 가진
      // 다른 요소로 선택이 옮겨가도 입력 인스턴스가 살아남아, 편집 중이던 값이
      // 새 대상에 확정되거나 취소가 옛 값을 새 대상에 쓴다.
      // 포커스를 유지한 채 선택만 바뀌는 경로가 분리 패널 selection sync에 있다
      <div key={colorIdPrefix} className="flex flex-col gap-[12px]">
        {sections.map((section) => {
          if (!section.renderVisible) return null;
          const sectionLabel = translate(section.label, section.label);
          return (
            <div
              key={section.key ?? 'implicit'}
              className="flex flex-col gap-[6px]"
            >
              {section.label && (
                <p className="text-fg-faint text-body text-left px-[2px]">
                  {sectionLabel}
                </p>
              )}
              <PropertySection>
                {section.entries.map((entry) =>
                  renderEntry(entry.key, entry.schema, entry.renderVisible),
                )}
              </PropertySection>
            </div>
          );
        })}
      </div>
    );
  };

  // 배치 편집용 interactiveRefs
  const batchColorPickerInteractiveRefs = [
    batchNoteColorButtonRef,
    batchGlowColorButtonRef,
    batchBorderColorButtonRef,
    batchCounterFillButtonRef,
    batchCounterStrokeButtonRef,
  ];

  // 배치 피커 토글
  const handleBatchPickerToggle = (target: BatchPickerTarget) => {
    if (target && target !== batchPickerFor) {
      const keysData = getSelectedKeysData();
      const keyOnly = getSelectedKeyOnlyPositions();
      const isNoteTabPicker =
        target === 'noteColor' ||
        target === 'glowColor' ||
        target === 'borderColor';
      const isCounterPicker = target === 'fill' || target === 'stroke';
      const firstPos =
        (isNoteTabPicker || isCounterPicker) && keyOnly.length > 0
          ? keyOnly[0].position
          : keysData[0]?.position;
      if (firstPos) {
        const counterSettings = normalizeCounterSettings(firstPos.counter);
        setBatchLocalColors({
          noteColor: (() => {
            const nc = firstPos.noteColor;
            if (
              nc &&
              typeof nc === 'object' &&
              'type' in nc &&
              nc.type === 'gradient'
            ) {
              return { type: 'gradient', top: nc.top, bottom: nc.bottom };
            }
            return typeof nc === 'string' ? nc : '#FFFFFF';
          })(),
          glowColor: (() => {
            const gc = firstPos.noteGlowColor ?? firstPos.noteColor;
            if (
              gc &&
              typeof gc === 'object' &&
              'type' in gc &&
              gc.type === 'gradient'
            ) {
              return { type: 'gradient', top: gc.top, bottom: gc.bottom };
            }
            return typeof gc === 'string' ? gc : '#FFFFFF';
          })(),
          borderColor: firstPos.noteBorderColor ?? '#FFFFFF',
          borderOpacity: firstPos.noteBorderOpacity ?? 100,
          fillIdle: counterSettings.fill.idle,
          fillActive: counterSettings.fill.active,
          strokeIdle: counterSettings.stroke.idle,
          strokeActive: counterSettings.stroke.active,
        });
        const noteOpacity =
          typeof firstPos.noteOpacity === 'number' ? firstPos.noteOpacity : 80;
        const glowOpacity =
          typeof firstPos.noteGlowOpacity === 'number'
            ? firstPos.noteGlowOpacity
            : 70;
        setBatchLocalOpacities({
          noteOpacity,
          noteOpacityTop: firstPos.noteOpacityTop ?? noteOpacity,
          noteOpacityBottom: firstPos.noteOpacityBottom ?? noteOpacity,
          glowOpacity,
          glowOpacityTop: firstPos.noteGlowOpacityTop ?? glowOpacity,
          glowOpacityBottom: firstPos.noteGlowOpacityBottom ?? glowOpacity,
        });
      }
    }
    setBatchPickerFor((prev) => (prev === target ? null : target));
  };

  const getBatchPickerColor = (): NoteColor | string => {
    switch (batchPickerFor) {
      case 'noteColor':
        return batchLocalColors.noteColor;
      case 'glowColor':
        return batchLocalColors.glowColor;
      case 'borderColor':
        return hexWithAlphaPercent(
          batchLocalColors.borderColor,
          batchLocalColors.borderOpacity,
        );
      case 'fill':
        return effectiveBatchCounterColorState === 'active'
          ? batchLocalColors.fillActive
          : batchLocalColors.fillIdle;
      case 'stroke':
        return effectiveBatchCounterColorState === 'active'
          ? batchLocalColors.strokeActive
          : batchLocalColors.strokeIdle;
      default:
        return '#FFFFFF';
    }
  };

  const getBatchPickerRef = () => {
    switch (batchPickerFor) {
      case 'noteColor':
        return batchNoteColorButtonRef;
      case 'glowColor':
        return batchGlowColorButtonRef;
      case 'borderColor':
        return batchBorderColorButtonRef;
      case 'fill':
        return batchCounterFillButtonRef;
      case 'stroke':
        return batchCounterStrokeButtonRef;
      default:
        return null;
    }
  };

  const handleBatchPickerColorChange = (newColor: NoteColor) => {
    if (!batchPickerFor) return;

    if (batchPickerFor === 'noteColor' || batchPickerFor === 'glowColor') {
      setBatchLocalColors((prev) => ({
        ...prev,
        [batchPickerFor]: newColor,
      }));
    } else if (batchPickerFor === 'borderColor') {
      const raw = typeof newColor === 'string' ? newColor : undefined;
      setBatchLocalColors((prev) => ({
        ...prev,
        borderColor: toRgbHexColor(raw),
        borderOpacity: parseAlphaPercent(raw, prev.borderOpacity),
      }));
    } else if (batchPickerFor === 'fill') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        effectiveBatchCounterColorState === 'active'
          ? 'fillActive'
          : 'fillIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    } else if (batchPickerFor === 'stroke') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        effectiveBatchCounterColorState === 'active'
          ? 'strokeActive'
          : 'strokeIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    }
  };

  const completeBatchPickerColorChange = (
    newColor: NoteColor,
    onNotePaintCommit?: (patch: EditorNotePaintPropertyPatchV1) => void,
  ) => {
    if (!batchPickerFor) return;

    if (batchPickerFor === 'noteColor' || batchPickerFor === 'glowColor') {
      setBatchLocalColors((prev) => ({
        ...prev,
        [batchPickerFor]: newColor,
      }));
    } else if (batchPickerFor === 'borderColor') {
      const raw = typeof newColor === 'string' ? newColor : undefined;
      setBatchLocalColors((prev) => ({
        ...prev,
        borderColor: toRgbHexColor(raw),
        borderOpacity: parseAlphaPercent(raw, prev.borderOpacity),
      }));
    } else if (batchPickerFor === 'fill') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        effectiveBatchCounterColorState === 'active'
          ? 'fillActive'
          : 'fillIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    } else if (batchPickerFor === 'stroke') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        effectiveBatchCounterColorState === 'active'
          ? 'strokeActive'
          : 'strokeIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    }

    if (batchPickerFor === 'noteColor') {
      onNotePaintCommit?.({
        property: 'notePaint',
        value: { color: newColor },
      });
    } else if (batchPickerFor === 'glowColor') {
      onNotePaintCommit?.({
        property: 'noteGlowPaint',
        value: { color: newColor },
      });
    } else if (batchPickerFor === 'borderColor') {
      // noteBorderColor는 #RRGGBB 계약 — 색은 hex로 정규화(이슈 #73), 알파는 noteBorderOpacity로 분리
      const raw = typeof newColor === 'string' ? newColor : undefined;
      const solidColor = toRgbHexColor(raw);
      const opacity = parseAlphaPercent(raw, batchLocalColors.borderOpacity);
      onNotePaintCommit?.({
        property: 'noteBorderPaint',
        value: { color: solidColor, opacity },
      });
    } else if (batchPickerFor === 'fill') {
      return;
    } else if (batchPickerFor === 'stroke') {
      const strokeColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const active = effectiveBatchCounterColorState === 'active';
      const targets = [
        ...selectedKeyElements.map(({ id }) => ({
          elementType: 'key' as const,
          id,
        })),
        ...(active
          ? []
          : selectedStatElements.map(({ id }) => ({
              elementType: 'stat' as const,
              id,
            }))),
      ];
      const stableTargets =
        targets.length > 0 &&
        targets.every(({ id }) => id.length > 0 && isNativeElementId(id));
      if (!stableTargets) return;
      const patch: EditorCounterStrokePropertyPatchV1 = active
        ? { property: 'counterStrokeActive', value: strokeColor }
        : { property: 'counterStrokeIdle', value: strokeColor };
      const persisted = patchCounterStrokeByTargets(targets, patch);
      void persisted.catch((error) => {
        console.error('Failed to update batch counter stroke', error);
      });
    }
  };
  const handleBatchPickerColorChangeComplete = (newColor: NoteColor) =>
    completeBatchPickerColorChange(newColor);
  const handleBatchNotePickerColorChangeComplete = (
    newColor: NoteColor,
    onNotePaintCommit: (patch: EditorNotePaintPropertyPatchV1) => void,
  ) => completeBatchPickerColorChange(newColor, onNotePaintCommit);
  const handleBatchFillPickerColorChangeComplete = (
    newColor: string,
    onCounterFillCommit: (patch: EditorCounterFillPropertyPatchV1) => void,
  ) => {
    const key =
      effectiveBatchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';
    setBatchLocalColors((prev) => ({ ...prev, [key]: newColor }));
    onCounterFillCommit(
      effectiveBatchCounterColorState === 'active'
        ? { property: 'counterFillActive', value: { color: newColor } }
        : { property: 'counterFillIdle', value: { color: newColor } },
    );
  };

  // ============================================================================
  // 렌더링
  // ============================================================================

  // 캔버스 선택에 묶인 구상 패널 - 프레임(글래스) 안의 루트 페이지 콘텐츠
  // 혼합 선택(네이티브+플러그인)은 총요소 기준으로 native 구성별 배치 패널에,
  // 플러그인 단독 다중은 경량 기하 배치 패널에 라우트
  const renderSelectionPanelBody = () => {
    const selectionTotalCount =
      selectedBatchStyleElements.length + selectedPluginElements.length;
    const route = resolveSelectionPanelRoute({
      keyLikeCount: selectedKeyLikeElements.length,
      graphCount: selectedGraphElements.length,
      knobCount: selectedKnobElements.length,
      pluginCount: selectedPluginElements.length,
      hasSingleKeyPosition: !!singleKeyPosition,
      hasSingleStatPosition: !!singleStatPosition,
      hasSingleGraphPosition: !!singleGraphPosition,
      hasSingleKnobPosition: !!singleKnobPosition,
    });

    // 다중 선택인 경우 (키/통계 포함, 또는 그래프+노브 혼합)
    if (route.kind === 'batchKeyLike') {
      return (
        <BatchKeyLikePanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedBatchStyleElements={selectedBatchStyleElements}
          selectedKeyElements={selectedKeyElements}
          selectedStatElements={selectedStatElements}
          selectedGraphElements={selectedGraphElements}
          selectedKnobElements={selectedKnobElements}
          selectedKeyLikeElements={selectedKeyLikeElements}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingPreview={handleBatchSpacingPreview}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          handleBatchResize={handleBatchResize}
          handleBatchResizePreview={handleBatchResizePreview}
          onElementPropertyCommit={handleBatchElementPropertyCommit}
          onNoteElementPropertyCommit={handleBatchNoteElementPropertyCommit}
          handleGraphBatchSharedSetting={handleGraphBatchSharedSetting}
          getMixedValue={getMixedValue}
          getMixedValueCanonical={getMixedValueCanonical}
          getMixedValueBatch={getMixedValueBatch}
          getMixedValueGraphs={getMixedValueGraphs}
          getMixedValueGraphsAsKey={getMixedValueGraphsAsKey}
          getMixedValueKeysOnly={getMixedValueKeysOnly}
          getMixedValueActiveCapable={getMixedValueActiveCapable}
          getSelectedKeysData={getSelectedKeysData}
          getSelectedGraphsData={getSelectedGraphsData}
          getSelectedBatchStyleData={getSelectedBatchStyleData}
          getSelectedKeyOnlyPositions={getSelectedKeyOnlyPositions}
          batchScrollRefFor={batchScrollRefFor}
          batchNoteColorButtonRef={batchNoteColorButtonRef}
          batchGlowColorButtonRef={batchGlowColorButtonRef}
          batchBorderColorButtonRef={batchBorderColorButtonRef}
          batchCounterFillButtonRef={batchCounterFillButtonRef}
          batchCounterStrokeButtonRef={batchCounterStrokeButtonRef}
          batchImageButtonRef={batchImageButtonRef}
          showBatchImagePicker={showBatchImagePicker}
          setShowBatchImagePicker={setShowBatchImagePicker}
          batchPickerFor={batchPickerFor}
          setBatchPickerFor={setBatchPickerFor}
          batchCounterColorState={effectiveBatchCounterColorState}
          setBatchCounterColorState={setBatchCounterColorState}
          batchLocalColors={batchLocalColors}
          setBatchLocalColors={setBatchLocalColors}
          batchLocalOpacities={batchLocalOpacities}
          setBatchLocalOpacities={setBatchLocalOpacities}
          handleBatchPickerToggle={handleBatchPickerToggle}
          handleBatchPickerColorChange={handleBatchPickerColorChange}
          handleBatchPickerColorChangeComplete={
            handleBatchPickerColorChangeComplete
          }
          handleBatchNotePickerColorChangeComplete={
            handleBatchNotePickerColorChangeComplete
          }
          handleBatchFillPickerColorChangeComplete={
            handleBatchFillPickerColorChangeComplete
          }
          getBatchPickerColor={getBatchPickerColor}
          getBatchPickerRef={getBatchPickerRef}
          batchColorPickerInteractiveRefs={batchColorPickerInteractiveRefs}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          selectedKeyType={selectedKeyType}
          t={t}
        />
      );
    }

    // 다중 선택인 경우 (노브 요소만)
    if (route.kind === 'batchKnobOnly') {
      return (
        <BatchKnobOnlyPanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedKnobElements={selectedKnobElements}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingPreview={handleBatchSpacingPreview}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          handleBatchResize={handleBatchResize}
          handleBatchResizePreview={handleBatchResizePreview}
          onElementPropertyCommit={handleBatchElementPropertyCommit}
          handleKnobBatchSharedSetting={handleKnobBatchSharedSetting}
          getMixedValueKnobs={getMixedValueKnobs}
          getMixedValueKnobsAsKey={getMixedValueKnobsAsKey}
          getSelectedKnobsData={getSelectedKnobsData}
          batchScrollRefFor={batchScrollRefFor}
          batchImageButtonRef={batchImageButtonRef}
          showBatchImagePicker={showBatchImagePicker}
          setShowBatchImagePicker={setShowBatchImagePicker}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          selectedKeyType={selectedKeyType}
          t={t}
        />
      );
    }

    // 다중 선택인 경우 (그래프 요소만)
    if (route.kind === 'batchGraphOnly') {
      return (
        <BatchGraphOnlyPanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedGraphElements={selectedGraphElements}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingPreview={handleBatchSpacingPreview}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          handleBatchResize={handleBatchResize}
          handleBatchResizePreview={handleBatchResizePreview}
          onElementPropertyCommit={handleBatchElementPropertyCommit}
          handleGraphBatchSharedSetting={handleGraphBatchSharedSetting}
          getMixedValueGraphs={getMixedValueGraphs}
          getMixedValueGraphsAsKey={getMixedValueGraphsAsKey}
          getSelectedGraphsData={getSelectedGraphsData}
          batchScrollRefFor={batchScrollRefFor}
          batchImageButtonRef={batchImageButtonRef}
          showBatchImagePicker={showBatchImagePicker}
          setShowBatchImagePicker={setShowBatchImagePicker}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          selectedKeyType={selectedKeyType}
          t={t}
        />
      );
    }

    // 플러그인 단독 다중 선택 - 정렬·분배·간격만 있는 경량 기하 배치
    if (route.kind === 'pluginBatch') {
      return (
        <BatchPluginOnlyPanel
          setPanelElement={setPanelElement}
          totalCount={selectionTotalCount}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          handleBatchAlign={handleBatchAlign}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={handleBatchSpacing}
          handleBatchSpacingCommit={handleBatchSpacingCommit}
          getBatchSpacingValue={getBatchSpacingValue}
          batchScrollRefFor={batchScrollRefFor}
          t={t}
        />
      );
    }

    // 플러그인 요소만 선택된 경우
    if (route.kind === 'plugin') {
      const pluginTitle =
        selectedPluginDefinition?.name ||
        selectedPluginElement?.definitionId ||
        t('propertiesPanel.pluginElement') ||
        'Plugin';

      return (
        <PluginSelectionPanel
          setPanelElement={setPanelElement}
          pluginTitle={pluginTitle}
          setPluginScrollRef={setPluginScrollRef}
          isPluginResizable={isPluginResizable}
          selectedPluginElement={selectedPluginElement}
          pluginDisplaySize={pluginDisplaySize}
          handlePluginPositionXChange={handlePluginPositionXChange}
          handlePluginPositionYChange={handlePluginPositionYChange}
          handlePluginWidthChange={handlePluginWidthChange}
          handlePluginHeightChange={handlePluginHeightChange}
          hasSinglePluginSelection={hasSinglePluginSelection}
          showModalHint={showModalHint}
          showSettings={showSettings}
          renderPluginSettingsForm={renderPluginSettingsForm}
          reportNormalizationError={reportPluginNormalizationError}
          selectedPluginDefinition={selectedPluginDefinition}
          resolvedPluginSettings={resolvedPluginSettings}
          handlePluginSettingChange={handlePluginSettingChange}
          t={t}
        />
      );
    }

    // 단일 노브 요소 선택인 경우
    if (route.kind === 'singleKnob' && singleKnobPosition) {
      return (
        <SingleKnobPanel
          setPanelElement={setPanelElement}
          singleKnobPosition={singleKnobPosition}
          selectedKeyType={selectedKeyType}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          onElementPropertyCommit={stableElementPropertyCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onInactiveImageCommit={stableInactiveImageHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onActiveImageCommit={stableActiveImageHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onIdleTransparentCommit={stableIdleTransparentHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onActiveTransparentCommit={stableActiveTransparentHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onIdleImageFitCommit={stableIdleImageFitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onActiveImageFitCommit={stableActiveImageFitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          handleGeometryCommit={stableGeometryHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onStylePropertyCommit={stableStylePropertyCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onPaintCommit={stablePaintCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          onShadowCommit={stableShadowCommitHandler(
            'knob',
            selectedKnobElements[0]?.id,
          )}
          singleScrollRefFor={singleScrollRefFor}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          t={t}
        />
      );
    }

    // 단일 그래프 요소 선택인 경우
    if (route.kind === 'singleGraph' && singleGraphPosition) {
      return (
        <SingleGraphPanel
          setPanelElement={setPanelElement}
          singleGraphPosition={singleGraphPosition}
          selectedKeyType={selectedKeyType}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          onElementPropertyCommit={stableElementPropertyCommitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onInactiveImageCommit={stableInactiveImageHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onIdleTransparentCommit={stableIdleTransparentHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onIdleImageFitCommit={stableIdleImageFitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          handleGeometryCommit={stableGeometryHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onStylePropertyCommit={stableStylePropertyCommitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          onPaintCommit={stablePaintCommitHandler(
            'graph',
            selectedGraphElements[0]?.id,
          )}
          singleScrollRefFor={singleScrollRefFor}
          showGraphImagePicker={showGraphImagePicker}
          setShowGraphImagePicker={setShowGraphImagePicker}
          graphImageButtonRef={graphImageButtonRef}
          graphClassNameDraft={graphClassNameDraft}
          setGraphClassNameDraft={setGraphClassNameDraft}
          panelElement={panelElement}
          useCustomCSS={useCustomCSS}
          t={t}
        />
      );
    }

    // 단일 키/통계 요소 선택인 경우
    const isSingleStat = !singleKeyPosition && !!singleStatPosition;
    const isSingleKey = !!singleKeyPosition;
    if (route.kind !== 'singleKeyStat' || (!isSingleKey && !isSingleStat)) {
      return null;
    }

    return (
      <SingleKeyStatPanel
        setPanelElement={setPanelElement}
        isSingleStat={isSingleStat}
        isSingleKey={isSingleKey}
        singleKeyIndex={singleKeyIndex}
        singleStatIndex={singleStatIndex}
        singleKeyPosition={singleKeyPosition}
        singleStatPosition={singleStatPosition}
        singleKeyCode={singleKeyCode}
        singleKeySlot={singleKeySlot}
        singleKeyInfo={singleKeyInfo}
        selectedKeyType={selectedKeyType}
        isRenaming={isRenaming}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameCancelledRef={renameCancelledRef}
        handleRenameCommit={handleRenameCommit}
        handleRenameCancel={handleRenameCancel}
        handleRenameStart={handleRenameStart}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onKeyMappingChange={onKeyMappingChange}
        localState={localState}
        setLocalState={setLocalState}
        handleGeometryPreview={stableGeometryPreviewHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onElementPropertyCommit={stableElementPropertyCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onInactiveImageCommit={stableInactiveImageHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onActiveImageCommit={
          isSingleKey
            ? stableActiveImageHandler('key', selectedKeyElements[0]?.id)
            : undefined
        }
        onIdleTransparentCommit={stableIdleTransparentHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onActiveTransparentCommit={
          isSingleKey
            ? stableActiveTransparentHandler('key', selectedKeyElements[0]?.id)
            : undefined
        }
        onIdleImageFitCommit={stableIdleImageFitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onActiveImageFitCommit={
          isSingleKey
            ? stableActiveImageFitHandler('key', selectedKeyElements[0]?.id)
            : undefined
        }
        onSoundPathCommit={
          isSingleKey
            ? stableSoundPathHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onSoundEnabledCommit={
          isSingleKey
            ? stableSoundEnabledHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onSoundVolumeCommit={
          isSingleKey
            ? stableSoundVolumeHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onStylePropertyPreview={stableStylePropertyPreviewHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onStylePropertyCommit={stableStylePropertyCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
          { settleGesture: true },
        )}
        onPaintCommit={stablePaintCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onFontColorCommit={stableFontColorCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onShadowCommit={stableShadowCommitHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onNotePaintCommit={
          isSingleKey
            ? stableNotePaintCommitHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onNotePaintPreview={
          isSingleKey
            ? stableNotePaintPreviewHandler(selectedKeyElements[0]?.id)
            : undefined
        }
        onCounterAnimationPresetCommit={stableCounterAnimationPresetHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterEnabledCommit={stableCounterEnabledHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterAnimationEnabledCommit={stableCounterAnimationEnabledHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterLayoutCommit={stableCounterLayoutHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterTypographyCommit={stableCounterTypographyHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterStrokeCommit={stableCounterStrokeHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        onCounterFillCommit={stableCounterFillHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        handleGeometryCommit={stableGeometryHandler(
          isSingleStat ? 'stat' : 'key',
          isSingleStat
            ? selectedStatElements[0]?.id
            : selectedKeyElements[0]?.id,
        )}
        showImagePicker={showImagePicker}
        setShowImagePicker={setShowImagePicker}
        imageButtonRef={imageButtonRef}
        panelElement={panelElement}
        useCustomCSS={useCustomCSS}
        singleScrollRefFor={singleScrollRefFor}
        t={t}
      />
    );
  };

  // 캔버스 선택에 묶이지 않는 뷰는 EditSessionScope 밖에 둔다.
  // 플러그인 설정 세션의 색상 피커까지 대상 전환 억제를 걸면, 무관한 캔버스 선택
  // 변경 뒤에 피커가 닫힐 때 멀쩡한 색 편집이 폐기된다
  const renderPanelBody = () => {
    if (pluginSettingsPanel) {
      return (
        <PluginSettingsPanelView
          setPanelElement={setPanelElement}
          pluginSettingsPanel={pluginSettingsPanel}
          pluginPanelSettings={pluginPanelSettings}
          handlePluginSettingsPanelChange={handlePluginSettingsPanelChange}
          handlePluginSettingsPanelConfirm={handlePluginSettingsPanelConfirm}
          isSaving={isPluginSettingsSaving}
          setPluginScrollRef={setPluginScrollRef}
          renderPluginSettingsForm={renderPluginSettingsForm}
          reportNormalizationError={reportPluginNormalizationError}
          t={t}
        />
      );
    }

    // 레이어 모드일 때는 선택 여부와 관계없이 레이어 패널 표시
    if (panelMode === 'layer') {
      return (
        <LayerPanel
          onSwitchToProperty={handleToggleMode}
          onSelectionFromPanel={() => {
            selectionFromLayerPanelRef.current = true;
          }}
        />
      );
    }

    // 선택된 키 요소가 없으면 레이어 패널 표시
    if (selectedKeyElements.length === 0 && selectedElements.length === 0) {
      return (
        <LayerPanel
          onSwitchToProperty={handleToggleMode}
          onSelectionFromPanel={() => {
            selectionFromLayerPanelRef.current = true;
          }}
        />
      );
    }

    return <EditSessionScope>{renderSelectionPanelBody()}</EditSessionScope>;
  };

  // 열림/닫힘과 무관하게 항상 렌더되는 지속 토글 — 리마운트 없이 모프 전환
  const toggleButton = (
    <PanelToggleButton
      open={showFrame}
      onClick={
        pluginSettingsPanel
          ? handlePluginSettingsPanelCancel
          : handleTogglePanel
      }
    />
  );

  const panelBody = showFrame ? renderPanelBody() : null;

  // 헤더 액션 기준 모드 — panelMode가 property여도 선택이 없으면 레이어 뷰가 표시됨
  const hasAnySelection =
    selectedKeyElements.length > 0 || selectedElements.length > 0;
  const displayedPanelMode =
    panelMode === 'layer' || !hasAnySelection ? 'layer' : 'property';

  // 프레임이 글래스를 소유하고, 루트/서브 페이지가 그 안에서 슬라이드 전환.
  // 열림/닫힘 모두 같은 프래그먼트 구조 유지 — 토글 버튼이 리마운트되면
  // 호버 상태가 끊겨 아이콘이 깜빡임
  return (
    <>
      {showFrame && panelBody && (
        <PanelNavProvider
          value={{
            activePageKey,
            renderPageKey,
            openPage,
            closePage,
            pageHost,
          }}
        >
          <div
            data-dmn-panel-frame=""
            className={
              frameVariant === 'window'
                ? WINDOW_PANEL_FRAME_CLASS
                : SIDE_PANEL_FRAME_CLASS
            }
          >
            {/* inert — 슬라이드 아웃된 레이어를 키보드 탭 순회·접근성 트리에서 제외 */}
            <div
              className="dmn-panel-page"
              data-page-depth="root"
              data-active={activePageKey ? 'false' : 'true'}
              inert={activePageKey ? true : undefined}
            >
              {panelBody}
              <PanelHeaderActions
                mode={displayedPanelMode}
                modeToggleHidden={!!pluginSettingsPanel}
                modeToggleDisabled={
                  displayedPanelMode === 'layer' && !hasAnySelection
                }
                onToggleMode={handleToggleMode}
                detachAction={detachAction}
                onDetachAction={onDetachAction}
                edgeAligned={frameVariant === 'window'}
              />
            </div>
            <div
              ref={setPageHost}
              className="dmn-panel-page"
              data-page-depth="sub"
              data-active={activePageKey ? 'true' : 'false'}
              inert={activePageKey ? undefined : true}
            />
          </div>
        </PanelNavProvider>
      )}
      {frameVariant !== 'window' && toggleButton}
    </>
  );
};

export default PropertiesPanel;
