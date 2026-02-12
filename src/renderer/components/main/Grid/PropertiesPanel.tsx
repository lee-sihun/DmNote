import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useTranslation } from "@contexts/I18nContext";
import { useGridSelectionStore } from "@stores/useGridSelectionStore";
import { useKeyStore } from "@stores/useKeyStore";
import { useStatItemStore } from "@stores/useStatItemStore";
import { useGraphItemStore } from "@stores/useGraphItemStore";
import { useSettingsStore } from "@stores/useSettingsStore";
import { useHistoryStore } from "@stores/useHistoryStore";
import { usePluginDisplayElementStore } from "@stores/usePluginDisplayElementStore";
import { usePropertiesPanelStore } from "@stores/usePropertiesPanelStore";
import { useUIStore } from "@stores/useUIStore";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { translatePluginMessage } from "@utils/pluginI18n";
import type { KeyPosition, KeyCounterSettings } from "@src/types/keys";
import type { StatItemPosition, StatItemType } from "@src/types/statItems";
import type { GraphItemPosition } from "@src/types/graphItems";
import type { PluginSettingSchema, PluginMessages } from "@src/types/api";
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from "@src/types/keys";
import ColorPicker from "@components/main/Modal/content/ColorPicker";
import ImagePicker from "@components/main/Modal/content/ImagePicker";
import { useLenis } from "@hooks/useLenis";

// 분리된 컴포넌트들 및 훅
import {
  TABS,
  TabType,
  PropertyRow,
  NumberInput,
  ColorInput,
  TextInput,
  SectionDivider,
  FontStyleToggle,
  Tabs,
  SidebarToggleIcon,
  ModeToggleIcon,
  StyleTabContent,
  NoteTabContent,
  CounterTabContent,
  BatchStyleTabContent,
  BatchNoteTabContent,
  BatchCounterTabContent,
  LayerPanel,
  useBatchHandlers,
  usePanelScroll,
} from "./PropertiesPanel/index";
import Checkbox from "@components/main/common/Checkbox";
import Dropdown from "@components/main/common/Dropdown";
import type { NoteColor } from "@src/types/keys";

