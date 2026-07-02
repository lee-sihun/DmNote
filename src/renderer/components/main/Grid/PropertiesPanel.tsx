import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { toRgbHexColor } from '@utils/color/colorUtils';
import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition, StatItemType } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type {
  PluginSettingSchema,
  PluginMessages,
  RawInputPayload,
} from '@src/types/plugin/api';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/key/keys';
import { useLenis } from '@hooks/useLenis';

// 분리된 컴포넌트들 및 훅
import {
  TABS,
  TabType,
  PropertyRow,
  NumberInput,
  ColorInput,
  TextInput,
  SectionDivider,
  SidebarToggleIcon,
  LayerPanel,
  PluginSelectionPanel,
  SingleGraphPanel,
  SingleKnobPanel,
  SingleKeyStatPanel,
  BatchKeyLikePanel,
  BatchGraphOnlyPanel,
  BatchKnobOnlyPanel,
  PluginSettingsPanelView,
  useBatchHandlers,
  usePanelScroll,
} from './PropertiesPanel/index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import type { NoteColor } from '@src/types/key/keys';

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

// ============================================================================
// 메인 컴포넌트 Props
// ============================================================================

interface PropertiesPanelProps {
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyBatchUpdate?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
    options?: { skipHistory?: boolean },
  ) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyBatchPreview?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
  ) => void;
  onKeyMappingChange?: (index: number, newKey: string) => void;
}

// ============================================================================
// 메인 컴포넌트
// ============================================================================

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  onPositionChange,
  onKeyUpdate,
  onKeyBatchUpdate,
  onKeyPreview,
  onKeyBatchPreview,
  onKeyMappingChange,
}) => {
  const { t, i18n } = useTranslation();
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const pushHistoryState = useHistoryStore((state) => state.pushState);
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const positions = useKeyStore((state) => state.positions);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const statItemPositions = useStatItemStore((state) => state.positions);
  const graphItemPositions = useGraphItemStore((state) => state.positions);
  const { useCustomCSS } = useSettingsStore();
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );
  const pluginDefinitions = usePluginDisplayElementStore(
    (state) => state.definitions,
  );
  const updatePluginElement = usePluginDisplayElementStore(
    (state) => state.updateElement,
  );
  const pluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.pluginSettingsPanel,
  );
  const closePluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.closePluginSettingsPanel,
  );
  const isPanelVisible = usePropertiesPanelStore(
    (state) => state.isCanvasPanelOpen,
  );
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

  const selectedPluginDefinition = (() => {
    if (!selectedPluginElement?.definitionId) return null;
    return pluginDefinitions.get(selectedPluginElement.definitionId) || null;
  })();

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
  const singleKeyIndex =
    selectedKeyElements.length === 1 ? selectedKeyElements[0].index : null;
  const singleKeyPosition =
    singleKeyIndex !== null
      ? positions[selectedKeyType]?.[singleKeyIndex]
      : null;
  const singleKeyCode =
    singleKeyIndex !== null
      ? keyMappings[selectedKeyType]?.[singleKeyIndex]
      : null;
  const singleKeyInfo = singleKeyCode
    ? getKeyInfoByGlobalKey(singleKeyCode)
    : null;

  // 단일 통계 요소 선택인 경우의 데이터
  const singleStatIndex =
    selectedStatElements.length === 1 ? selectedStatElements[0].index : null;
  const singleStatPosition: StatItemPosition | null =
    singleStatIndex !== null
      ? statItemPositions[selectedKeyType]?.[singleStatIndex] ?? null
      : null;
  const singleGraphIndex =
    selectedGraphElements.length === 1 ? selectedGraphElements[0].index : null;
  const singleGraphPosition: GraphItemPosition | null =
    singleGraphIndex !== null
      ? graphItemPositions[selectedKeyType]?.[singleGraphIndex] ?? null
      : null;
  const knobItemPositions = useKnobItemStore((state) => state.positions);
  const singleKnobIndex =
    selectedKnobElements.length === 1 ? selectedKnobElements[0].index : null;
  const singleKnobPosition: KnobItemPosition | null =
    singleKnobIndex != null
      ? knobItemPositions[selectedKeyType]?.[singleKnobIndex] ?? null
      : null;
  const allLayerGroups = useLayerGroupStore((state) => state.layerGroups);
  const layerGroupsForMode = allLayerGroups[selectedKeyType] || [];
  const selectedGroupInfo = (() => {
    if (selectedElements.length < 2 || selectedPluginElements.length > 0) {
      return null;
    }

    const keyModePositions = positions[selectedKeyType] || [];
    const statModePositions = statItemPositions[selectedKeyType] || [];
    const graphModePositions = graphItemPositions[selectedKeyType] || [];
    const knobModePositions = knobItemPositions[selectedKeyType] || [];

    let groupId: string | undefined;

    for (const element of selectedElements) {
      let currentGroupId: string | undefined;
      if (element.type === 'key' && typeof element.index === 'number') {
        currentGroupId = keyModePositions[element.index]?.groupId;
      } else if (element.type === 'stat' && typeof element.index === 'number') {
        currentGroupId = statModePositions[element.index]?.groupId;
      } else if (
        element.type === 'graph' &&
        typeof element.index === 'number'
      ) {
        currentGroupId = graphModePositions[element.index]?.groupId;
      } else if (element.type === 'knob' && typeof element.index === 'number') {
        currentGroupId = knobModePositions[element.index]?.groupId;
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
      knobModePositions.filter((pos) => pos?.groupId === groupId).length;

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
  const pluginSettingsHistoryRef = useRef<string | null>(null);
  const pluginTransformHistoryRef = useRef<string | null>(null);

  // preview가 store를 직접 변경하므로, commit이 아닌 preview 시작 시 히스토리 저장
  const statPreviewHistorySavedRef = useRef(false);
  const graphPreviewHistorySavedRef = useRef(false);
  const knobPreviewHistorySavedRef = useRef(false);
  const [pluginPanelSettings, setPluginPanelSettings] = useState<
    Record<string, unknown>
  >({});

  // 레이어 이름 변경 상태
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const renameRequestSignal = usePropertiesPanelStore(
    (state) => state.renameRequestSignal,
  );

  // 키 리스닝 상태
  const [isListening, setIsListening] = useState(false);
  const justAssignedRef = useRef(false);
  const listeningFlagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
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

  // 패널 모드 상태 (layer: 레이어 패널, property: 속성 패널)
  const [panelMode, setPanelMode] = useState<'layer' | 'property'>('property');

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

  // 탭 상태
  const [activeTab, setActiveTab] = useState<TabType>(TABS.STYLE);

  // 통계 요소 선택 시 NOTE 탭 숨김 처리
  useEffect(() => {
    if (
      selectedKeyLikeElements.length === 0 ||
      selectedPluginElements.length > 0
    ) {
      return;
    }
    const shouldHideNote =
      selectedStatElements.length > 0 && selectedKeyElements.length === 0;
    if (shouldHideNote && activeTab === TABS.NOTE) {
      setActiveTab(TABS.STYLE);
    }
  }, [
    activeTab,
    selectedKeyLikeElements.length,
    selectedPluginElements.length,
    selectedStatElements.length,
    selectedKeyElements.length,
  ]);

  // 그래프만 선택된 상태에서는 STYLE 탭만 사용
  useEffect(() => {
    const graphOnlySelection =
      selectedGraphElements.length > 0 &&
      selectedKeyLikeElements.length === 0 &&
      selectedPluginElements.length === 0;
    if (graphOnlySelection && activeTab !== TABS.STYLE) {
      setActiveTab(TABS.STYLE);
    }
  }, [
    activeTab,
    selectedGraphElements.length,
    selectedKeyLikeElements.length,
    selectedPluginElements.length,
  ]);

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

    const { keyMappings: km, positions: pos } = useKeyStore.getState();
    const statPos = useStatItemStore.getState().positions;
    const graphPos = useGraphItemStore.getState().positions;
    const pluginEls = usePluginDisplayElementStore.getState().elements;

    useHistoryStore.getState().pushState({
      keyMappings: km,
      positions: pos,
      statPositions: statPos,
      graphPositions: graphPos,
      pluginElements: pluginEls,
      layerGroups: currentGroups,
    });

    const updated = {
      ...currentGroups,
      [selectedKeyType]: currentModeGroups.map((group) =>
        group.id === groupId ? { ...group, name: trimmed } : group,
      ),
    };

    useLayerGroupStore.getState().setLayerGroups(updated);
    try {
      await window.api.layerGroups.update(updated);
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
      trimmed === defaultTitle || trimmed === '' ? undefined : trimmed;

    if (singleKeyIndex !== null && singleKeyPosition) {
      onKeyUpdate({
        index: singleKeyIndex,
        layerName: newLayerName,
      } as Partial<KeyPosition> & { index: number });
    } else if (singleStatIndex !== null && singleStatPosition) {
      const mode = selectedKeyType;
      const current = useStatItemStore.getState().positions;
      const list = current[mode] || [];
      if (list[singleStatIndex]) {
        const nextList = list.map((pos, i) =>
          i === singleStatIndex ? { ...pos, layerName: newLayerName } : pos,
        );
        const nextPositions = { ...current, [mode]: nextList };
        useStatItemStore.getState().setLocalUpdateInProgress(true);
        useStatItemStore.getState().setPositions(nextPositions);
        try {
          await window.api.statItems.updatePositions(nextPositions);
        } finally {
          useStatItemStore.getState().setLocalUpdateInProgress(false);
        }
      }
    } else if (singleGraphIndex !== null && singleGraphPosition) {
      const mode = selectedKeyType;
      const current = useGraphItemStore.getState().positions;
      const list = current[mode] || [];
      if (list[singleGraphIndex]) {
        const nextList = list.map((pos, i) =>
          i === singleGraphIndex ? { ...pos, layerName: newLayerName } : pos,
        );
        const nextPositions = { ...current, [mode]: nextList };
        useGraphItemStore.getState().setLocalUpdateInProgress(true);
        useGraphItemStore.getState().setPositions(nextPositions);
        try {
          await window.api.graphItems.updatePositions(nextPositions);
        } finally {
          useGraphItemStore.getState().setLocalUpdateInProgress(false);
        }
      }
    } else if (singleKnobIndex !== null && singleKnobPosition) {
      const mode = selectedKeyType;
      const current = useKnobItemStore.getState().positions;
      const list = current[mode] || [];
      if (list[singleKnobIndex]) {
        const nextList = list.map((pos, i) =>
          i === singleKnobIndex ? { ...pos, layerName: newLayerName } : pos,
        );
        const nextPositions = { ...current, [mode]: nextList };
        useKnobItemStore.getState().setLocalUpdateInProgress(true);
        useKnobItemStore.getState().setPositions(nextPositions);
        try {
          await window.api.knobItems.updatePositions(nextPositions);
          window.api.bridge.sendTo('overlay', 'knobPositions:sync', {
            positions: nextPositions,
          });
        } finally {
          useKnobItemStore.getState().setLocalUpdateInProgress(false);
        }
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
  ]);

  // 선택이 변경되면 rename 모드 해제
  useEffect(() => {
    setIsRenaming(false);
  }, [selectedElements]);

  // 스크롤 훅 사용
  const {
    batchScrollRefFor,
    batchThumbRefFor,
    singleScrollRefFor,
    singleThumbRefFor,
  } = usePanelScroll(activeTab, selectedElements.length);

  // 플러그인 패널 스크롤
  const pluginScrollElementRef = useRef<HTMLDivElement | null>(null);
  const pluginThumbRef = useRef<HTMLDivElement | null>(null);

  const calculatePluginThumb = (el: HTMLDivElement) => {
    const { scrollTop, scrollHeight, clientHeight } = el;
    const canScroll = scrollHeight > clientHeight + 1;
    if (!canScroll) return { top: 0, height: 0, visible: false };

    const minThumbHeight = 16;
    const height = Math.max(
      minThumbHeight,
      (clientHeight / scrollHeight) * clientHeight,
    );
    const maxTop = clientHeight - height;
    const top =
      maxTop <= 0 ? 0 : (scrollTop / (scrollHeight - clientHeight)) * maxTop;

    return { top, height, visible: true };
  };

  const updatePluginThumbDOM = () => {
    if (!pluginThumbRef.current || !pluginScrollElementRef.current) return;
    const thumb = calculatePluginThumb(pluginScrollElementRef.current);
    pluginThumbRef.current.style.top = `${thumb.top}px`;
    pluginThumbRef.current.style.height = `${thumb.height}px`;
    pluginThumbRef.current.style.display = thumb.visible ? 'block' : 'none';
  };

  const { scrollContainerRef: pluginLenisRef } = useLenis({
    onScroll: updatePluginThumbDOM,
  });

  const setPluginScrollRef = (node: HTMLDivElement | null) => {
    pluginScrollElementRef.current = node;
    pluginLenisRef(node);
  };

  const setPluginThumbRef = (node: HTMLDivElement | null) => {
    pluginThumbRef.current = node;
  };

  useEffect(() => {
    const hasPluginPanel =
      !!pluginSettingsPanel ||
      (selectedPluginElements.length > 0 &&
        selectedKeyLikeElements.length === 0 &&
        selectedGraphElements.length === 0);

    if (!hasPluginPanel) return;

    const raf = requestAnimationFrame(() => {
      updatePluginThumbDOM();
    });
    return () => cancelAnimationFrame(raf);
  });

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

  const [batchLocalColors, setBatchLocalColors] = useState<{
    noteColor: NoteColor;
    glowColor: NoteColor;
    borderColor: string;
    fillIdle: string;
    fillActive: string;
    strokeIdle: string;
    strokeActive: string;
  }>({
    noteColor: '#FFFFFF',
    glowColor: '#FFFFFF',
    borderColor: '#FFFFFF',
    fillIdle: '#FFFFFF',
    fillActive: '#FFFFFF',
    strokeIdle: '#000000',
    strokeActive: '#000000',
  });

  const [batchLocalOpacities, setBatchLocalOpacities] = useState<{
    noteOpacity: number;
    glowOpacity: number;
  }>({
    noteOpacity: 80,
    glowOpacity: 70,
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
    }
  }, [pluginSettingsPanel]);

  useEffect(() => {
    pluginSettingsHistoryRef.current = null;
    pluginTransformHistoryRef.current = null;
  }, [selectedPluginElement?.fullId]);

  // 선택된 키가 변경될 때 패널 열기/닫기
  useEffect(() => {
    const hasSelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    const hadSelection = prevHasSelectionRef.current;

    const skipFromKeyboard =
      useGridSelectionStore.getState()._skipPanelModeSwitch;

    if (pluginSettingsPanel) {
      prevHasSelectionRef.current = hasSelection;
      if (skipFromKeyboard)
        useGridSelectionStore.getState().setSkipPanelModeSwitch(false);
      return;
    }

    if (hasSelection) {
      if (!hadSelection) {
        manuallyClosedRef.current = false;
        if (!isPanelVisible) {
          setPanelMode('property');
          setIsPanelVisible(true);
        } else if (
          panelModeRef.current === 'layer' &&
          !selectionFromLayerPanelRef.current &&
          !skipFromKeyboard
        ) {
          setPanelMode('property');
        }
      } else if (!isPanelVisible && !manuallyClosedRef.current) {
        setPanelMode('property');
        setIsPanelVisible(true);
      } else if (
        panelModeRef.current === 'layer' &&
        !selectionFromLayerPanelRef.current &&
        !skipFromKeyboard &&
        isPanelVisible
      ) {
        setPanelMode('property');
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
    if (skipFromKeyboard)
      useGridSelectionStore.getState().setSkipPanelModeSwitch(false);

    setShowImagePicker(false);
    setShowGraphImagePicker(false);
    setShowBatchImagePicker(false);
    setIsListening(false);
  }, [
    singleKeyIndex,
    selectedKeyElements.length,
    selectedElements,
    isPanelVisible,
    pluginSettingsPanel,
    setIsPanelVisible,
  ]);

  // 언마운트 시 키보드 플래그 오염 방지
  useEffect(() => {
    return () => {
      useGridSelectionStore.getState().setSkipPanelModeSwitch(false);
    };
  }, []);

  // 다중 선택 시 패널 자동 열기
  useEffect(() => {
    if (
      selectedBatchStyleElements.length > 1 &&
      !isPanelVisible &&
      !manuallyClosedRef.current
    ) {
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [selectedBatchStyleElements.length, isPanelVisible, setIsPanelVisible]);

  useEffect(() => {
    if (pluginSettingsPanel) {
      manuallyClosedRef.current = false;
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [pluginSettingsPanel, setIsPanelVisible]);

  // 레이어 패널이 열려있고 선택이 없는 상태에서 그리드 빈 공간 클릭 시 패널 닫기
  useEffect(() => {
    const hasSelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    if (panelMode !== 'layer' || !isPanelVisible || hasSelection) {
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
    isPanelVisible,
    selectedKeyElements.length,
    selectedKeyLikeElements.length,
    selectedElements.length,
    panelMode,
    setIsPanelVisible,
  ]);

  // 키 리스닝 상태를 전역으로 노출
  useEffect(() => {
    if (listeningFlagTimerRef.current !== null) {
      clearTimeout(listeningFlagTimerRef.current);
      listeningFlagTimerRef.current = null;
    }

    if (isListening) {
      window.__dmn_isKeyListening = true;
    } else {
      listeningFlagTimerRef.current = setTimeout(() => {
        window.__dmn_isKeyListening = false;
        listeningFlagTimerRef.current = null;
      }, 150);
    }

    return () => {
      if (listeningFlagTimerRef.current !== null) {
        clearTimeout(listeningFlagTimerRef.current);
        listeningFlagTimerRef.current = null;
      }
    };
  }, [isListening]);

  // 컴포넌트 언마운트 시 반드시 플래그 해제
  useEffect(() => {
    return () => {
      window.__dmn_isKeyListening = false;
      if (listeningFlagTimerRef.current !== null) {
        clearTimeout(listeningFlagTimerRef.current);
        listeningFlagTimerRef.current = null;
      }
    };
  }, []);

  // 키 리스닝 중 브라우저 기본 동작 차단
  useEffect(() => {
    if (!isListening) return undefined;

    const blockKeyboardEvents = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const blockMouseEvents = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const blockContextMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', blockKeyboardEvents, true);
    window.addEventListener('keyup', blockKeyboardEvents, true);
    window.addEventListener('keypress', blockKeyboardEvents, true);
    window.addEventListener('mousedown', blockMouseEvents, true);
    window.addEventListener('contextmenu', blockContextMenu, true);

    return () => {
      window.removeEventListener('keydown', blockKeyboardEvents, true);
      window.removeEventListener('keyup', blockKeyboardEvents, true);
      window.removeEventListener('keypress', blockKeyboardEvents, true);
      window.removeEventListener('mousedown', blockMouseEvents, true);
      window.removeEventListener('contextmenu', blockContextMenu, true);
    };
  }, [isListening]);

  // 키 리스닝 effect
  useEffect(() => {
    if (!isListening) return undefined;
    if (typeof window === 'undefined' || !window.api?.keys?.onRawInput) {
      return undefined;
    }

    const unsubscribe = window.api.keys.onRawInput(
      (payload: RawInputPayload) => {
        if (!payload || payload.state !== 'DOWN') return;
        const targetLabel =
          payload.label ||
          (Array.isArray(payload.labels) ? payload.labels[0] : null);
        if (!targetLabel) return;

        const info = getKeyInfoByGlobalKey(targetLabel);

        justAssignedRef.current = true;
        setTimeout(() => {
          justAssignedRef.current = false;
        }, 100);

        setIsListening(false);

        if (singleKeyIndex !== null && onKeyMappingChange) {
          onKeyMappingChange(singleKeyIndex, info.globalKey);
        }
      },
    );

    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.error('Failed to unsubscribe raw input listener', error);
      }
    };
  }, [isListening, singleKeyIndex, onKeyMappingChange]);

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
    setPanelMode((prev) => (prev === 'layer' ? 'property' : 'layer'));
  };

  const pluginDefaultSettings = (() => {
    const defaults: Record<string, unknown> = {};
    if (selectedPluginDefinition?.settings) {
      Object.entries(selectedPluginDefinition.settings).forEach(
        ([key, schema]) => {
          const schemaValue = schema as PluginSettingSchema;
          if (schemaValue.type === 'divider') return;
          defaults[key] = schemaValue.default;
        },
      );
    }
    return defaults;
  })();

  const resolvedPluginSettings = {
    ...pluginDefaultSettings,
    ...(selectedPluginElement?.settings || {}),
  };

  const ensurePluginSettingsHistory = () => {
    if (!selectedPluginElement) return;
    if (pluginSettingsHistoryRef.current === selectedPluginElement.fullId) {
      return;
    }
    pushHistoryState({
      keyMappings,
      positions,
      statPositions: statItemPositions,
      graphPositions: graphItemPositions,
      pluginElements,
    });
    pluginSettingsHistoryRef.current = selectedPluginElement.fullId;
  };

  const ensurePluginTransformHistory = () => {
    if (!selectedPluginElement) return;
    if (pluginTransformHistoryRef.current === selectedPluginElement.fullId) {
      return;
    }
    pushHistoryState({
      keyMappings,
      positions,
      statPositions: statItemPositions,
      graphPositions: graphItemPositions,
      pluginElements,
    });
    pluginTransformHistoryRef.current = selectedPluginElement.fullId;
  };

  const handlePluginPositionXChange = (value: number) => {
    if (!selectedPluginElement) return;
    ensurePluginTransformHistory();
    updatePluginElement(selectedPluginElement.fullId, {
      position: {
        x: value,
        y: selectedPluginElement.position.y,
      },
    });
  };

  const handlePluginPositionYChange = (value: number) => {
    if (!selectedPluginElement) return;
    ensurePluginTransformHistory();
    updatePluginElement(selectedPluginElement.fullId, {
      position: {
        x: selectedPluginElement.position.x,
        y: value,
      },
    });
  };

  const handlePluginWidthChange = (value: number) => {
    if (!selectedPluginElement) return;
    ensurePluginTransformHistory();
    const baseHeight =
      selectedPluginElement.measuredSize?.height ??
      selectedPluginElement.estimatedSize?.height ??
      150;
    updatePluginElement(selectedPluginElement.fullId, {
      measuredSize: {
        width: value,
        height: baseHeight,
      },
    });
  };

  const handlePluginHeightChange = (value: number) => {
    if (!selectedPluginElement) return;
    ensurePluginTransformHistory();
    const baseWidth =
      selectedPluginElement.measuredSize?.width ??
      selectedPluginElement.estimatedSize?.width ??
      200;
    updatePluginElement(selectedPluginElement.fullId, {
      measuredSize: {
        width: baseWidth,
        height: value,
      },
    });
  };

  const handlePluginSettingChange = (key: string, value: unknown) => {
    if (!selectedPluginElement) return;
    ensurePluginSettingsHistory();
    updatePluginElement(selectedPluginElement.fullId, {
      settings: {
        ...resolvedPluginSettings,
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
    if (!pluginSettingsPanel) return;
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
      closePluginSettingsPanel();
    }
  };

  const handlePluginSettingsPanelCancelImpl = useRef<() => void>(() => {});
  handlePluginSettingsPanelCancelImpl.current = () => {
    if (!pluginSettingsPanel) return;
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

  const handleKeyListen = () => {
    if (justAssignedRef.current) return;
    setIsListening(true);
  };

  const handleStatUpdate = (
    data: Partial<StatItemPosition> & { index: number },
  ) => {
    const { index, ...updates } = data;
    const mode = selectedKeyType;
    const current = useStatItemStore.getState().positions;
    const list = current[mode] || [];
    if (!list[index]) return;

    if (!statPreviewHistorySavedRef.current) {
      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: currentPositions,
        statPositions: current,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: currentPluginElements,
      });
    }
    statPreviewHistorySavedRef.current = false;

    const nextList = list.map((pos, i) =>
      i === index ? ({ ...pos, ...updates } as StatItemPosition) : pos,
    );
    const nextPositions = { ...current, [mode]: nextList };

    useStatItemStore.getState().setLocalUpdateInProgress(true);
    useStatItemStore.getState().setPositions(nextPositions);
    window.api.statItems
      .updatePositions(nextPositions)
      .catch((error) => {
        console.error('Failed to update stat item', error);
      })
      .finally(() => {
        useStatItemStore.getState().setLocalUpdateInProgress(false);
      });
    try {
      window.api.bridge.sendTo('overlay', 'statPositions:sync', {
        positions: nextPositions,
      });
    } catch {
      // ignore
    }
  };

  const handleStatPreview = (
    index: number,
    updates: Partial<StatItemPosition>,
  ) => {
    const mode = selectedKeyType;
    const current = useStatItemStore.getState().positions;
    const list = current[mode] || [];
    if (!list[index]) return;

    // preview가 store를 변경하므로, 첫 preview 시 히스토리 저장
    if (!statPreviewHistorySavedRef.current) {
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: useKeyStore.getState().positions,
        statPositions: current,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: usePluginDisplayElementStore.getState().elements,
      });
      statPreviewHistorySavedRef.current = true;
    }

    const nextList = list.map((pos, i) =>
      i === index ? ({ ...pos, ...updates } as StatItemPosition) : pos,
    );
    const nextPositions = { ...current, [mode]: nextList };
    useStatItemStore.getState().setPositions(nextPositions);
  };

  const handleStatBatchPreview = (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
  ) => {
    if (updates.length === 0) return;

    const mode = selectedKeyType;
    const current = useStatItemStore.getState().positions;
    const list = current[mode] || [];
    if (list.length === 0) return;

    const updateMap = new Map<number, Partial<StatItemPosition>>();
    for (const { index, ...rest } of updates) {
      if (list[index]) {
        updateMap.set(index, rest);
      }
    }
    if (updateMap.size === 0) return;

    // preview가 store를 변경하므로, 첫 preview 시 히스토리 저장
    if (!statPreviewHistorySavedRef.current) {
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: useKeyStore.getState().positions,
        statPositions: current,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: usePluginDisplayElementStore.getState().elements,
      });
      statPreviewHistorySavedRef.current = true;
    }

    const nextList = list.map((pos, i) => {
      const update = updateMap.get(i);
      return update ? ({ ...pos, ...update } as StatItemPosition) : pos;
    });
    const nextPositions = { ...current, [mode]: nextList };
    useStatItemStore.getState().setPositions(nextPositions);
  };

  const handleStatBatchUpdate = (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
    options?: { skipHistory?: boolean },
  ) => {
    if (updates.length === 0) return;

    const mode = selectedKeyType;
    const current = useStatItemStore.getState().positions;
    const list = current[mode] || [];
    if (list.length === 0) return;

    const updateMap = new Map<number, Partial<StatItemPosition>>();
    for (const { index, ...rest } of updates) {
      if (list[index]) {
        updateMap.set(index, rest);
      }
    }
    if (updateMap.size === 0) return;

    if (!options?.skipHistory && !statPreviewHistorySavedRef.current) {
      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: currentPositions,
        statPositions: current,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: currentPluginElements,
      });
    }
    statPreviewHistorySavedRef.current = false;

    const nextList = list.map((pos, i) => {
      const update = updateMap.get(i);
      return update ? ({ ...pos, ...update } as StatItemPosition) : pos;
    });
    const nextPositions = { ...current, [mode]: nextList };

    useStatItemStore.getState().setLocalUpdateInProgress(true);
    useStatItemStore.getState().setPositions(nextPositions);
    window.api.statItems
      .updatePositions(nextPositions)
      .catch((error) => {
        console.error('Failed to batch update stat items', error);
      })
      .finally(() => {
        useStatItemStore.getState().setLocalUpdateInProgress(false);
      });
    try {
      window.api.bridge.sendTo('overlay', 'statPositions:sync', {
        positions: nextPositions,
      });
    } catch {
      // ignore
    }
  };

  const handleGraphUpdate = (
    data: Partial<GraphItemPosition> & { index: number },
  ) => {
    const { index, ...updates } = data;
    const mode = selectedKeyType;
    const current = useGraphItemStore.getState().positions;
    const list = current[mode] || [];
    if (!list[index]) return;

    if (!graphPreviewHistorySavedRef.current) {
      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: currentPositions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: current,
        pluginElements: currentPluginElements,
      });
    }
    graphPreviewHistorySavedRef.current = false;

    const nextList = list.map((pos, i) =>
      i === index ? ({ ...pos, ...updates } as GraphItemPosition) : pos,
    );
    const nextPositions = { ...current, [mode]: nextList };

    useGraphItemStore.getState().setLocalUpdateInProgress(true);
    useGraphItemStore.getState().setPositions(nextPositions);
    window.api.graphItems
      .updatePositions(nextPositions)
      .catch((error) => {
        console.error('Failed to update graph item', error);
      })
      .finally(() => {
        useGraphItemStore.getState().setLocalUpdateInProgress(false);
      });
    try {
      window.api.bridge.sendTo('overlay', 'graphPositions:sync', {
        positions: nextPositions,
      });
    } catch {
      // ignore
    }
  };

  const handleKnobUpdate = (
    data: Partial<KnobItemPosition> & { index: number },
  ) => {
    const { index, ...updates } = data;
    const mode = selectedKeyType;
    const current = useKnobItemStore.getState().positions;
    const list = current[mode] || [];
    if (!list[index]) return;

    if (!knobPreviewHistorySavedRef.current) {
      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: currentPositions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: currentPluginElements,
      });
    }
    knobPreviewHistorySavedRef.current = false;

    const nextList = list.map((pos, i) =>
      i === index ? ({ ...pos, ...updates } as KnobItemPosition) : pos,
    );
    const nextPositions = { ...current, [mode]: nextList };

    useKnobItemStore.getState().setLocalUpdateInProgress(true);
    useKnobItemStore.getState().setPositions(nextPositions);
    window.api.knobItems
      .updatePositions(nextPositions)
      .catch((error) => {
        console.error('Failed to update knob item', error);
      })
      .finally(() => {
        useKnobItemStore.getState().setLocalUpdateInProgress(false);
      });
    try {
      window.api.bridge.sendTo('overlay', 'knobPositions:sync', {
        positions: nextPositions,
      });
    } catch {
      // ignore
    }
  };

  const handleKnobPreview = (
    index: number,
    updates: Partial<KnobItemPosition>,
  ) => {
    const mode = selectedKeyType;
    const current = useKnobItemStore.getState().positions;
    const list = current[mode] || [];
    if (!list[index]) return;

    if (!knobPreviewHistorySavedRef.current) {
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: useKeyStore.getState().positions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: usePluginDisplayElementStore.getState().elements,
      });
      knobPreviewHistorySavedRef.current = true;
    }

    const nextList = list.map((pos, i) =>
      i === index ? ({ ...pos, ...updates } as KnobItemPosition) : pos,
    );
    const nextPositions = { ...current, [mode]: nextList };
    useKnobItemStore.getState().setPositions(nextPositions);
  };

  const handleKnobBatchPreview = (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
  ) => {
    if (updates.length === 0) return;

    const mode = selectedKeyType;
    const current = useKnobItemStore.getState().positions;
    const list = current[mode] || [];
    if (list.length === 0) return;

    const updateMap = new Map<number, Partial<KnobItemPosition>>();
    for (const { index, ...rest } of updates) {
      if (list[index]) {
        updateMap.set(index, rest);
      }
    }
    if (updateMap.size === 0) return;

    if (!knobPreviewHistorySavedRef.current) {
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: useKeyStore.getState().positions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: usePluginDisplayElementStore.getState().elements,
      });
      knobPreviewHistorySavedRef.current = true;
    }

    const nextList = list.map((pos, i) => {
      const update = updateMap.get(i);
      return update ? ({ ...pos, ...update } as KnobItemPosition) : pos;
    });
    const nextPositions = { ...current, [mode]: nextList };
    useKnobItemStore.getState().setPositions(nextPositions);
  };

  const handleKnobBatchUpdate = (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
    options?: { skipHistory?: boolean },
  ) => {
    if (updates.length === 0) return;

    const mode = selectedKeyType;
    const current = useKnobItemStore.getState().positions;
    const list = current[mode] || [];
    if (list.length === 0) return;

    const updateMap = new Map<number, Partial<KnobItemPosition>>();
    for (const { index, ...rest } of updates) {
      if (list[index]) {
        updateMap.set(index, rest);
      }
    }
    if (updateMap.size === 0) return;

    if (!options?.skipHistory && !knobPreviewHistorySavedRef.current) {
      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: currentPositions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: useGraphItemStore.getState().positions,
        pluginElements: currentPluginElements,
      });
    }
    knobPreviewHistorySavedRef.current = false;

    const nextList = list.map((pos, i) => {
      const update = updateMap.get(i);
      return update ? ({ ...pos, ...update } as KnobItemPosition) : pos;
    });
    const nextPositions = { ...current, [mode]: nextList };

    useKnobItemStore.getState().setLocalUpdateInProgress(true);
    useKnobItemStore.getState().setPositions(nextPositions);
    window.api.knobItems
      .updatePositions(nextPositions)
      .catch((error) => {
        console.error('Failed to batch update knob items', error);
      })
      .finally(() => {
        useKnobItemStore.getState().setLocalUpdateInProgress(false);
      });
    try {
      window.api.bridge.sendTo('overlay', 'knobPositions:sync', {
        positions: nextPositions,
      });
    } catch {
      // ignore
    }
  };

  const handleGraphPreview = (
    index: number,
    updates: Partial<GraphItemPosition>,
  ) => {
    const mode = selectedKeyType;
    const current = useGraphItemStore.getState().positions;
    const list = current[mode] || [];
    if (!list[index]) return;

    // preview가 store를 변경하므로, 첫 preview 시 히스토리 저장
    if (!graphPreviewHistorySavedRef.current) {
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: useKeyStore.getState().positions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: current,
        pluginElements: usePluginDisplayElementStore.getState().elements,
      });
      graphPreviewHistorySavedRef.current = true;
    }

    const nextList = list.map((pos, i) =>
      i === index ? ({ ...pos, ...updates } as GraphItemPosition) : pos,
    );
    const nextPositions = { ...current, [mode]: nextList };
    useGraphItemStore.getState().setPositions(nextPositions);
  };

  const handleGraphBatchPreview = (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
  ) => {
    if (updates.length === 0) return;

    const mode = selectedKeyType;
    const current = useGraphItemStore.getState().positions;
    const list = current[mode] || [];
    if (list.length === 0) return;

    const updateMap = new Map<number, Partial<GraphItemPosition>>();
    for (const { index, ...rest } of updates) {
      if (list[index]) {
        updateMap.set(index, rest);
      }
    }
    if (updateMap.size === 0) return;

    // preview가 store를 변경하므로, 첫 preview 시 히스토리 저장
    if (!graphPreviewHistorySavedRef.current) {
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: useKeyStore.getState().positions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: current,
        pluginElements: usePluginDisplayElementStore.getState().elements,
      });
      graphPreviewHistorySavedRef.current = true;
    }

    const nextList = list.map((pos, i) => {
      const update = updateMap.get(i);
      return update ? ({ ...pos, ...update } as GraphItemPosition) : pos;
    });
    const nextPositions = { ...current, [mode]: nextList };
    useGraphItemStore.getState().setPositions(nextPositions);
  };

  const handleGraphBatchUpdate = (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
    options?: { skipHistory?: boolean },
  ) => {
    if (updates.length === 0) return;

    const mode = selectedKeyType;
    const current = useGraphItemStore.getState().positions;
    const list = current[mode] || [];
    if (list.length === 0) return;

    const updateMap = new Map<number, Partial<GraphItemPosition>>();
    for (const { index, ...rest } of updates) {
      if (list[index]) {
        updateMap.set(index, rest);
      }
    }
    if (updateMap.size === 0) return;

    if (!options?.skipHistory && !graphPreviewHistorySavedRef.current) {
      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState({
        keyMappings: km,
        positions: currentPositions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: current,
        pluginElements: currentPluginElements,
      });
    }
    graphPreviewHistorySavedRef.current = false;

    const nextList = list.map((pos, i) => {
      const update = updateMap.get(i);
      return update ? ({ ...pos, ...update } as GraphItemPosition) : pos;
    });
    const nextPositions = { ...current, [mode]: nextList };

    useGraphItemStore.getState().setLocalUpdateInProgress(true);
    useGraphItemStore.getState().setPositions(nextPositions);
    window.api.graphItems
      .updatePositions(nextPositions)
      .catch((error) => {
        console.error('Failed to batch update graph items', error);
      })
      .finally(() => {
        useGraphItemStore.getState().setLocalUpdateInProgress(false);
      });
    try {
      window.api.bridge.sendTo('overlay', 'graphPositions:sync', {
        positions: nextPositions,
      });
    } catch {
      // ignore
    }
  };

  // 크기 변경 완료 (blur 시 저장)
  const handleSizeBlur = () => {
    if (singleKeyIndex === null && singleStatIndex === null) return;
    const updates: Partial<KeyPosition> = {};
    if (localState.width !== undefined) updates.width = localState.width;
    if (localState.height !== undefined) updates.height = localState.height;
    if (Object.keys(updates).length > 0) {
      if (singleKeyIndex !== null) {
        onKeyUpdate({ index: singleKeyIndex, ...updates });
      } else if (singleStatIndex !== null) {
        handleStatUpdate({
          index: singleStatIndex,
          ...(updates as Partial<StatItemPosition>),
        });
      }
    }
  };

  // ============================================================================
  // 다중 선택 헬퍼 함수들
  // ============================================================================

  const getSelectedKeysData = () => {
    return selectedKeyLikeElements
      .map((el) => {
        const index = el.index!;
        if (el.type === 'key') {
          const position = positions[selectedKeyType]?.[index];
          const keyCode = keyMappings[selectedKeyType]?.[index] ?? null;
          const keyInfo = keyCode ? getKeyInfoByGlobalKey(keyCode) : null;
          return { index, position, keyCode, keyInfo };
        }
        const position = statItemPositions[selectedKeyType]?.[index];
        const statLabel =
          (position?.displayText || '').trim() ||
          getStatTypeLabel(position?.statType ?? null);
        const keyInfo = { globalKey: statLabel, displayName: statLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter((data) => data.position !== undefined);
  };

  const getSelectedGraphsData = () => {
    return selectedGraphElements
      .map((el) => {
        const index = el.index!;
        const position = graphItemPositions[selectedKeyType]?.[index];
        const graphLabel = `${getStatTypeLabel(
          position?.statType ?? null,
        )} Graph`;
        const keyInfo = { globalKey: graphLabel, displayName: graphLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter((data) => data.position !== undefined);
  };

  const getSelectedKnobsData = () => {
    return selectedKnobElements
      .map((el) => {
        const index = el.index!;
        const position = knobItemPositions[selectedKeyType]?.[index];
        const knobLabel = (position?.displayText || '').trim() || 'Knob';
        const keyInfo = { globalKey: knobLabel, displayName: knobLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter((data) => data.position !== undefined);
  };

  const getSelectedBatchStyleData = () => {
    return selectedBatchStyleElements
      .map((el) => {
        const index = el.index!;
        if (el.type === 'key') {
          const position = positions[selectedKeyType]?.[index];
          const keyCode = keyMappings[selectedKeyType]?.[index] ?? null;
          const keyInfo = keyCode ? getKeyInfoByGlobalKey(keyCode) : null;
          return { index, position, keyCode, keyInfo };
        }
        if (el.type === 'stat') {
          const position = statItemPositions[selectedKeyType]?.[index];
          const statLabel =
            (position?.displayText || '').trim() ||
            getStatTypeLabel(position?.statType ?? null);
          const keyInfo = { globalKey: statLabel, displayName: statLabel };
          return { index, position, keyCode: null, keyInfo };
        }
        if (el.type === 'knob') {
          const position = knobItemPositions[selectedKeyType]?.[index];
          const knobLabel = (position?.displayText || '').trim() || 'Knob';
          const keyInfo = { globalKey: knobLabel, displayName: knobLabel };
          return { index, position, keyCode: null, keyInfo };
        }
        const position = graphItemPositions[selectedKeyType]?.[index];
        const graphLabel = `${getStatTypeLabel(
          position?.statType ?? null,
        )} Graph`;
        const keyInfo = { globalKey: graphLabel, displayName: graphLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter((data) => data.position !== undefined);
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
    handleBatchStyleChange,
    handleBatchStyleChangeComplete,
    handleKeyOnlyStyleChangeComplete,
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchSpacing,
    handleBatchSpacingPreview,
    handleBatchSpacingCommit,
    getBatchSpacingValue,
    handleBatchResize,
    handleBatchCounterUpdate,
    handleBatchNoteColorChange,
    handleBatchNoteColorChangeComplete,
    handleBatchGlowColorChange,
    handleBatchGlowColorChangeComplete,
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
    onKeyUpdate,
    onKeyBatchUpdate,
    onKeyPreview,
    onKeyBatchPreview,
    onStatUpdate: handleStatUpdate,
    onStatBatchUpdate: handleStatBatchUpdate,
    onStatPreview: handleStatPreview,
    onStatBatchPreview: handleStatBatchPreview,
    onGraphUpdate: handleGraphUpdate,
    onGraphBatchUpdate: handleGraphBatchUpdate,
    onGraphPreview: handleGraphPreview,
    onGraphBatchPreview: handleGraphBatchPreview,
    knobPositions: knobItemPositions,
    onKnobUpdate: handleKnobUpdate,
    onKnobBatchUpdate: handleKnobBatchUpdate,
    onKnobPreview: handleKnobPreview,
    onKnobBatchPreview: handleKnobBatchPreview,
  });

  // NOTE 탭은 "키"에만 적용되어야 함
  const getSelectedKeyOnlyPositions = () => {
    return selectedKeyElements
      .map((el) => {
        const index = el.index ?? -1;
        const position = positions[selectedKeyType]?.[index];
        return position ? { index, position } : null;
      })
      .filter((v): v is { index: number; position: KeyPosition } => v !== null);
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

  const dispatchKeyOnlyBatchUpdates = (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
    kind: 'preview' | 'commit',
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onKeyBatchPreview) {
        onKeyBatchPreview(updates);
        return;
      }
      if (onKeyPreview) {
        updates.forEach(({ index, ...rest }) => onKeyPreview(index, rest));
        return;
      }
      return;
    }

    if (onKeyBatchUpdate) {
      onKeyBatchUpdate(updates);
      return;
    }
    updates.forEach((update) => onKeyUpdate(update));
  };

  const handleBatchKeyOnlyStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
      index,
      [property]: value,
    })) as Array<{ index: number } & Partial<KeyPosition>>;
    dispatchKeyOnlyBatchUpdates(updates, 'commit');
  };

  const handleBatchNoteColorChangeKeysOnly = (value: NoteColor) => {
    const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
      index,
      noteColor: value,
    }));
    dispatchKeyOnlyBatchUpdates(updates, 'preview');
  };

  const handleBatchNoteColorChangeCompleteKeysOnly = (value: NoteColor) => {
    const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
      index,
      noteColor: value,
    }));
    dispatchKeyOnlyBatchUpdates(updates, 'commit');
  };

  const handleBatchGlowColorChangeKeysOnly = (value: NoteColor) => {
    const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
      index,
      noteGlowColor: value,
    }));
    dispatchKeyOnlyBatchUpdates(updates, 'preview');
  };

  const handleBatchGlowColorChangeCompleteKeysOnly = (value: NoteColor) => {
    const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
      index,
      noteGlowColor: value,
    }));
    dispatchKeyOnlyBatchUpdates(updates, 'commit');
  };

  const handleGraphBatchSharedSetting = (
    updates: Partial<GraphItemPosition>,
  ) => {
    const batchUpdates = selectedGraphElements
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, ...updates })) as Array<
      { index: number } & Partial<GraphItemPosition>
    >;
    handleGraphBatchUpdate(batchUpdates);
  };

  const handleKnobBatchSharedSetting = (updates: Partial<KnobItemPosition>) => {
    const batchUpdates = selectedKnobElements
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, ...updates })) as Array<
      { index: number } & Partial<KnobItemPosition>
    >;
    handleKnobBatchUpdate(batchUpdates);
  };

  const renderPluginSettingsForm = (
    schema: Record<string, PluginSettingSchema> | undefined,
    values: Record<string, unknown>,
    messages: PluginMessages | undefined,
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
    options?: { wrap?: boolean },
  ) => {
    if (!schema || Object.keys(schema).length === 0) {
      return (
        <p className="text-[#6B6D75] text-style-4 text-center">
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

    const wrap = options?.wrap !== false;
    const rows = Object.entries(schema).map(([key, setting]) => {
      const schemaValue = setting as PluginSettingSchema;

      if (schemaValue.visible !== undefined) {
        const vis =
          typeof schemaValue.visible === 'function'
            ? schemaValue.visible(values)
            : schemaValue.visible;
        if (!vis) return null;
      }

      if (schemaValue.type === 'divider') {
        return <SectionDivider key={`divider-${key}`} />;
      }
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
            className="flex justify-between items-center w-full h-[23px]"
          >
            <p className="text-white text-style-2">{labelText}</p>
            <div className="flex items-center gap-[10.5px]">{control}</div>
          </div>
        );
      }

      return (
        <PropertyRow key={key} label={labelText}>
          {control}
        </PropertyRow>
      );
    });

    const filtered = rows.filter(Boolean);

    if (!wrap) {
      return <>{filtered}</>;
    }

    return <div className="flex flex-col gap-[12px]">{filtered}</div>;
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
      const firstPos =
        isNoteTabPicker && keyOnly.length > 0
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
          fillIdle: counterSettings.fill.idle,
          fillActive: counterSettings.fill.active,
          strokeIdle: counterSettings.stroke.idle,
          strokeActive: counterSettings.stroke.active,
        });
        setBatchLocalOpacities({
          noteOpacity:
            typeof firstPos.noteOpacity === 'number'
              ? firstPos.noteOpacity
              : 80,
          glowOpacity:
            typeof firstPos.noteGlowOpacity === 'number'
              ? firstPos.noteGlowOpacity
              : 70,
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
        return batchLocalColors.borderColor;
      case 'fill':
        return batchCounterColorState === 'active'
          ? batchLocalColors.fillActive
          : batchLocalColors.fillIdle;
      case 'stroke':
        return batchCounterColorState === 'active'
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
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      setBatchLocalColors((prev) => ({
        ...prev,
        borderColor: solidColor,
      }));
    } else if (batchPickerFor === 'fill') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        batchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    } else if (batchPickerFor === 'stroke') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        batchCounterColorState === 'active' ? 'strokeActive' : 'strokeIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    }

    const isGradientNoteLikeColor =
      !!newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient';

    if (
      isGradientNoteLikeColor &&
      (batchPickerFor === 'noteColor' || batchPickerFor === 'glowColor')
    ) {
      return;
    }

    if (batchPickerFor === 'noteColor') {
      if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
        handleBatchNoteColorChangeKeysOnly(newColor);
      } else {
        handleBatchNoteColorChange(newColor);
      }
    } else if (batchPickerFor === 'glowColor') {
      if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
        handleBatchGlowColorChangeKeysOnly(newColor);
      } else {
        handleBatchGlowColorChange(newColor);
      }
    }
  };

  const handleBatchPickerColorChangeComplete = (newColor: NoteColor) => {
    if (!batchPickerFor) return;

    if (batchPickerFor === 'noteColor' || batchPickerFor === 'glowColor') {
      setBatchLocalColors((prev) => ({
        ...prev,
        [batchPickerFor]: newColor,
      }));
    } else if (batchPickerFor === 'borderColor') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      setBatchLocalColors((prev) => ({
        ...prev,
        borderColor: solidColor,
      }));
    } else if (batchPickerFor === 'fill') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        batchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    } else if (batchPickerFor === 'stroke') {
      const solidColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      const key =
        batchCounterColorState === 'active' ? 'strokeActive' : 'strokeIdle';
      setBatchLocalColors((prev) => ({
        ...prev,
        [key]: solidColor,
      }));
    }

    const keysData = getSelectedKeysData();
    const firstCounter = keysData[0]?.position
      ? normalizeCounterSettings(keysData[0].position.counter)
      : createDefaultCounterSettings();

    if (batchPickerFor === 'noteColor') {
      if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
        handleBatchNoteColorChangeCompleteKeysOnly(newColor);
      } else {
        handleBatchNoteColorChangeComplete(newColor);
      }
    } else if (batchPickerFor === 'glowColor') {
      if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
        handleBatchGlowColorChangeCompleteKeysOnly(newColor);
      } else {
        handleBatchGlowColorChangeComplete(newColor);
      }
    } else if (batchPickerFor === 'borderColor') {
      // noteBorderColor는 #RRGGBB 계약 — 피커의 rgba(...) 출력을 hex로 정규화 (이슈 #73)
      const solidColor = toRgbHexColor(
        typeof newColor === 'string' ? newColor : undefined,
      );
      if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
        handleBatchKeyOnlyStyleChangeComplete('noteBorderColor', solidColor);
      } else {
        handleBatchStyleChangeComplete('noteBorderColor', solidColor);
      }
    } else if (batchPickerFor === 'fill') {
      const fillColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      if (batchCounterColorState === 'active') {
        handleBatchCounterUpdate({
          fill: { ...firstCounter.fill, active: fillColor },
        });
      } else {
        handleBatchCounterUpdate({
          fill: { ...firstCounter.fill, idle: fillColor },
        });
      }
    } else if (batchPickerFor === 'stroke') {
      const strokeColor = typeof newColor === 'string' ? newColor : '#FFFFFF';
      if (batchCounterColorState === 'active') {
        handleBatchCounterUpdate({
          stroke: { ...firstCounter.stroke, active: strokeColor },
        });
      } else {
        handleBatchCounterUpdate({
          stroke: { ...firstCounter.stroke, idle: strokeColor },
        });
      }
    }
  };

  // ============================================================================
  // 렌더링
  // ============================================================================

  // 패널이 닫혀있을 때는 토글 버튼만 표시
  if (!isPanelVisible && !pluginSettingsPanel) {
    return (
      <div className="absolute right-0 top-0 z-30">
        <button
          onClick={handleTogglePanel}
          className="m-[8px] w-[32px] h-[32px] bg-[#1F1F24] border border-[#3A3943] rounded-[7px] flex items-center justify-center hover:bg-[#2A2A30] hover:border-[#505058] transition-colors shadow-lg"
          title={t('propertiesPanel.openPanel') || '속성 패널 열기'}
        >
          <SidebarToggleIcon isOpen={false} />
        </button>
      </div>
    );
  }

  if (pluginSettingsPanel) {
    return (
      <PluginSettingsPanelView
        setPanelElement={setPanelElement}
        pluginSettingsPanel={pluginSettingsPanel}
        pluginPanelSettings={pluginPanelSettings}
        handlePluginSettingsPanelChange={handlePluginSettingsPanelChange}
        handlePluginSettingsPanelConfirm={handlePluginSettingsPanelConfirm}
        handlePluginSettingsPanelCancel={handlePluginSettingsPanelCancel}
        setPluginScrollRef={setPluginScrollRef}
        setPluginThumbRef={setPluginThumbRef}
        renderPluginSettingsForm={renderPluginSettingsForm}
        t={t}
      />
    );
  }

  // 레이어 모드일 때는 선택 여부와 관계없이 레이어 패널 표시
  if (panelMode === 'layer') {
    const hasAnySelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    return (
      <LayerPanel
        onClose={handleTogglePanel}
        onSwitchToProperty={handleToggleMode}
        hasSelection={hasAnySelection}
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
        onClose={handleTogglePanel}
        onSwitchToProperty={handleToggleMode}
        onSelectionFromPanel={() => {
          selectionFromLayerPanelRef.current = true;
        }}
      />
    );
  }

  // 다중 선택인 경우 (키/통계 포함, 또는 그래프+노브 혼합)
  if (
    selectedBatchStyleElements.length > 1 &&
    selectedPluginElements.length === 0 &&
    (selectedKeyLikeElements.length > 0 ||
      (selectedGraphElements.length > 0 && selectedKnobElements.length > 0))
  ) {
    return (
      <BatchKeyLikePanel
        setPanelElement={setPanelElement}
        selectedBatchStyleElements={selectedBatchStyleElements}
        selectedKeyElements={selectedKeyElements}
        selectedStatElements={selectedStatElements}
        selectedGraphElements={selectedGraphElements}
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
        handleToggleMode={handleToggleMode}
        handleTogglePanel={handleTogglePanel}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        handleBatchAlign={handleBatchAlign}
        handleBatchDistribute={handleBatchDistribute}
        handleBatchSpacing={handleBatchSpacing}
        handleBatchSpacingPreview={handleBatchSpacingPreview}
        handleBatchSpacingCommit={handleBatchSpacingCommit}
        getBatchSpacingValue={getBatchSpacingValue}
        handleBatchResize={handleBatchResize}
        handleBatchStyleChange={handleBatchStyleChange}
        handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
        handleKeyOnlyStyleChangeComplete={handleKeyOnlyStyleChangeComplete}
        handleBatchCounterUpdate={handleBatchCounterUpdate}
        handleBatchNoteColorChange={handleBatchNoteColorChange}
        handleBatchNoteColorChangeComplete={handleBatchNoteColorChangeComplete}
        handleBatchGlowColorChange={handleBatchGlowColorChange}
        handleBatchGlowColorChangeComplete={handleBatchGlowColorChangeComplete}
        handleGraphBatchSharedSetting={handleGraphBatchSharedSetting}
        getMixedValue={getMixedValue}
        getMixedValueBatch={getMixedValueBatch}
        getMixedValueGraphs={getMixedValueGraphs}
        getMixedValueGraphsAsKey={getMixedValueGraphsAsKey}
        getMixedValueKeysOnly={getMixedValueKeysOnly}
        getSelectedKeysData={getSelectedKeysData}
        getSelectedGraphsData={getSelectedGraphsData}
        getSelectedBatchStyleData={getSelectedBatchStyleData}
        getSelectedKeyOnlyPositions={getSelectedKeyOnlyPositions}
        handleBatchKeyOnlyStyleChangeComplete={
          handleBatchKeyOnlyStyleChangeComplete
        }
        handleBatchNoteColorChangeKeysOnly={handleBatchNoteColorChangeKeysOnly}
        handleBatchNoteColorChangeCompleteKeysOnly={
          handleBatchNoteColorChangeCompleteKeysOnly
        }
        handleBatchGlowColorChangeKeysOnly={handleBatchGlowColorChangeKeysOnly}
        handleBatchGlowColorChangeCompleteKeysOnly={
          handleBatchGlowColorChangeCompleteKeysOnly
        }
        batchScrollRefFor={batchScrollRefFor}
        batchThumbRefFor={batchThumbRefFor}
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
        batchCounterColorState={batchCounterColorState}
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
  if (
    selectedKnobElements.length > 1 &&
    selectedKeyLikeElements.length === 0 &&
    selectedGraphElements.length === 0 &&
    selectedPluginElements.length === 0
  ) {
    return (
      <BatchKnobOnlyPanel
        setPanelElement={setPanelElement}
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
        handleToggleMode={handleToggleMode}
        handleTogglePanel={handleTogglePanel}
        handleBatchAlign={handleBatchAlign}
        handleBatchDistribute={handleBatchDistribute}
        handleBatchSpacing={handleBatchSpacing}
        handleBatchSpacingPreview={handleBatchSpacingPreview}
        handleBatchSpacingCommit={handleBatchSpacingCommit}
        getBatchSpacingValue={getBatchSpacingValue}
        handleBatchResize={handleBatchResize}
        handleBatchStyleChange={handleBatchStyleChange}
        handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
        handleKnobBatchSharedSetting={handleKnobBatchSharedSetting}
        getMixedValueKnobs={getMixedValueKnobs}
        getMixedValueKnobsAsKey={getMixedValueKnobsAsKey}
        getSelectedKnobsData={getSelectedKnobsData}
        batchScrollRefFor={batchScrollRefFor}
        batchThumbRefFor={batchThumbRefFor}
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
  if (
    selectedGraphElements.length > 1 &&
    selectedKeyLikeElements.length === 0 &&
    selectedKnobElements.length === 0 &&
    selectedPluginElements.length === 0
  ) {
    return (
      <BatchGraphOnlyPanel
        setPanelElement={setPanelElement}
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
        handleToggleMode={handleToggleMode}
        handleTogglePanel={handleTogglePanel}
        handleBatchAlign={handleBatchAlign}
        handleBatchDistribute={handleBatchDistribute}
        handleBatchSpacing={handleBatchSpacing}
        handleBatchSpacingPreview={handleBatchSpacingPreview}
        handleBatchSpacingCommit={handleBatchSpacingCommit}
        getBatchSpacingValue={getBatchSpacingValue}
        handleBatchResize={handleBatchResize}
        handleBatchStyleChange={handleBatchStyleChange}
        handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
        handleGraphBatchSharedSetting={handleGraphBatchSharedSetting}
        getMixedValueGraphs={getMixedValueGraphs}
        getMixedValueGraphsAsKey={getMixedValueGraphsAsKey}
        getSelectedGraphsData={getSelectedGraphsData}
        batchScrollRefFor={batchScrollRefFor}
        batchThumbRefFor={batchThumbRefFor}
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

  // 플러그인 요소가 선택된 경우
  if (
    selectedPluginElements.length > 0 &&
    selectedKeyLikeElements.length === 0 &&
    selectedGraphElements.length === 0
  ) {
    const pluginTitle =
      selectedPluginDefinition?.name ||
      selectedPluginElement?.definitionId ||
      t('propertiesPanel.pluginElement') ||
      'Plugin';

    return (
      <PluginSelectionPanel
        setPanelElement={setPanelElement}
        pluginTitle={pluginTitle}
        handleToggleMode={handleToggleMode}
        handleTogglePanel={handleTogglePanel}
        setPluginScrollRef={setPluginScrollRef}
        setPluginThumbRef={setPluginThumbRef}
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
        selectedPluginDefinition={selectedPluginDefinition}
        resolvedPluginSettings={resolvedPluginSettings}
        handlePluginSettingChange={handlePluginSettingChange}
        t={t}
      />
    );
  }

  // 단일 노브 요소 선택인 경우
  if (
    selectedKnobElements.length === 1 &&
    !!singleKnobPosition &&
    selectedKeyLikeElements.length === 0 &&
    selectedGraphElements.length === 0 &&
    selectedPluginElements.length === 0
  ) {
    return (
      <SingleKnobPanel
        setPanelElement={setPanelElement}
        singleKnobPosition={singleKnobPosition}
        singleKnobIndex={singleKnobIndex!}
        selectedKeyType={selectedKeyType}
        isRenaming={isRenaming}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameCancelledRef={renameCancelledRef}
        handleRenameCommit={handleRenameCommit}
        handleRenameCancel={handleRenameCancel}
        handleRenameStart={handleRenameStart}
        handleKnobUpdate={handleKnobUpdate}
        handleToggleMode={handleToggleMode}
        handleTogglePanel={handleTogglePanel}
        singleScrollRefFor={singleScrollRefFor}
        singleThumbRefFor={singleThumbRefFor}
        panelElement={panelElement}
        useCustomCSS={useCustomCSS}
        t={t}
      />
    );
  }

  // 단일 그래프 요소 선택인 경우
  if (
    selectedGraphElements.length === 1 &&
    !!singleGraphPosition &&
    selectedKeyLikeElements.length === 0 &&
    selectedPluginElements.length === 0
  ) {
    return (
      <SingleGraphPanel
        setPanelElement={setPanelElement}
        singleGraphPosition={singleGraphPosition}
        singleGraphIndex={singleGraphIndex!}
        selectedKeyType={selectedKeyType}
        isRenaming={isRenaming}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameCancelledRef={renameCancelledRef}
        handleRenameCommit={handleRenameCommit}
        handleRenameCancel={handleRenameCancel}
        handleRenameStart={handleRenameStart}
        handleToggleMode={handleToggleMode}
        handleTogglePanel={handleTogglePanel}
        handleGraphUpdate={handleGraphUpdate}
        singleScrollRefFor={singleScrollRefFor}
        singleThumbRefFor={singleThumbRefFor}
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
  if (!isSingleKey && !isSingleStat) {
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
      handleToggleMode={handleToggleMode}
      handleTogglePanel={handleTogglePanel}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onPositionChange={onPositionChange}
      onKeyUpdate={onKeyUpdate}
      onKeyPreview={onKeyPreview}
      onKeyMappingChange={onKeyMappingChange}
      handleStatUpdate={handleStatUpdate}
      handleStatPreview={handleStatPreview}
      isListening={isListening}
      handleKeyListen={handleKeyListen}
      localState={localState}
      setLocalState={setLocalState}
      handleSizeBlur={handleSizeBlur}
      showImagePicker={showImagePicker}
      setShowImagePicker={setShowImagePicker}
      imageButtonRef={imageButtonRef}
      panelElement={panelElement}
      useCustomCSS={useCustomCSS}
      singleScrollRefFor={singleScrollRefFor}
      singleThumbRefFor={singleThumbRefFor}
      t={t}
    />
  );
};

export default PropertiesPanel;