const getStatTypeLabel = (statType?: StatItemType | null): string => {
  switch (statType) {
    case "kpsAvg":
      return "AVG";
    case "kpsMax":
      return "MAX";
    case "total":
      return "Total";
    case "kps":
    default:
      return "KPS";
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
    (el) => el.type === "key",
  );
  const selectedStatElements = selectedElements.filter(
    (el) => el.type === "stat",
  );
  const selectedGraphElements = selectedElements.filter(
    (el) => el.type === "graph",
  );
  const selectedKeyLikeElements = selectedElements.filter(
    (el) => el.type === "key" || el.type === "stat",
  );
  const selectedPluginElements = selectedElements.filter(
    (el) => el.type === "plugin",
  );

  const selectedPluginElement = useMemo(() => {
    if (selectedPluginElements.length !== 1) return null;
    return (
      pluginElements.find((el) => el.fullId === selectedPluginElements[0].id) ||
      null
    );
  }, [selectedPluginElements, pluginElements]);

  const selectedPluginDefinition = useMemo(() => {
    if (!selectedPluginElement?.definitionId) return null;
    return pluginDefinitions.get(selectedPluginElement.definitionId) || null;
  }, [selectedPluginElement?.definitionId, pluginDefinitions]);

  const pluginSettingsUI = selectedPluginDefinition?.settingsUI ?? "panel";
  const hasSinglePluginSelection =
    selectedPluginElements.length === 1 && !!selectedPluginElement;
  const showModalHint =
    hasSinglePluginSelection && pluginSettingsUI === "modal";
  const showSettings = hasSinglePluginSelection && pluginSettingsUI !== "modal";
  const isPluginResizable =
    hasSinglePluginSelection && !!selectedPluginDefinition?.resizable;

  const pluginDisplaySize = useMemo(() => {
    const measured = selectedPluginElement?.measuredSize;
    const estimated = selectedPluginElement?.estimatedSize;
    return {
      width: measured?.width ?? estimated?.width ?? 200,
      height: measured?.height ?? estimated?.height ?? 150,
    };
  }, [
    selectedPluginElement?.measuredSize?.width,
    selectedPluginElement?.measuredSize?.height,
    selectedPluginElement?.estimatedSize?.width,
    selectedPluginElement?.estimatedSize?.height,
  ]);

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
      ? (statItemPositions[selectedKeyType]?.[singleStatIndex] ?? null)
      : null;
  const singleGraphIndex =
    selectedGraphElements.length === 1 ? selectedGraphElements[0].index : null;
  const singleGraphPosition: GraphItemPosition | null =
    singleGraphIndex !== null
      ? (graphItemPositions[selectedKeyType]?.[singleGraphIndex] ?? null)
      : null;

  // 로컬 상태 (실시간 편집용)
  const [localState, setLocalState] = useState<
    Partial<KeyPosition> & { dx?: number; dy?: number }
  >({});
  const pluginSettingsHistoryRef = useRef<string | null>(null);
  const pluginTransformHistoryRef = useRef<string | null>(null);
  const [pluginPanelSettings, setPluginPanelSettings] = useState<
    Record<string, any>
  >({});

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

  // 다중 선택용 이미지 픽커 상태
  const [showBatchImagePicker, setShowBatchImagePicker] = useState(false);
  const batchImageButtonRef = useRef<HTMLButtonElement>(null);

  // 일괄 편집용 컬러 버튼 refs
  const batchNoteColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchGlowColorButtonRef = useRef<HTMLButtonElement>(null);
  const batchCounterFillButtonRef = useRef<HTMLButtonElement>(null);
  const batchCounterStrokeButtonRef = useRef<HTMLButtonElement>(null);

  // 패널 ref (컬러픽커/이미지픽커 위치 기준)
  // useRef 대신 useState를 사용하여 ref가 설정될 때 리렌더링 유발
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);

  // 패널 모드 상태 (layer: 레이어 패널, property: 속성 패널)
  const [panelMode, setPanelMode] = useState<"layer" | "property">("property");

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
    // 키/통계 요소 선택이 있을 때만 탭 보정
    if (
      selectedKeyLikeElements.length === 0 ||
      selectedPluginElements.length > 0
    ) {
      return;
    }
    // 통계만 선택된 경우에만 NOTE 탭을 숨김
    // (키가 함께 선택된 경우 NOTE 탭은 유지되며, NOTE 설정은 키에만 반영)
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

  // 스크롤 훅 사용
  const {
    batchScrollRefFor,
    batchThumbRefFor,
    singleScrollRefFor,
    singleThumbRefFor,
  } = usePanelScroll(activeTab, selectedElements.length);

  // 플러그인 패널 스크롤 (레이어/키 패널과 동일한 overlay 스크롤)
  const pluginScrollElementRef = useRef<HTMLDivElement | null>(null);
  const pluginThumbRef = useRef<HTMLDivElement | null>(null);

  const calculatePluginThumb = useCallback((el: HTMLDivElement) => {
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
  }, []);

  const updatePluginThumbDOM = useCallback(() => {
    if (!pluginThumbRef.current || !pluginScrollElementRef.current) return;
    const thumb = calculatePluginThumb(pluginScrollElementRef.current);
    pluginThumbRef.current.style.top = `${thumb.top}px`;
    pluginThumbRef.current.style.height = `${thumb.height}px`;
    pluginThumbRef.current.style.display = thumb.visible ? "block" : "none";
  }, [calculatePluginThumb]);

  const { scrollContainerRef: pluginLenisRef } = useLenis({
    onScroll: updatePluginThumbDOM,
  });

  const setPluginScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      pluginScrollElementRef.current = node;
      pluginLenisRef(node);
    },
    [pluginLenisRef],
  );

  const setPluginThumbRef = useCallback((node: HTMLDivElement | null) => {
    pluginThumbRef.current = node;
  }, []);

  const pluginSettingsSchemaCount = useMemo(
    () =>
      pluginSettingsPanel?.definition?.settings
        ? Object.keys(pluginSettingsPanel.definition.settings).length
        : 0,
    [pluginSettingsPanel?.definition?.settings],
  );

  const pluginElementSchemaCount = useMemo(
    () =>
      selectedPluginDefinition?.settings
        ? Object.keys(selectedPluginDefinition.settings).length
        : 0,
    [selectedPluginDefinition?.settings],
  );

  useEffect(() => {
    const hasPluginPanel =
      !!pluginSettingsPanel ||
      (selectedPluginElements.length > 0 &&
        selectedKeyLikeElements.length === 0);

    if (!hasPluginPanel) return;

    const raf = requestAnimationFrame(() => {
      updatePluginThumbDOM();
    });
    return () => cancelAnimationFrame(raf);
  }, [
    pluginSettingsPanel?.pluginId,
    pluginSettingsSchemaCount,
    selectedPluginElement?.fullId,
    selectedPluginDefinition?.id,
    pluginElementSchemaCount,
    showSettings,
    showModalHint,
    hasSinglePluginSelection,
    selectedPluginElements.length,
    selectedKeyLikeElements.length,
    updatePluginThumbDOM,
  ]);

  // 배치 편집용 로컬 ColorPicker 상태
  type BatchPickerTarget = "noteColor" | "glowColor" | "fill" | "stroke" | null;
  const [batchPickerFor, setBatchPickerFor] = useState<BatchPickerTarget>(null);
  const [batchCounterColorState, setBatchCounterColorState] = useState<
    "idle" | "active"
  >("idle");

  // 배치 편집용 로컬 색상 상태 (드래그 중 UI 업데이트용)
  const [batchLocalColors, setBatchLocalColors] = useState<{
    noteColor: any;
    glowColor: any;
    fillIdle: string;
    fillActive: string;
    strokeIdle: string;
    strokeActive: string;
  }>({
    noteColor: "#FFFFFF",
    glowColor: "#FFFFFF",
    fillIdle: "#FFFFFF",
    fillActive: "#FFFFFF",
    strokeIdle: "#000000",
    strokeActive: "#000000",
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
  }, [
    singleKeyPosition?.dx,
    singleKeyPosition?.dy,
    singleKeyPosition?.width,
    singleKeyPosition?.height,
    singleStatPosition?.dx,
    singleStatPosition?.dy,
    singleStatPosition?.width,
    singleStatPosition?.height,
  ]);

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

    if (pluginSettingsPanel) {
      prevHasSelectionRef.current = hasSelection;
      return;
    }

    if (hasSelection) {
      // 선택이 생겼을 때
      if (!hadSelection) {
        // 새로운 선택이 발생 → 명시적 닫기 플래그 리셋하고 패널 열기
        manuallyClosedRef.current = false;
        if (!isPanelVisible) {
          setPanelMode("property");
          setIsPanelVisible(true);
        } else if (
          panelModeRef.current === "layer" &&
          !selectionFromLayerPanelRef.current
        ) {
          // 레이어 패널이 열린 상태에서 그리드에서 첫 선택 → 속성 패널로 전환
          setPanelMode("property");
        }
      } else if (!isPanelVisible && !manuallyClosedRef.current) {
        // 선택이 이미 있었고 패널이 닫혀있는데 명시적 닫기가 아닌 경우
        setPanelMode("property");
        setIsPanelVisible(true);
      } else if (
        panelModeRef.current === "layer" &&
        !selectionFromLayerPanelRef.current &&
        isPanelVisible
      ) {
        // 레이어 패널 열린 상태에서 그리드에서 선택하면 → 속성 패널로 전환
        // (레이어 패널 내부에서 선택한 경우는 제외)
        setPanelMode("property");
      }
      // 속성 패널이 이미 열려있으면 현재 모드 유지
    } else if (hadSelection) {
      // 선택이 있었다가 해제된 경우
      if (keyTypeChangedRef.current && isPanelVisible) {
        // 탭 전환으로 인한 선택 해제 → 패널 닫지 않고 레이어 모드로 전환
        setPanelMode("layer");
      } else if (selectionFromLayerPanelRef.current && isPanelVisible) {
        // 레이어 패널에서 선택 해제 → 패널 닫지 않고 레이어 모드 유지
        setPanelMode("layer");
      } else if (!manuallyClosedRef.current) {
        // 일반적인 선택 해제 → 패널 닫기
        setIsPanelVisible(false);
      }
    }

    // 이전 상태 업데이트
    prevHasSelectionRef.current = hasSelection;
    // 플래그 리셋
    selectionFromLayerPanelRef.current = false;
    keyTypeChangedRef.current = false;

    setShowImagePicker(false);
    setShowGraphImagePicker(false);
    setShowBatchImagePicker(false);
    setIsListening(false);
  }, [
    singleKeyIndex,
    selectedKeyElements.length,
    selectedElements.length,
    isPanelVisible,
    pluginSettingsPanel,
  ]);

  // 다중 선택 시 패널 자동 열기
  useEffect(() => {
    if (
      selectedKeyLikeElements.length > 1 &&
      !isPanelVisible &&
      !manuallyClosedRef.current
    ) {
      setPanelMode("property");
      setIsPanelVisible(true);
    }
  }, [selectedKeyLikeElements.length, isPanelVisible]);

  useEffect(() => {
    if (pluginSettingsPanel) {
      manuallyClosedRef.current = false;
      setPanelMode("property");
      setIsPanelVisible(true);
    }
  }, [pluginSettingsPanel]);

  // 레이어 패널이 열려있고 선택이 없는 상태에서 그리드 빈 공간 클릭 시 패널 닫기
  useEffect(() => {
    // 레이어 모드이고 패널이 열려있고 선택이 없는 경우에만 리스너 등록
    const hasSelection =
      selectedKeyElements.length > 0 || selectedElements.length > 0;
    if (panelMode !== "layer" || !isPanelVisible || hasSelection) {
      return undefined;
    }

    const handleGridClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // 그리드 컨테이너 내부 클릭인지 확인
      const gridContainer = target.closest("[data-grid-container]");
      if (!gridContainer) {
        return; // 그리드 영역 외부 클릭은 무시
      }

      // 프로퍼티 패널 내부 클릭은 무시
      if (
        target.closest('[class*="properties-panel"]') ||
        target.closest('[class*="PropertiesPanel"]') ||
        target.closest(".absolute.right-0.top-0.bottom-0")
      ) {
        return;
      }

      // 키 요소 클릭은 무시 (선택으로 이어지므로 패널 닫지 않음)
      if (
        target.closest("[data-key-element]") ||
        target.closest("[data-plugin-element]")
      ) {
        return;
      }

      // 그리드 빈 공간 클릭 시 패널 닫기
      setIsPanelVisible(false);
    };

    // mousedown으로 감지 (click보다 먼저 발생)
    document.addEventListener("mousedown", handleGridClick);
    return () => {
      document.removeEventListener("mousedown", handleGridClick);
    };
  }, [
    isPanelVisible,
    selectedKeyLikeElements.length,
    selectedElements.length,
    panelMode,
  ]);

  // 키 리스닝 상태를 전역으로 노출 (App.tsx의 Tab 단축키 등에서 체크)
  useEffect(() => {
    // 이전 타이머 정리
    if (listeningFlagTimerRef.current !== null) {
      clearTimeout(listeningFlagTimerRef.current);
      listeningFlagTimerRef.current = null;
    }

    if (isListening) {
      (window as any).__dmn_isKeyListening = true;
    } else {
      // macOS에서 Tauri raw input이 브라우저 keydown보다 먼저 도착하여
      // isListening이 false로 바뀐 뒤 뒤늦게 keydown이 발생할 수 있으므로
      // 플래그 해제를 지연시켜 경쟁 조건 방지
      listeningFlagTimerRef.current = setTimeout(() => {
        (window as any).__dmn_isKeyListening = false;
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
      (window as any).__dmn_isKeyListening = false;
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

    window.addEventListener("keydown", blockKeyboardEvents, true);
    window.addEventListener("keyup", blockKeyboardEvents, true);
    window.addEventListener("keypress", blockKeyboardEvents, true);
    window.addEventListener("mousedown", blockMouseEvents, true);
    window.addEventListener("contextmenu", blockContextMenu, true);

    return () => {
      window.removeEventListener("keydown", blockKeyboardEvents, true);
      window.removeEventListener("keyup", blockKeyboardEvents, true);
      window.removeEventListener("keypress", blockKeyboardEvents, true);
      window.removeEventListener("mousedown", blockMouseEvents, true);
      window.removeEventListener("contextmenu", blockContextMenu, true);
    };
  }, [isListening]);

  // 키 리스닝 effect
  useEffect(() => {
    if (!isListening) return undefined;
    if (typeof window === "undefined" || !window.api?.keys?.onRawInput) {
      return undefined;
    }

    const unsubscribe = window.api.keys.onRawInput((payload: any) => {
      if (!payload || payload.state !== "DOWN") return;
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
    });

    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.error("Failed to unsubscribe raw input listener", error);
      }
    };
  }, [isListening, singleKeyIndex, onKeyMappingChange]);

  // ============================================================================
  // 핸들러
  // ============================================================================

  const handleTogglePanel = useCallback(() => {
    const willOpen = !isPanelVisible;

    if (willOpen) {
      // 패널을 열 때
      manuallyClosedRef.current = false;
      setIsPanelVisible(true);
      // 선택이 없으면 레이어 모드로 설정
      const hasSelection = selectedElements.length > 0;
      if (!hasSelection) {
        setPanelMode("layer");
      }
    } else {
      // 패널을 닫을 때 - 명시적 닫기 플래그 설정
      manuallyClosedRef.current = true;
      setIsPanelVisible(false);
      setShowImagePicker(false);
      setShowGraphImagePicker(false);
      setShowBatchImagePicker(false);
    }
  }, [isPanelVisible, selectedElements.length]);

  const handleToggleMode = useCallback(() => {
    setPanelMode((prev) => (prev === "layer" ? "property" : "layer"));
  }, []);

  const pluginDefaultSettings = useMemo(() => {
    const defaults: Record<string, any> = {};
    if (selectedPluginDefinition?.settings) {
      Object.entries(selectedPluginDefinition.settings).forEach(
        ([key, schema]) => {
          const schemaValue = schema as PluginSettingSchema;
          if (schemaValue.type === "divider") return;
          defaults[key] = schemaValue.default;
        },
      );
    }
    return defaults;
  }, [selectedPluginDefinition?.settings]);

  const resolvedPluginSettings = useMemo(
    () => ({
      ...pluginDefaultSettings,
      ...(selectedPluginElement?.settings || {}),
    }),
    [pluginDefaultSettings, selectedPluginElement?.settings],
  );

  const ensurePluginSettingsHistory = useCallback(() => {
    if (!selectedPluginElement) return;
    if (pluginSettingsHistoryRef.current === selectedPluginElement.fullId) {
      return;
    }
    pushHistoryState(
      keyMappings,
      positions,
      statItemPositions,
      graphItemPositions,
      pluginElements,
    );
    pluginSettingsHistoryRef.current = selectedPluginElement.fullId;
  }, [
    keyMappings,
    positions,
    statItemPositions,
    graphItemPositions,
    pluginElements,
    pushHistoryState,
    selectedPluginElement,
  ]);

  const ensurePluginTransformHistory = useCallback(() => {
    if (!selectedPluginElement) return;
    if (pluginTransformHistoryRef.current === selectedPluginElement.fullId) {
      return;
    }
    pushHistoryState(
      keyMappings,
      positions,
      statItemPositions,
      graphItemPositions,
      pluginElements,
    );
    pluginTransformHistoryRef.current = selectedPluginElement.fullId;
  }, [
    keyMappings,
    positions,
    statItemPositions,
    graphItemPositions,
    pluginElements,
    pushHistoryState,
    selectedPluginElement,
  ]);

  const handlePluginPositionXChange = useCallback(
    (value: number) => {
      if (!selectedPluginElement) return;
      ensurePluginTransformHistory();
      updatePluginElement(selectedPluginElement.fullId, {
        position: {
          x: value,
          y: selectedPluginElement.position.y,
        },
      });
    },
    [
      ensurePluginTransformHistory,
      selectedPluginElement?.fullId,
      selectedPluginElement?.position.y,
      updatePluginElement,
    ],
  );

  const handlePluginPositionYChange = useCallback(
    (value: number) => {
      if (!selectedPluginElement) return;
      ensurePluginTransformHistory();
      updatePluginElement(selectedPluginElement.fullId, {
        position: {
          x: selectedPluginElement.position.x,
          y: value,
        },
      });
    },
    [
      ensurePluginTransformHistory,
      selectedPluginElement?.fullId,
      selectedPluginElement?.position.x,
      updatePluginElement,
    ],
  );

  const handlePluginWidthChange = useCallback(
    (value: number) => {
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
    },
    [
      ensurePluginTransformHistory,
      selectedPluginElement?.estimatedSize?.height,
      selectedPluginElement?.fullId,
      selectedPluginElement?.measuredSize?.height,
      updatePluginElement,
    ],
  );

  const handlePluginHeightChange = useCallback(
    (value: number) => {
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
    },
    [
      ensurePluginTransformHistory,
      selectedPluginElement?.estimatedSize?.width,
      selectedPluginElement?.fullId,
      selectedPluginElement?.measuredSize?.width,
      updatePluginElement,
    ],
  );

  const handlePluginSettingChange = useCallback(
    (key: string, value: any) => {
      if (!selectedPluginElement) return;
      ensurePluginSettingsHistory();
      updatePluginElement(selectedPluginElement.fullId, {
        settings: {
          ...resolvedPluginSettings,
          [key]: value,
        },
      });
    },
    [
      ensurePluginSettingsHistory,
      resolvedPluginSettings,
      selectedPluginElement,
      updatePluginElement,
    ],
  );

  const handlePluginSettingsPanelChange = useCallback(
    (key: string, value: any) => {
      if (!pluginSettingsPanel) return;
      setPluginPanelSettings((prev) => {
        const next = { ...prev, [key]: value };
        pluginSettingsPanel.onChange(next);
        return next;
      });
    },
    [pluginSettingsPanel],
  );

  const handlePluginSettingsPanelConfirm = useCallback(async () => {
    if (!pluginSettingsPanel) return;
    try {
      await pluginSettingsPanel.onConfirm(
        pluginPanelSettings,
        pluginSettingsPanel.originalSettings,
      );
      pluginSettingsPanel.resolve(true);
    } catch (error) {
      console.error("[Plugin Settings] Failed to apply settings:", error);
      pluginSettingsPanel.resolve(false);
    } finally {
      closePluginSettingsPanel();
    }
  }, [closePluginSettingsPanel, pluginPanelSettings, pluginSettingsPanel]);

  const handlePluginSettingsPanelCancel = useCallback(() => {
    if (!pluginSettingsPanel) return;
    try {
      pluginSettingsPanel.onCancel(pluginSettingsPanel.originalSettings);
    } catch (error) {
      console.error("[Plugin Settings] Failed to cancel settings:", error);
    } finally {
      pluginSettingsPanel.resolve(false);
      closePluginSettingsPanel();
    }
  }, [closePluginSettingsPanel, pluginSettingsPanel]);

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
  }, [
    canvasPanelToggleSignal,
    handlePluginSettingsPanelCancel,
    handleTogglePanel,
    pluginSettingsPanel,
  ]);

  const handleKeyListen = useCallback(() => {
    if (justAssignedRef.current) return;
    setIsListening(true);
  }, []);

  const handleStatUpdate = useCallback(
    (data: Partial<StatItemPosition> & { index: number }) => {
      const { index, ...updates } = data;
      const mode = selectedKeyType;
      const current = useStatItemStore.getState().positions;
      const list = current[mode] || [];
      if (!list[index]) return;

      // 히스토리 저장 (키/플러그인과 동일한 스냅샷 기준)
      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState(
        km,
        currentPositions,
        current,
        useGraphItemStore.getState().positions,
        currentPluginElements,
      );

      const nextList = list.map((pos, i) =>
        i === index ? ({ ...pos, ...updates } as StatItemPosition) : pos,
      );
      const nextPositions = { ...current, [mode]: nextList };

      // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
      useStatItemStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setPositions(nextPositions);
      window.api.statItems
        .updatePositions(nextPositions)
        .catch((error) => {
          console.error("Failed to update stat item", error);
        })
        .finally(() => {
          useStatItemStore.getState().setLocalUpdateInProgress(false);
        });
      try {
        window.api.bridge.sendTo("overlay", "statPositions:sync", {
          positions: nextPositions,
        });
      } catch {
        // ignore
      }
    },
    [pushHistoryState, selectedKeyType],
  );

  const handleStatPreview = useCallback(
    (index: number, updates: Partial<StatItemPosition>) => {
      const mode = selectedKeyType;
      const current = useStatItemStore.getState().positions;
      const list = current[mode] || [];
      if (!list[index]) return;

      const nextList = list.map((pos, i) =>
        i === index ? ({ ...pos, ...updates } as StatItemPosition) : pos,
      );
      const nextPositions = { ...current, [mode]: nextList };
      useStatItemStore.getState().setPositions(nextPositions);
    },
    [selectedKeyType],
  );

  const handleStatBatchPreview = useCallback(
    (updates: Array<{ index: number } & Partial<StatItemPosition>>) => {
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

      const nextList = list.map((pos, i) => {
        const update = updateMap.get(i);
        return update ? ({ ...pos, ...update } as StatItemPosition) : pos;
      });
      const nextPositions = { ...current, [mode]: nextList };
      useStatItemStore.getState().setPositions(nextPositions);
    },
    [selectedKeyType],
  );

  const handleStatBatchUpdate = useCallback(
    (updates: Array<{ index: number } & Partial<StatItemPosition>>) => {
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

      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState(
        km,
        currentPositions,
        current,
        useGraphItemStore.getState().positions,
        currentPluginElements,
      );

      const nextList = list.map((pos, i) => {
        const update = updateMap.get(i);
        return update ? ({ ...pos, ...update } as StatItemPosition) : pos;
      });
      const nextPositions = { ...current, [mode]: nextList };

      // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
      useStatItemStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setPositions(nextPositions);
      window.api.statItems
        .updatePositions(nextPositions)
        .catch((error) => {
          console.error("Failed to batch update stat items", error);
        })
        .finally(() => {
          useStatItemStore.getState().setLocalUpdateInProgress(false);
        });
      try {
        window.api.bridge.sendTo("overlay", "statPositions:sync", {
          positions: nextPositions,
        });
      } catch {
        // ignore
      }
    },
    [pushHistoryState, selectedKeyType],
  );

  const handleGraphUpdate = useCallback(
    (data: Partial<GraphItemPosition> & { index: number }) => {
      const { index, ...updates } = data;
      const mode = selectedKeyType;
      const current = useGraphItemStore.getState().positions;
      const list = current[mode] || [];
      if (!list[index]) return;

      const currentPositions = useKeyStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      pushHistoryState(
        km,
        currentPositions,
        useStatItemStore.getState().positions,
        current,
        currentPluginElements,
      );

      const nextList = list.map((pos, i) =>
        i === index ? ({ ...pos, ...updates } as GraphItemPosition) : pos,
      );
      const nextPositions = { ...current, [mode]: nextList };

      useGraphItemStore.getState().setLocalUpdateInProgress(true);
      useGraphItemStore.getState().setPositions(nextPositions);
      window.api.graphItems
        .updatePositions(nextPositions)
        .catch((error) => {
          console.error("Failed to update graph item", error);
        })
        .finally(() => {
          useGraphItemStore.getState().setLocalUpdateInProgress(false);
        });
      try {
        window.api.bridge.sendTo("overlay", "graphPositions:sync", {
          positions: nextPositions,
        });
      } catch {
        // ignore
      }
    },
    [pushHistoryState, selectedKeyType],
  );

  // 크기 변경 완료 (blur 시 저장)
  const handleSizeBlur = useCallback(() => {
    if (singleKeyIndex === null && singleStatIndex === null) return;
    const updates: Partial<KeyPosition> = {};
    if (localState.width !== undefined) updates.width = localState.width;
    if (localState.height !== undefined) updates.height = localState.height;
    if (Object.keys(updates).length > 0) {
      if (singleKeyIndex !== null) {
        onKeyUpdate({ index: singleKeyIndex, ...updates });
      } else if (singleStatIndex !== null) {
        handleStatUpdate({ index: singleStatIndex, ...(updates as any) });
      }
    }
  }, [
    singleKeyIndex,
    singleStatIndex,
    localState.width,
    localState.height,
    onKeyUpdate,
    handleStatUpdate,
  ]);

  // ============================================================================
  // 다중 선택 헬퍼 함수들
  // ============================================================================

  const getSelectedKeysData = useCallback(() => {
    return selectedKeyLikeElements
      .map((el) => {
        const index = el.index!;
        if (el.type === "key") {
          const position = positions[selectedKeyType]?.[index];
          const keyCode = keyMappings[selectedKeyType]?.[index] ?? null;
          const keyInfo = keyCode ? getKeyInfoByGlobalKey(keyCode) : null;
          return { index, position, keyCode, keyInfo };
        }
        // stat
        const position = statItemPositions[selectedKeyType]?.[index];
        const statLabel =
          (position?.displayText || "").trim() ||
          getStatTypeLabel(position?.statType ?? null);
        const keyInfo = { globalKey: statLabel, displayName: statLabel };
        return { index, position, keyCode: null, keyInfo };
      })
      .filter((data) => data.position !== undefined);
  }, [
    selectedKeyLikeElements,
    positions,
    selectedKeyType,
    keyMappings,
    statItemPositions,
  ]);

  const getMixedValue = useCallback(
    <T,>(
      getter: (pos: KeyPosition) => T | undefined,
      defaultValue: T,
    ): { isMixed: boolean; value: T } => {
      const keysData = getSelectedKeysData();
      if (keysData.length === 0) return { isMixed: false, value: defaultValue };

      const firstValue = getter(keysData[0].position!) ?? defaultValue;
      const isMixed = keysData.some((data) => {
        const val = getter(data.position!) ?? defaultValue;
        if (typeof val === "object" && typeof firstValue === "object") {
          return JSON.stringify(val) !== JSON.stringify(firstValue);
        }
        return val !== firstValue;
      });

      return { isMixed, value: firstValue };
    },
    [getSelectedKeysData],
  );

  // ============================================================================
  // 다중 선택 일괄 편집 핸들러 (훅 사용)
  // ============================================================================

  const {
    handleBatchStyleChange,
    handleBatchStyleChangeComplete,
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchResize,
    handleBatchCounterUpdate,
    handleBatchNoteColorChange,
    handleBatchNoteColorChangeComplete,
    handleBatchGlowColorChange,
    handleBatchGlowColorChangeComplete,
  } = useBatchHandlers({
    selectedKeyLikeElements: selectedKeyLikeElements as any,
    keyPositions: positions,
    statPositions: statItemPositions,
    selectedKeyType,
    onKeyUpdate,
    onKeyBatchUpdate,
    onKeyPreview,
    onKeyBatchPreview,
    onStatUpdate: handleStatUpdate,
    onStatBatchUpdate: handleStatBatchUpdate,
    onStatPreview: handleStatPreview,
    onStatBatchPreview: handleStatBatchPreview,
  });

  // NOTE 탭은 "키"에만 적용되어야 함 (통계 요소 포함 다중선택 시)
  const getSelectedKeyOnlyPositions = useCallback(() => {
    return selectedKeyElements
      .map((el) => {
        const index = el.index ?? -1;
        const position = positions[selectedKeyType]?.[index];
        return position ? { index, position } : null;
      })
      .filter((v): v is { index: number; position: KeyPosition } => v !== null);
  }, [positions, selectedKeyElements, selectedKeyType]);

  const getMixedValueKeysOnly = useCallback(
    <T,>(
      getter: (pos: KeyPosition) => T | undefined,
      defaultValue: T,
    ): { isMixed: boolean; value: T } => {
      const data = getSelectedKeyOnlyPositions();
      if (data.length === 0) return { isMixed: false, value: defaultValue };

      const firstValue = getter(data[0].position) ?? defaultValue;
      const isMixed = data.some(({ position }) => {
        const val = getter(position) ?? defaultValue;
        if (typeof val === "object" && typeof firstValue === "object") {
          return JSON.stringify(val) !== JSON.stringify(firstValue);
        }
        return val !== firstValue;
      });

      return { isMixed, value: firstValue };
    },
    [getSelectedKeyOnlyPositions],
  );

  const dispatchKeyOnlyBatchUpdates = useCallback(
    (
      updates: Array<{ index: number } & Partial<KeyPosition>>,
      kind: "preview" | "commit",
    ) => {
      if (updates.length === 0) return;
      if (kind === "preview") {
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
    },
    [onKeyBatchPreview, onKeyPreview, onKeyBatchUpdate, onKeyUpdate],
  );

  const handleBatchKeyOnlyStyleChangeComplete = useCallback(
    (property: keyof KeyPosition, value: any) => {
      const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
        index,
        [property]: value,
      })) as Array<{ index: number } & Partial<KeyPosition>>;
      dispatchKeyOnlyBatchUpdates(updates, "commit");
    },
    [dispatchKeyOnlyBatchUpdates, getSelectedKeyOnlyPositions],
  );

  const handleBatchNoteColorChangeKeysOnly = useCallback(
    (value: NoteColor) => {
      const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
        index,
        noteColor: value,
      }));
      dispatchKeyOnlyBatchUpdates(updates, "preview");
    },
    [dispatchKeyOnlyBatchUpdates, getSelectedKeyOnlyPositions],
  );

  const handleBatchNoteColorChangeCompleteKeysOnly = useCallback(
    (value: NoteColor) => {
      const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
        index,
        noteColor: value,
      }));
      dispatchKeyOnlyBatchUpdates(updates, "commit");
    },
    [dispatchKeyOnlyBatchUpdates, getSelectedKeyOnlyPositions],
  );

  const handleBatchGlowColorChangeKeysOnly = useCallback(
    (value: NoteColor) => {
      const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
        index,
        noteGlowColor: value,
      }));
      dispatchKeyOnlyBatchUpdates(updates, "preview");
    },
    [dispatchKeyOnlyBatchUpdates, getSelectedKeyOnlyPositions],
  );

  const handleBatchGlowColorChangeCompleteKeysOnly = useCallback(
    (value: NoteColor) => {
      const updates = getSelectedKeyOnlyPositions().map(({ index }) => ({
        index,
        noteGlowColor: value,
      }));
      dispatchKeyOnlyBatchUpdates(updates, "commit");
    },
    [dispatchKeyOnlyBatchUpdates, getSelectedKeyOnlyPositions],
  );

  const renderPluginSettingsForm = useCallback(
    (
      schema: Record<string, PluginSettingSchema> | undefined,
      values: Record<string, any>,
      messages: PluginMessages | undefined,
      colorIdPrefix: string,
      onChange: (key: string, value: any) => void,
      options?: { wrap?: boolean },
    ) => {
      if (!schema || Object.keys(schema).length === 0) {
        return (
          <p className="text-[#6B6D75] text-style-4 text-center">
            {t("propertiesPanel.pluginNoSettings") || "설정할 항목이 없습니다."}
          </p>
        );
      }

      const translate = (key?: string, fallback?: string) => {
        if (!key) return fallback || "";
        return translatePluginMessage({
          messages,
          locale,
          key,
          fallback,
        });
      };

      const getPluginInputWidth = (
        type: "string" | "number",
        value: any,
      ): string => {
        if (type === "number") {
          return "60px";
        }
        const strVal = String(value ?? "");
        if (strVal.length <= 4) return "60px";
        if (strVal.length <= 10) return "100px";
        return "200px";
      };

      const wrap = options?.wrap !== false;
      const rows = Object.entries(schema).map(([key, setting]) => {
        const schemaValue = setting as PluginSettingSchema;
        if (schemaValue.type === "divider") {
          return <SectionDivider key={`divider-${key}`} />;
        }
        const rawValue =
          values[key] !== undefined ? values[key] : schemaValue.default;
        const labelText = translate(schemaValue.label, schemaValue.label);
        const placeholderText =
          typeof schemaValue.placeholder === "string"
            ? translate(schemaValue.placeholder, schemaValue.placeholder)
            : schemaValue.placeholder;

        let control: React.ReactNode = null;

        if (schemaValue.type === "boolean") {
          const checked = !!rawValue;
          control = (
            <Checkbox
              checked={checked}
              onChange={() => onChange(key, !checked)}
            />
          );
        } else if (schemaValue.type === "color") {
          const colorValue =
            typeof rawValue === "string"
              ? rawValue
              : (schemaValue.default as string) || "#FFFFFF";
          control = (
            <ColorInput
              value={colorValue}
              onChange={(color) => onChange(key, color)}
              colorId={`${colorIdPrefix}-${key}`}
              panelElement={panelElement}
              solidOnly={true}
            />
          );
        } else if (schemaValue.type === "number") {
          const numericValue = Number(rawValue);
          const normalizedValue = Number.isFinite(numericValue)
            ? numericValue
            : typeof schemaValue.default === "number"
              ? schemaValue.default
              : 0;
          control = (
            <NumberInput
              value={normalizedValue}
              min={schemaValue.min}
              max={schemaValue.max}
              onChange={(nextValue) => onChange(key, nextValue)}
              width={getPluginInputWidth("number", rawValue)}
            />
          );
        } else if (schemaValue.type === "string") {
          const stringValue =
            rawValue === undefined || rawValue === null ? "" : String(rawValue);
          control = (
            <TextInput
              value={stringValue}
              onChange={(nextValue) => onChange(key, nextValue)}
              placeholder={
                typeof placeholderText === "string"
                  ? placeholderText
                  : undefined
              }
              width={getPluginInputWidth("string", stringValue)}
            />
          );
        } else if (schemaValue.type === "select") {
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
            : String(schemaValue.default ?? "");
          control = (
            <Dropdown
              value={selectedValue}
              options={options}
              placeholder={
                typeof placeholderText === "string" &&
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

        if (schemaValue.type === "boolean") {
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

      if (!wrap) {
        return <>{rows}</>;
      }

      return <div className="flex flex-col gap-[12px]">{rows}</div>;
    },
    [locale, panelElement, t],
  );

  // (사이드 패널) 일괄 편집에서도 전역 컬러피커를 쓰지 않음
  // - 노트/글로우는 NoteTabContent(단일 편집)에서 로컬 ColorPicker로 처리
  // - 카운터는 CounterTabContent(단일 편집)로 로컬 ColorPicker 처리

  // 배치 편집용 interactiveRefs
  const batchColorPickerInteractiveRefs = useMemo(
    () => [
      batchNoteColorButtonRef,
      batchGlowColorButtonRef,
      batchCounterFillButtonRef,
      batchCounterStrokeButtonRef,
    ],
    [],
  );

  // 배치 피커 토글 - 열릴 때 현재 색상값으로 로컬 상태 초기화
  const handleBatchPickerToggle = useCallback(
    (target: BatchPickerTarget) => {
      if (target && target !== batchPickerFor) {
        // 피커가 열릴 때 현재 색상값으로 로컬 상태 초기화
        const keysData = getSelectedKeysData();
        const keyOnly = getSelectedKeyOnlyPositions();
        const firstPos =
          (target === "noteColor" || target === "glowColor") &&
          keyOnly.length > 0
            ? keyOnly[0].position
            : keysData[0]?.position;
        if (firstPos) {
          const counterSettings = normalizeCounterSettings(firstPos.counter);
          setBatchLocalColors({
            noteColor: (() => {
              const nc = firstPos.noteColor;
              if (
                nc &&
                typeof nc === "object" &&
                "type" in nc &&
                nc.type === "gradient"
              ) {
                return { type: "gradient", top: nc.top, bottom: nc.bottom };
              }
              return typeof nc === "string" ? nc : "#FFFFFF";
            })(),
            glowColor: (() => {
              const gc = firstPos.noteGlowColor ?? firstPos.noteColor;
              if (
                gc &&
                typeof gc === "object" &&
                "type" in gc &&
                gc.type === "gradient"
              ) {
                return { type: "gradient", top: gc.top, bottom: gc.bottom };
              }
              return typeof gc === "string" ? gc : "#FFFFFF";
            })(),
            fillIdle: counterSettings.fill.idle,
            fillActive: counterSettings.fill.active,
            strokeIdle: counterSettings.stroke.idle,
            strokeActive: counterSettings.stroke.active,
          });
          setBatchLocalOpacities({
            noteOpacity:
              typeof firstPos.noteOpacity === "number"
                ? firstPos.noteOpacity
                : 80,
            glowOpacity:
              typeof firstPos.noteGlowOpacity === "number"
                ? firstPos.noteGlowOpacity
                : 70,
          });
        }
      }
      setBatchPickerFor((prev) => (prev === target ? null : target));
    },
    [batchPickerFor, getSelectedKeyOnlyPositions, getSelectedKeysData],
  );

  // 배치 피커 색상값 가져오기 (로컬 상태 사용)
  const getBatchPickerColor = useCallback((): any => {
    switch (batchPickerFor) {
      case "noteColor":
        return batchLocalColors.noteColor;
      case "glowColor":
        return batchLocalColors.glowColor;
      case "fill":
        return batchCounterColorState === "active"
          ? batchLocalColors.fillActive
          : batchLocalColors.fillIdle;
      case "stroke":
        return batchCounterColorState === "active"
          ? batchLocalColors.strokeActive
          : batchLocalColors.strokeIdle;
      default:
        return "#FFFFFF";
    }
  }, [batchCounterColorState, batchLocalColors, batchPickerFor]);

  // 배치 피커 referenceRef
  const getBatchPickerRef = useCallback(() => {
    switch (batchPickerFor) {
      case "noteColor":
        return batchNoteColorButtonRef;
      case "glowColor":
        return batchGlowColorButtonRef;
      case "fill":
        return batchCounterFillButtonRef;
      case "stroke":
        return batchCounterStrokeButtonRef;
      default:
        return null;
    }
  }, [batchPickerFor]);

  // 배치 피커 색상 변경 (드래그 중 - 로컬 상태만 업데이트)
  const handleBatchPickerColorChange = useCallback(
    (newColor: any) => {
      if (!batchPickerFor) return;

      // 로컬 상태 업데이트
      if (batchPickerFor === "noteColor" || batchPickerFor === "glowColor") {
        setBatchLocalColors((prev) => ({
          ...prev,
          [batchPickerFor]: newColor,
        }));
      } else if (batchPickerFor === "fill") {
        const key =
          batchCounterColorState === "active" ? "fillActive" : "fillIdle";
        setBatchLocalColors((prev) => ({
          ...prev,
          [key]: newColor,
        }));
      } else if (batchPickerFor === "stroke") {
        const key =
          batchCounterColorState === "active" ? "strokeActive" : "strokeIdle";
        setBatchLocalColors((prev) => ({
          ...prev,
          [key]: newColor,
        }));
      }

      // 노트/글로우는 프리뷰도 함께 업데이트
      if (batchPickerFor === "noteColor") {
        if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
          handleBatchNoteColorChangeKeysOnly(newColor);
        } else {
          handleBatchNoteColorChange(newColor);
        }
      } else if (batchPickerFor === "glowColor") {
        if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
          handleBatchGlowColorChangeKeysOnly(newColor);
        } else {
          handleBatchGlowColorChange(newColor);
        }
      }
      // counter 색상은 preview 없이 complete에서만 처리
    },
    [
      batchCounterColorState,
      batchPickerFor,
      handleBatchGlowColorChange,
      handleBatchGlowColorChangeKeysOnly,
      handleBatchNoteColorChange,
      handleBatchNoteColorChangeKeysOnly,
      selectedKeyElements.length,
      selectedStatElements.length,
    ],
  );

  const handleBatchPickerColorChangeComplete = useCallback(
    (newColor: any) => {
      if (!batchPickerFor) return;

      // 로컬 상태 업데이트
      if (batchPickerFor === "noteColor" || batchPickerFor === "glowColor") {
        setBatchLocalColors((prev) => ({
          ...prev,
          [batchPickerFor]: newColor,
        }));
      } else if (batchPickerFor === "fill") {
        const key =
          batchCounterColorState === "active" ? "fillActive" : "fillIdle";
        setBatchLocalColors((prev) => ({
          ...prev,
          [key]: newColor,
        }));
      } else if (batchPickerFor === "stroke") {
        const key =
          batchCounterColorState === "active" ? "strokeActive" : "strokeIdle";
        setBatchLocalColors((prev) => ({
          ...prev,
          [key]: newColor,
        }));
      }

      const keysData = getSelectedKeysData();
      const firstCounter = keysData[0]?.position
        ? normalizeCounterSettings(keysData[0].position.counter)
        : createDefaultCounterSettings();

      if (batchPickerFor === "noteColor") {
        if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
          handleBatchNoteColorChangeCompleteKeysOnly(newColor);
        } else {
          handleBatchNoteColorChangeComplete(newColor);
        }
      } else if (batchPickerFor === "glowColor") {
        if (selectedKeyElements.length > 0 && selectedStatElements.length > 0) {
          handleBatchGlowColorChangeCompleteKeysOnly(newColor);
        } else {
          handleBatchGlowColorChangeComplete(newColor);
        }
      } else if (batchPickerFor === "fill") {
        if (batchCounterColorState === "active") {
          handleBatchCounterUpdate({
            fill: { ...firstCounter.fill, active: newColor },
          });
        } else {
          handleBatchCounterUpdate({
            fill: { ...firstCounter.fill, idle: newColor },
          });
        }
      } else if (batchPickerFor === "stroke") {
        if (batchCounterColorState === "active") {
          handleBatchCounterUpdate({
            stroke: { ...firstCounter.stroke, active: newColor },
          });
        } else {
          handleBatchCounterUpdate({
            stroke: { ...firstCounter.stroke, idle: newColor },
          });
        }
      }
    },
    [
      batchCounterColorState,
      batchPickerFor,
      getSelectedKeysData,
      handleBatchNoteColorChangeComplete,
      handleBatchNoteColorChangeCompleteKeysOnly,
      handleBatchGlowColorChangeComplete,
      handleBatchGlowColorChangeCompleteKeysOnly,
      handleBatchCounterUpdate,
      selectedKeyElements.length,
      selectedStatElements.length,
    ],
  );

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
          title={t("propertiesPanel.openPanel") || "속성 패널 열기"}
        >
          <SidebarToggleIcon isOpen={false} />
        </button>
      </div>
    );
  }

  if (pluginSettingsPanel) {
    return (
      <div
        ref={setPanelElement}
        className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
      >
        <div className="flex items-center justify-between p-[12px] border-b border-[#3A3943]">
          <div className="flex flex-col gap-[2px]">
            <span className="text-[#DBDEE8] text-style-2">
              {t("propertiesPanel.pluginSettings") || "플러그인 설정"}
            </span>
            <span className="text-[#6B6D75] text-style-4 truncate max-w-[150px]">
              {pluginSettingsPanel.pluginId}
            </span>
          </div>
          <button
            onClick={handlePluginSettingsPanelCancel}
            className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
            title={t("propertiesPanel.closePanel") || "속성 패널 닫기"}
          >
            <SidebarToggleIcon isOpen={true} />
          </button>
        </div>
        <div className="flex-1 properties-panel-overlay-scroll">
          <div
            ref={setPluginScrollRef}
            className="properties-panel-overlay-viewport"
          >
            <div className="p-[12px]">
              {renderPluginSettingsForm(
                pluginSettingsPanel.definition.settings,
                pluginPanelSettings,
                pluginSettingsPanel.definition.messages,
                `plugin-settings-${pluginSettingsPanel.pluginId}`,
                handlePluginSettingsPanelChange,
              )}
            </div>
            <div className="properties-panel-overlay-bar">
              <div
                ref={setPluginThumbRef}
                className="properties-panel-overlay-thumb"
                style={{ display: "none" }}
              />
            </div>
          </div>
        </div>
        <div className="border-t border-[#3A3943] p-[12px]">
          <div className="flex gap-[8px]">
            <button
              onClick={handlePluginSettingsPanelCancel}
              className="flex-1 h-[30px] bg-[#2A2A30] border border-[#3A3943] rounded-[7px] text-style-3 text-[#DBDEE8] hover:bg-[#303036] transition-colors"
            >
              {t("common.cancel") || "취소"}
            </button>
            <button
              onClick={handlePluginSettingsPanelConfirm}
              className="flex-1 h-[30px] bg-[#2A2A30] border border-[#3A3943] rounded-[7px] text-style-3 text-[#DBDEE8] hover:bg-[#303036] transition-colors"
            >
              {t("common.save") || "저장"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 레이어 모드일 때는 선택 여부와 관계없이 레이어 패널 표시
  if (panelMode === "layer") {
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

  // 선택된 키 요소가 없으면 레이어 패널 표시 (panelMode가 property여도)
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

  // 다중 선택인 경우 (키 + 통계 요소)
  if (
    selectedKeyLikeElements.length > 1 &&
    selectedPluginElements.length === 0
  ) {
    const getBatchNoteColorDisplay = () => {
      // 노트 피커가 열려있으면 로컬 상태 사용
      if (batchPickerFor === "noteColor") {
        const value = batchLocalColors.noteColor;
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "gradient"
        ) {
          return {
            style: {
              background: `linear-gradient(to bottom, ${value.top}, ${value.bottom})`,
            },
            label: "Gradient",
            isMixed: false,
          };
        }
        const color = typeof value === "string" ? value : "#FFFFFF";
        return {
          style: { backgroundColor: color },
          label: color.replace(/^#/, ""),
          isMixed: false,
        };
      }

      const mixedFn =
        selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
      const { isMixed, value } = mixedFn((pos) => pos.noteColor, "#FFFFFF");
      if (isMixed)
        return {
          style: { backgroundColor: "#666" },
          label: "Mixed",
          isMixed: true,
        };
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        value.type === "gradient"
      ) {
        return {
          style: {
            background: `linear-gradient(to bottom, ${value.top}, ${value.bottom})`,
          },
          label: "Gradient",
          isMixed: false,
        };
      }
      const color = typeof value === "string" ? value : "#FFFFFF";
      return {
        style: { backgroundColor: color },
        label: color.replace(/^#/, ""),
        isMixed: false,
      };
    };

    const getBatchGlowColorDisplay = () => {
      // 글로우 피커가 열려있으면 로컬 상태 사용
      if (batchPickerFor === "glowColor") {
        const value = batchLocalColors.glowColor;
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "gradient"
        ) {
          return {
            style: {
              background: `linear-gradient(to bottom, ${value.top}, ${value.bottom})`,
            },
            label: "Gradient",
            isMixed: false,
          };
        }
        const color = typeof value === "string" ? value : "#FFFFFF";
        return {
          style: { backgroundColor: color },
          label: color.replace(/^#/, ""),
          isMixed: false,
        };
      }

      const mixedFn =
        selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
      const { isMixed, value } = mixedFn(
        (pos) => pos.noteGlowColor ?? pos.noteColor,
        "#FFFFFF",
      );
      if (isMixed)
        return {
          style: { backgroundColor: "#666" },
          label: "Mixed",
          isMixed: true,
        };
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        value.type === "gradient"
      ) {
        return {
          style: {
            background: `linear-gradient(to bottom, ${value.top}, ${value.bottom})`,
          },
          label: "Gradient",
          isMixed: false,
        };
      }
      const color = typeof value === "string" ? value : "#FFFFFF";
      return {
        style: { backgroundColor: color },
        label: color.replace(/^#/, ""),
        isMixed: false,
      };
    };

    const keysData = getSelectedKeysData();
    const batchCounterSettings = keysData[0]?.position
      ? normalizeCounterSettings(keysData[0].position.counter)
      : createDefaultCounterSettings();
    const noteOpacityMixed = getMixedValue(
      (pos) => pos.noteOpacity,
      80,
    ).isMixed;
    const glowOpacityMixed = getMixedValue(
      (pos) => pos.noteGlowOpacity,
      70,
    ).isMixed;

    // 카운터 색상 표시 (피커가 열려있을 때는 로컬 상태 사용)
    const getCounterColorDisplay = (target: "fill" | "stroke") => {
      const key =
        target === "fill"
          ? batchCounterColorState === "active"
            ? "fillActive"
            : "fillIdle"
          : batchCounterColorState === "active"
            ? "strokeActive"
            : "strokeIdle";

      if (batchPickerFor === target) {
        return batchLocalColors[key];
      }

      return target === "fill"
        ? batchCounterColorState === "active"
          ? batchCounterSettings.fill.active
          : batchCounterSettings.fill.idle
        : batchCounterColorState === "active"
          ? batchCounterSettings.stroke.active
          : batchCounterSettings.stroke.idle;
    };

    return (
      <div
        ref={setPanelElement}
        className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
      >
        {/* 헤더 + 탭 영역 */}
        <div className="flex-shrink-0 border-b border-[#3A3943]">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-[12px] pb-[8px]">
            <div className="flex items-center gap-[8px]">
              <span className="text-[#DBDEE8] text-style-2">
                {t("propertiesPanel.multiSelection") || "다중 선택"}
              </span>
              <span className="text-[#6B6D75] text-style-4">
                ({selectedKeyLikeElements.length})
              </span>
            </div>
            <div className="flex items-center gap-[4px]">
              {/* 레이어 모드로 전환 버튼 */}
              <button
                onClick={handleToggleMode}
                className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
                title={t("propertiesPanel.switchToLayer") || "Switch to Layer"}
              >
                <ModeToggleIcon mode="layer" />
              </button>
              {/* 패널 닫기 버튼 */}
              <button
                onClick={handleTogglePanel}
                className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
                title={t("propertiesPanel.closePanel") || "속성 패널 닫기"}
              >
                <SidebarToggleIcon isOpen={true} />
              </button>
            </div>
          </div>

          {/* 탭 */}
          <div className="px-[12px] pb-[12px]">
            <Tabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              t={t}
              availableTabs={
                selectedKeyElements.length > 0
                  ? [TABS.STYLE, TABS.NOTE, TABS.COUNTER]
                  : [TABS.STYLE, TABS.COUNTER]
              }
            />
          </div>
        </div>

        {/* 일괄 편집 모드 체크박스 */}
        {/* 일괄 편집 모드 */}
        <>
          {/* 스크롤 가능한 속성 영역 (탭별 독립 스크롤) */}
          <div className="flex-1 properties-panel-overlay-scroll">
            {/* STYLE 탭 viewport */}
            <div
              ref={batchScrollRefFor(TABS.STYLE)}
              className={`properties-panel-overlay-viewport ${
                activeTab === TABS.STYLE ? "" : "hidden"
              }`}
            >
              <div className="p-[12px] flex flex-col gap-[12px]">
                <BatchStyleTabContent
                  selectedCount={selectedKeyLikeElements.length}
                  getMixedValue={getMixedValue}
                  getSelectedKeysData={getSelectedKeysData}
                  handleBatchAlign={handleBatchAlign}
                  handleBatchDistribute={handleBatchDistribute}
                  handleBatchResize={handleBatchResize}
                  handleBatchStyleChange={handleBatchStyleChange}
                  handleBatchStyleChangeComplete={
                    handleBatchStyleChangeComplete
                  }
                  showBatchImagePicker={showBatchImagePicker}
                  onToggleBatchImagePicker={() =>
                    setShowBatchImagePicker(!showBatchImagePicker)
                  }
                  batchImageButtonRef={batchImageButtonRef}
                  panelElement={panelElement}
                  useCustomCSS={useCustomCSS}
                  t={t}
                />
              </div>
              <div className="properties-panel-overlay-bar">
                <div
                  ref={batchThumbRefFor(TABS.STYLE)}
                  className="properties-panel-overlay-thumb"
                  style={{ display: "none" }}
                />
              </div>
            </div>

            {/* NOTE 탭 viewport (키 선택이 있을 때만 표시; 설정은 키에만 반영) */}
            {selectedKeyElements.length > 0 && (
              <div
                ref={batchScrollRefFor(TABS.NOTE)}
                className={`properties-panel-overlay-viewport ${
                  activeTab === TABS.NOTE ? "" : "hidden"
                }`}
              >
                <div className="p-[12px] flex flex-col gap-[12px]">
                  <BatchNoteTabContent
                    getMixedValue={getMixedValueKeysOnly}
                    handleBatchStyleChangeComplete={
                      handleBatchKeyOnlyStyleChangeComplete
                    }
                    getBatchNoteColorDisplay={getBatchNoteColorDisplay}
                    getBatchGlowColorDisplay={getBatchGlowColorDisplay}
                    onNoteColorPickerToggle={() =>
                      handleBatchPickerToggle("noteColor")
                    }
                    onGlowColorPickerToggle={() =>
                      handleBatchPickerToggle("glowColor")
                    }
                    isNoteColorPickerOpen={batchPickerFor === "noteColor"}
                    isGlowColorPickerOpen={batchPickerFor === "glowColor"}
                    batchNoteColorButtonRef={batchNoteColorButtonRef}
                    batchGlowColorButtonRef={batchGlowColorButtonRef}
                    t={t}
                  />
                </div>
                <div className="properties-panel-overlay-bar">
                  <div
                    ref={batchThumbRefFor(TABS.NOTE)}
                    className="properties-panel-overlay-thumb"
                    style={{ display: "none" }}
                  />
                </div>
              </div>
            )}

            {/* COUNTER 탭 viewport */}
            <div
              ref={batchScrollRefFor(TABS.COUNTER)}
              className={`properties-panel-overlay-viewport ${
                activeTab === TABS.COUNTER ? "" : "hidden"
              }`}
            >
              <div className="p-[12px] flex flex-col gap-[12px]">
                <BatchCounterTabContent
                  batchCounterSettings={batchCounterSettings}
                  handleBatchCounterUpdate={handleBatchCounterUpdate}
                  colorState={batchCounterColorState}
                  getCounterColorDisplay={getCounterColorDisplay}
                  onFillPickerToggle={() => handleBatchPickerToggle("fill")}
                  onStrokePickerToggle={() => handleBatchPickerToggle("stroke")}
                  batchCounterFillButtonRef={batchCounterFillButtonRef}
                  batchCounterStrokeButtonRef={batchCounterStrokeButtonRef}
                  isFillPickerOpen={batchPickerFor === "fill"}
                  isStrokePickerOpen={batchPickerFor === "stroke"}
                  panelElement={panelElement}
                  t={t}
                />
              </div>
              <div className="properties-panel-overlay-bar">
                <div
                  ref={batchThumbRefFor(TABS.COUNTER)}
                  className="properties-panel-overlay-thumb"
                  style={{ display: "none" }}
                />
              </div>
            </div>
          </div>

          {/* 배치 편집용 로컬 ColorPicker (모든 탭 공통) */}
          {batchPickerFor && (
            <ColorPicker
              open={!!batchPickerFor}
              referenceRef={getBatchPickerRef()}
              panelElement={panelElement}
              color={getBatchPickerColor()}
              onColorChange={handleBatchPickerColorChange}
              onColorChangeComplete={handleBatchPickerColorChangeComplete}
              onClose={() => setBatchPickerFor(null)}
              interactiveRefs={batchColorPickerInteractiveRefs}
              solidOnly={
                batchPickerFor !== "noteColor" && batchPickerFor !== "glowColor"
              }
              stateMode={
                batchPickerFor === "fill" || batchPickerFor === "stroke"
                  ? batchCounterColorState
                  : undefined
              }
              onStateModeChange={
                batchPickerFor === "fill" || batchPickerFor === "stroke"
                  ? setBatchCounterColorState
                  : undefined
              }
              opacityPercent={
                batchPickerFor === "noteColor"
                  ? batchLocalOpacities.noteOpacity
                  : batchPickerFor === "glowColor"
                    ? batchLocalOpacities.glowOpacity
                    : undefined
              }
              onOpacityPercentChange={(value: number) => {
                if (batchPickerFor === "noteColor") {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    noteOpacity: value,
                  }));
                  handleBatchStyleChange("noteOpacity", value);
                } else if (batchPickerFor === "glowColor") {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    glowOpacity: value,
                  }));
                  handleBatchStyleChange("noteGlowOpacity", value);
                }
              }}
              onOpacityPercentChangeComplete={(value: number) => {
                if (batchPickerFor === "noteColor") {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    noteOpacity: value,
                  }));
                  handleBatchStyleChangeComplete("noteOpacity", value);
                } else if (batchPickerFor === "glowColor") {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    glowOpacity: value,
                  }));
                  handleBatchStyleChangeComplete("noteGlowOpacity", value);
                }
              }}
              opacityPercentLabel={
                batchPickerFor === "noteColor"
                  ? t("keySetting.noteOpacity") || "노트 투명도"
                  : batchPickerFor === "glowColor"
                    ? t("keySetting.noteGlowOpacity") || "글로우 투명도"
                    : undefined
              }
              opacityPercentMixed={
                batchPickerFor === "noteColor"
                  ? noteOpacityMixed
                  : batchPickerFor === "glowColor"
                    ? glowOpacityMixed
                    : false
              }
            />
          )}

          {/* 다중 선택용 ImagePicker */}
          {showBatchImagePicker && batchImageButtonRef.current && (
            <ImagePicker
              open={showBatchImagePicker}
              referenceRef={batchImageButtonRef}
              panelElement={panelElement}
              idleImage={
                getMixedValue((pos) => pos.inactiveImage, "").isMixed
                  ? ""
                  : getMixedValue((pos) => pos.inactiveImage, "").value
              }
              activeImage={
                getMixedValue((pos) => pos.activeImage, "").isMixed
                  ? ""
                  : getMixedValue((pos) => pos.activeImage, "").value
              }
              idleTransparent={
                getMixedValue((pos) => pos.idleTransparent, false).value
              }
              activeTransparent={
                getMixedValue((pos) => pos.activeTransparent, false).value
              }
              onIdleImageChange={(imageUrl: string) => {
                handleBatchStyleChangeComplete("inactiveImage", imageUrl);
              }}
              onActiveImageChange={(imageUrl: string) => {
                handleBatchStyleChangeComplete("activeImage", imageUrl);
              }}
              onIdleTransparentChange={(value: boolean) => {
                handleBatchStyleChangeComplete("idleTransparent", value);
              }}
              onActiveTransparentChange={(value: boolean) => {
                handleBatchStyleChangeComplete("activeTransparent", value);
              }}
              onIdleImageReset={() => {
                handleBatchStyleChangeComplete("inactiveImage", "");
              }}
              onActiveImageReset={() => {
                handleBatchStyleChangeComplete("activeImage", "");
              }}
              onClose={() => setShowBatchImagePicker(false)}
            />
          )}
        </>
      </div>
    );
  }

  // 플러그인 요소가 선택된 경우 (키/통계 요소가 없을 때만)
  if (
    selectedPluginElements.length > 0 &&
    selectedKeyLikeElements.length === 0 &&
    selectedGraphElements.length === 0
  ) {
    const pluginTitle =
      selectedPluginDefinition?.name ||
      selectedPluginElement?.definitionId ||
      t("propertiesPanel.pluginElement") ||
      "Plugin";

    return (
      <div
        ref={setPanelElement}
        className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
      >
        <div className="flex items-center justify-between p-[12px] border-b border-[#3A3943]">
          <span className="text-[#DBDEE8] text-style-2 truncate max-w-[120px]">
            {pluginTitle}
          </span>
          <div className="flex items-center gap-[4px]">
            <button
              onClick={handleToggleMode}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
              title={t("propertiesPanel.switchToLayer") || "Switch to Layer"}
            >
              <ModeToggleIcon mode="layer" />
            </button>
            <button
              onClick={handleTogglePanel}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
              title={t("propertiesPanel.closePanel") || "속성 패널 닫기"}
            >
              <SidebarToggleIcon isOpen={true} />
            </button>
          </div>
        </div>
        <div className="flex-1 properties-panel-overlay-scroll">
          <div
            ref={setPluginScrollRef}
            className="properties-panel-overlay-viewport"
          >
            <div className="p-[12px] flex flex-col gap-[12px]">
              {isPluginResizable && (
                <>
                  <PropertyRow label={t("propertiesPanel.position") || "위치"}>
                    <NumberInput
                      value={selectedPluginElement?.position.x ?? 0}
                      onChange={handlePluginPositionXChange}
                      prefix="X"
                      min={-9999}
                      max={9999}
                    />
                    <NumberInput
                      value={selectedPluginElement?.position.y ?? 0}
                      onChange={handlePluginPositionYChange}
                      prefix="Y"
                      min={-9999}
                      max={9999}
                    />
                  </PropertyRow>
                  <PropertyRow label={t("propertiesPanel.size") || "크기"}>
                    <NumberInput
                      value={pluginDisplaySize.width}
                      onChange={handlePluginWidthChange}
                      prefix="W"
                      min={10}
                      max={9999}
                    />
                    <NumberInput
                      value={pluginDisplaySize.height}
                      onChange={handlePluginHeightChange}
                      prefix="H"
                      min={10}
                      max={9999}
                    />
                  </PropertyRow>
                  <SectionDivider />
                </>
              )}
              {!hasSinglePluginSelection && (
                <p className="text-[#6B6D75] text-style-4 text-center">
                  {t("propertiesPanel.pluginMultiSelection") ||
                    "플러그인 요소는 한 번에 하나만 편집할 수 있습니다."}
                </p>
              )}
              {hasSinglePluginSelection && showModalHint && (
                <p className="text-[#6B6D75] text-style-4 text-center">
                  {t("propertiesPanel.pluginModalHint") ||
                    "이 플러그인은 설정 모달을 사용합니다. 요소를 클릭해 설정하세요."}
                </p>
              )}
              {showSettings &&
                renderPluginSettingsForm(
                  selectedPluginDefinition?.settings,
                  resolvedPluginSettings,
                  selectedPluginDefinition?.messages,
                  `plugin-element-${
                    selectedPluginElement?.fullId ?? "unknown"
                  }`,
                  handlePluginSettingChange,
                  { wrap: false },
                )}
            </div>
            <div className="properties-panel-overlay-bar">
              <div
                ref={setPluginThumbRef}
                className="properties-panel-overlay-thumb"
                style={{ display: "none" }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 단일 그래프 요소 선택인 경우
  if (
    selectedGraphElements.length === 1 &&
    !!singleGraphPosition &&
    selectedKeyLikeElements.length === 0 &&
    selectedPluginElements.length === 0
  ) {
    const graphShapeOptions = [
      {
        label: t("propertiesPanel.graphShapeLine") || "Line",
        value: "line",
      },
      {
        label: t("propertiesPanel.graphShapeBar") || "Bar",
        value: "bar",
      },
    ];

    const resolvedGraphStatType =
      (singleGraphPosition.statType as StatItemType) || "kps";
    const graphTitle = `${getStatTypeLabel(resolvedGraphStatType)} Graph`;

    return (
      <div
        ref={setPanelElement}
        className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
      >
        <div className="flex items-center justify-between p-[12px] border-b border-[#3A3943]">
          <span className="text-[#DBDEE8] text-style-2 truncate max-w-[120px]">
            {graphTitle}
          </span>
          <div className="flex items-center gap-[4px]">
            <button
              onClick={handleToggleMode}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
              title={t("propertiesPanel.switchToLayer") || "Switch to Layer"}
            >
              <ModeToggleIcon mode="layer" />
            </button>
            <button
              onClick={handleTogglePanel}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
              title={t("propertiesPanel.closePanel") || "Close"}
            >
              <SidebarToggleIcon isOpen={true} />
            </button>
          </div>
        </div>
        <div className="flex-1 properties-panel-overlay-scroll">
          <div className="properties-panel-overlay-viewport">
            <div className="p-[12px] flex flex-col gap-[12px]">
              <PropertyRow label={t("propertiesPanel.position") || "Position"}>
                <NumberInput
                  value={Math.round(singleGraphPosition.dx || 0)}
                  onChange={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      dx: value,
                    } as any)
                  }
                  prefix="X"
                  min={-9999}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleGraphPosition.dy || 0)}
                  onChange={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      dy: value,
                    } as any)
                  }
                  prefix="Y"
                  min={-9999}
                  max={9999}
                />
              </PropertyRow>

              <PropertyRow label={t("propertiesPanel.size") || "Size"}>
                <NumberInput
                  value={Math.round(singleGraphPosition.width || 200)}
                  onChange={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      width: Math.max(20, value),
                    } as any)
                  }
                  prefix="W"
                  min={20}
                  max={9999}
                />
                <NumberInput
                  value={Math.round(singleGraphPosition.height || 100)}
                  onChange={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      height: Math.max(20, value),
                    } as any)
                  }
                  prefix="H"
                  min={20}
                  max={9999}
                />
              </PropertyRow>

              <SectionDivider />

              <PropertyRow
                label={t("propertiesPanel.graphShape") || "Graph Shape"}
              >
                <Dropdown
                  options={graphShapeOptions}
                  value={singleGraphPosition.graphType || "line"}
                  onChange={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      graphType: value as any,
                    } as any)
                  }
                />
              </PropertyRow>

              <PropertyRow
                label={t("propertiesPanel.graphSpeed") || "Graph Speed"}
              >
                <NumberInput
                  value={Math.round(singleGraphPosition.graphSpeed || 1000)}
                  width="62px"
                  onChange={(value) => {
                    const clamped = Math.max(500, Math.min(5000, value));
                    const snapped = Math.round(clamped / 100) * 100;
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      graphSpeed: snapped,
                    } as any);
                  }}
                  min={500}
                  max={5000}
                  suffix="ms"
                />
              </PropertyRow>

              <PropertyRow
                label={t("propertiesPanel.graphColor") || "Graph Color"}
              >
                <ColorInput
                  value={singleGraphPosition.graphColor || "#86EFAC"}
                  onChange={() => {}}
                  onChangeComplete={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      graphColor: value,
                    } as any)
                  }
                  colorId={`graph-color-${selectedKeyType}-${singleGraphIndex}`}
                  panelElement={panelElement}
                />
              </PropertyRow>

              <SectionDivider />

              <PropertyRow
                label={t("propertiesPanel.backgroundColor") || "Background Color"}
              >
                <ColorInput
                  value={
                    singleGraphPosition.backgroundColor || "rgba(17, 17, 20, 0.9)"
                  }
                  onChange={() => {}}
                  onChangeComplete={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      backgroundColor: value,
                    } as any)
                  }
                  colorId={`graph-bg-color-${selectedKeyType}-${singleGraphIndex}`}
                  panelElement={panelElement}
                />
              </PropertyRow>

              <PropertyRow
                label={t("propertiesPanel.borderColor") || "Border Color"}
              >
                <ColorInput
                  value={
                    singleGraphPosition.borderColor || "rgba(255, 255, 255, 0.1)"
                  }
                  onChange={() => {}}
                  onChangeComplete={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      borderColor: value,
                    } as any)
                  }
                  colorId={`graph-border-color-${selectedKeyType}-${singleGraphIndex}`}
                  panelElement={panelElement}
                />
              </PropertyRow>

              <PropertyRow
                label={t("propertiesPanel.borderWidth") || "Border Width"}
              >
                <NumberInput
                  value={Math.round(singleGraphPosition.borderWidth ?? 1)}
                  width="62px"
                  onChange={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      borderWidth: Math.max(0, Math.min(20, value)),
                    } as any)
                  }
                  min={0}
                  max={20}
                  suffix="px"
                />
              </PropertyRow>

              <PropertyRow
                label={t("propertiesPanel.borderRadius") || "Border Radius"}
              >
                <NumberInput
                  value={Math.round(singleGraphPosition.borderRadius ?? 8)}
                  width="62px"
                  onChange={(value) =>
                    handleGraphUpdate({
                      index: singleGraphIndex!,
                      borderRadius: Math.max(0, Math.min(100, value)),
                    } as any)
                  }
                  min={0}
                  max={100}
                  suffix="px"
                />
              </PropertyRow>

              <PropertyRow
                label={t("propertiesPanel.customImage") || "Custom Image"}
              >
                <button
                  ref={graphImageButtonRef}
                  type="button"
                  className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
                    showGraphImagePicker
                      ? "border-[#459BF8]"
                      : "border-[#3A3943]"
                  } text-[#DBDEE8] text-style-4`}
                  onClick={() => setShowGraphImagePicker(!showGraphImagePicker)}
                >
                  {t("propertiesPanel.configure") || "Configure"}
                </button>
              </PropertyRow>
            </div>
          </div>
        </div>

        {showGraphImagePicker && graphImageButtonRef.current && (
          <ImagePicker
            open={showGraphImagePicker}
            referenceRef={graphImageButtonRef}
            panelElement={panelElement}
            idleImage={singleGraphPosition.inactiveImage || ""}
            activeImage={singleGraphPosition.activeImage || ""}
            idleTransparent={false}
            activeTransparent={false}
            idleImageFit={
              singleGraphPosition.idleImageFit ||
              singleGraphPosition.imageFit ||
              "cover"
            }
            activeImageFit={
              singleGraphPosition.activeImageFit ||
              singleGraphPosition.imageFit ||
              "cover"
            }
            onIdleImageChange={(imageUrl: string) =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                inactiveImage: imageUrl,
              } as any)
            }
            onActiveImageChange={(imageUrl: string) =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                activeImage: imageUrl,
              } as any)
            }
            onIdleTransparentChange={(value: boolean) =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                idleTransparent: value,
              } as any)
            }
            onActiveTransparentChange={(value: boolean) =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                activeTransparent: value,
              } as any)
            }
            onIdleImageFitChange={(fit: any) =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                idleImageFit: fit,
              } as any)
            }
            onActiveImageFitChange={(fit: any) =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                activeImageFit: fit,
              } as any)
            }
            onIdleImageReset={() =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                inactiveImage: "",
              } as any)
            }
            onActiveImageReset={() =>
              handleGraphUpdate({
                index: singleGraphIndex!,
                activeImage: "",
              } as any)
            }
            onClose={() => setShowGraphImagePicker(false)}
          />
        )}
      </div>
    );
  }

  // 단일 키/통계 요소 선택인 경우
  const isSingleStat = !singleKeyPosition && !!singleStatPosition;
  const isSingleKey = !!singleKeyPosition;
  if (!isSingleKey && !isSingleStat) {
    return null;
  }

  const availableTabs = isSingleStat
    ? [TABS.STYLE, TABS.COUNTER]
    : [TABS.STYLE, TABS.NOTE, TABS.COUNTER];

  const statBaseOptions = [
    { label: "KPS", value: "kps" },
    { label: "Total", value: "total" },
  ];

  const statKpsOptions = [
    { label: "KPS", value: "kps" },
    { label: "AVG", value: "kpsAvg" },
    { label: "MAX", value: "kpsMax" },
  ];

  const resolvedStatType =
    (singleStatPosition?.statType as StatItemType) || "kps";
  const statBaseValue = resolvedStatType === "total" ? "total" : "kps";
  const statTitle = getStatTypeLabel(resolvedStatType);

  const keyLikeIndex = isSingleStat ? singleStatIndex! : singleKeyIndex!;
  const keyLikePosition = (
    isSingleStat ? singleStatPosition! : singleKeyPosition!
  ) as any;

  const keyLikeTitle = isSingleStat
    ? statTitle
    : singleKeyInfo?.displayName || singleKeyCode || "Key";

  const keyLikeCode = isSingleStat ? null : singleKeyCode;
  const keyLikeInfo = isSingleStat
    ? ({
        browserKey: statTitle,
        globalKey: statTitle,
        displayName: statTitle,
      } as any)
    : singleKeyInfo;

  const handleKeyLikePositionChange = isSingleStat
    ? (index: number, dx: number, dy: number) =>
        handleStatUpdate({ index, dx, dy } as any)
    : onPositionChange;

  const handleKeyLikeUpdate = isSingleStat
    ? (data: Partial<KeyPosition> & { index: number }) =>
        handleStatUpdate(data as any)
    : onKeyUpdate;

  const handleKeyLikePreview = isSingleStat
    ? (index: number, updates: Partial<KeyPosition>) =>
        handleStatPreview(index, updates as any)
    : onKeyPreview;

  const mappingControlLayout = isSingleStat ? (
    <>
      <PropertyRow label={t("propertiesPanel.statType") || "Stat Type"}>
        <Dropdown
          options={statBaseOptions}
          value={statBaseValue}
          onChange={(value) => {
            if (value === "total") {
              handleStatUpdate({
                index: singleStatIndex!,
                statType: "total",
              });
              return;
            }
            handleStatUpdate({
              index: singleStatIndex!,
              statType: resolvedStatType === "total" ? "kps" : resolvedStatType,
            });
          }}
        />
      </PropertyRow>
      {statBaseValue === "kps" ? (
        <PropertyRow label={t("propertiesPanel.statKpsType") || "KPS Type"}>
          <Dropdown
            options={statKpsOptions}
            value={resolvedStatType}
            onChange={(value) =>
              handleStatUpdate({
                index: singleStatIndex!,
                statType: value as StatItemType,
              })
            }
          />
        </PropertyRow>
      ) : null}
    </>
  ) : undefined;

  return (
    <div
      ref={setPanelElement}
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
    >
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0 border-b border-[#3A3943]">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-[12px] pb-[8px]">
          <span className="text-[#DBDEE8] text-style-2">{keyLikeTitle}</span>

          <div className="flex items-center gap-[4px]">
            {/* 레이어 모드로 전환 버튼 */}
            <button
              onClick={handleToggleMode}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
              title={t("propertiesPanel.switchToLayer") || "Switch to Layer"}
            >
              <ModeToggleIcon mode="layer" />
            </button>
            {/* 패널 닫기 버튼 */}
            <button
              onClick={handleTogglePanel}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
              title={t("propertiesPanel.closePanel") || "속성 패널 닫기"}
            >
              <SidebarToggleIcon isOpen={true} />
            </button>
          </div>
        </div>

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
            activeTab === TABS.STYLE ? "" : "hidden"
          }`}
        >
          <div className="p-[12px] flex flex-col gap-[12px]">
            <StyleTabContent
              keyIndex={keyLikeIndex}
              keyPosition={keyLikePosition}
              keyCode={keyLikeCode}
              keyInfo={keyLikeInfo}
              onPositionChange={handleKeyLikePositionChange}
              onKeyUpdate={handleKeyLikeUpdate}
              onKeyPreview={handleKeyLikePreview}
              onKeyMappingChange={isSingleStat ? undefined : onKeyMappingChange}
              isListening={isListening}
              onKeyListen={isSingleStat ? undefined : handleKeyListen}
              mappingControlLayout={mappingControlLayout}
              mappingLabel={
                isSingleStat
                  ? t("propertiesPanel.statType") || "Stat Type"
                  : undefined
              }
              showImagePicker={showImagePicker}
              onToggleImagePicker={() => setShowImagePicker(!showImagePicker)}
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
              onSizeBlur={handleSizeBlur}
            />
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={singleThumbRefFor(TABS.STYLE)}
              className="properties-panel-overlay-thumb"
              style={{ display: "none" }}
            />
          </div>
        </div>

        {/* NOTE 탭 viewport */}
        {!isSingleStat && (
          <div
            ref={singleScrollRefFor(TABS.NOTE)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.NOTE ? "" : "hidden"
            }`}
          >
            <div className="p-[12px] flex flex-col gap-[12px]">
              <NoteTabContent
                keyIndex={singleKeyIndex!}
                keyPosition={singleKeyPosition!}
                onKeyUpdate={onKeyUpdate}
                onKeyPreview={onKeyPreview}
                panelElement={panelElement}
                t={t}
              />
            </div>
            <div className="properties-panel-overlay-bar">
              <div
                ref={singleThumbRefFor(TABS.NOTE)}
                className="properties-panel-overlay-thumb"
                style={{ display: "none" }}
              />
            </div>
          </div>
        )}

        {/* COUNTER 탭 viewport */}
        <div
          ref={singleScrollRefFor(TABS.COUNTER)}
          className={`properties-panel-overlay-viewport ${
            activeTab === TABS.COUNTER ? "" : "hidden"
          }`}
        >
          <div className="p-[12px] flex flex-col gap-[12px]">
            <CounterTabContent
              keyIndex={keyLikeIndex}
              keyPosition={keyLikePosition}
              onKeyUpdate={handleKeyLikeUpdate}
              panelElement={panelElement}
              t={t}
            />
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={singleThumbRefFor(TABS.COUNTER)}
              className="properties-panel-overlay-thumb"
              style={{ display: "none" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertiesPanel;
