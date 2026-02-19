import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@contexts/I18nContext";
import { useGridSelectionStore } from "@stores/useGridSelectionStore";
import { useKeyStore } from "@stores/useKeyStore";
import { useStatItemStore } from "@stores/useStatItemStore";
import { useGraphItemStore } from "@stores/useGraphItemStore";
import { usePluginDisplayElementStore } from "@stores/usePluginDisplayElementStore";
import { useHistoryStore } from "@stores/useHistoryStore";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { useLenis } from "@hooks/useLenis";
import ListPopup, { type ListItem } from "@components/main/Modal/ListPopup";
import CloseEyeIcon from "@assets/svgs/close_eye.svg";
import OpenEyeIcon from "@assets/svgs/open_eye.svg";
import { useLayerGroupStore } from "@stores/useLayerGroupStore";
import type { LayerGroups } from "@src/types/layerGroups";
import {
  applyGroupIdToSelectedElements,
  buildNextLayerGroupName,
  normalizeLayerGroupsForMode,
  resolveSingleGroupIdFromSelection,
} from "@utils/layerGroupUtils";

// ============================================================================
// 레이어 아이템 타입
// ============================================================================

interface LayerItem {
  type: "key" | "stat" | "graph" | "plugin";
  id: string;
  index?: number; // key/stat인 경우
  name: string;
  zIndex: number;
  hidden: boolean;
  groupId?: string;
}

// ============================================================================
// 그룹 헤더 / 디스플레이 아이템 타입
// ============================================================================

interface GroupHeaderItem {
  displayType: "group-header";
  groupId: string;
  groupName: string;
  isCollapsed: boolean;
  childCount: number;
  allHidden: boolean;
}

interface LayerDisplayItem {
  displayType: "layer";
  item: LayerItem;
  groupDepth: number; // 0 = ungrouped, 1 = in group
  flatIndex: number; // index in the original layerItems array
}

type DisplayItem = GroupHeaderItem | LayerDisplayItem;

// ============================================================================
// 그룹 폴더 아이콘
// ============================================================================

const FolderIcon: React.FC<{ open?: boolean }> = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    {open ? (
      <path
        d="M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H5.5L7 4H11.5C12.05 4 12.5 4.45 12.5 5V10.5C12.5 11.05 12.05 11.5 11.5 11.5H2.5C1.95 11.5 1.5 11.05 1.5 10.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : (
      <path
        d="M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H5.5L7 4H11.5C12.05 4 12.5 4.45 12.5 5V10.5C12.5 11.05 12.05 11.5 11.5 11.5H2.5C1.95 11.5 1.5 11.05 1.5 10.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    )}
  </svg>
);

const ChevronIcon: React.FC<{ collapsed?: boolean }> = ({ collapsed }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    style={{
      transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
      transition: "transform 0.15s ease",
    }}
  >
    <path
      d="M3 4L5 6L7 4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ============================================================================
// 레이어 탭 콘텐츠 Props
// ============================================================================

interface LayerTabContentProps {
  onSwitchToProperty?: () => void;
  onSelectionFromPanel?: () => void;
}

// ============================================================================
// 키 아이콘 컴포넌트 (키캡 + 문자)
// ============================================================================

const KeyIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect
      x="2"
      y="2"
      width="10"
      height="10"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <circle cx="7" cy="7" r="2" fill="currentColor" />
  </svg>
);

// ============================================================================
// 플러그인 아이콘 컴포넌트 (퍼즐 조각)
// ============================================================================

const PluginIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect
      x="7"
      y="0.05"
      width="9.8"
      height="9.8"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.2"
      transform="rotate(45 7 0.05)"
    />
    <circle cx="7" cy="7" r="2" fill="currentColor" />
  </svg>
);

// ============================================================================
// 통계 아이콘 컴포넌트 (σ)
// ============================================================================

const StatIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M10.8 2H3.7c-.4 0-.7.3-.7.7 0 .2.1.4.2.5l3 3.8-3 3.8c-.1.1-.2.3-.2.5 0 .4.3.7.7.7h7.1"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const GraphIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M2 10.5L5.2 7.3L7.4 8.8L12 4.2"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 4.2H9.8"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

// ============================================================================
// 레이어 탭 콘텐츠 컴포넌트
// ============================================================================

const LayerTabContent: React.FC<LayerTabContentProps> = ({
  onSwitchToProperty,
  onSelectionFromPanel,
}) => {
  const { t } = useTranslation();
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const positions = useKeyStore((state) => state.positions);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const statPositions = useStatItemStore((state) => state.positions);
  const graphPositions = useGraphItemStore((state) => state.positions);
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );

  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const clearSelection = useGridSelectionStore((state) => state.clearSelection);
  const toggleSelection = useGridSelectionStore(
    (state) => state.toggleSelection,
  );

  // 드래그 상태
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverDisplayIndex, setDragOverDisplayIndex] = useState<number | null>(
    null,
  );
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);

  // Shift 선택을 위한 마지막 클릭 인덱스
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // 더블클릭과 클릭(특히 '이미 선택된 아이템 클릭 시 선택 해제') 충돌 방지용 타이머
  const pendingDeselectTimerRef = useRef<number | null>(null);
  const clearPendingDeselect = useCallback(() => {
    if (pendingDeselectTimerRef.current !== null) {
      window.clearTimeout(pendingDeselectTimerRef.current);
      pendingDeselectTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    return () => clearPendingDeselect();
  }, [clearPendingDeselect]);

  // 컨텍스트 메뉴 상태
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [contextMenuItem, setContextMenuItem] = useState<LayerItem | null>(
    null,
  );

  // 드래그 상태를 ref로도 저장 (이벤트 핸들러에서 최신 값 참조용)
  const dragStateRef = useRef<{
    startIndex: number;
    itemHeight: number;
    currentOverIndex: number | null;
  } | null>(null);

  // 그룹 드래그 상태 ref
  const groupDragStateRef = useRef<{
    groupId: string;
    itemHeight: number;
    currentOverIndex: number | null;
  } | null>(null);

  // 스크롤 상태
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  // Lenis 스크롤 적용
  const calculateThumb = useCallback((el: HTMLDivElement) => {
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

  const updateThumbDOM = useCallback(() => {
    if (!thumbRef.current || !scrollElementRef.current) return;
    const thumb = calculateThumb(scrollElementRef.current);
    thumbRef.current.style.top = `${thumb.top}px`;
    thumbRef.current.style.height = `${thumb.height}px`;
    thumbRef.current.style.display = thumb.visible ? "block" : "none";
  }, [calculateThumb]);

  const { scrollContainerRef: lenisRef } = useLenis({
    onScroll: updateThumbDOM,
  });

  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElementRef.current = node;
      lenisRef(node);
    },
    [lenisRef],
  );

  // 초기 thumb 업데이트
  useEffect(() => {
    updateThumbDOM();
  }, [updateThumbDOM]);

  // 레이어 아이템 목록 생성 (z-index 순서로 정렬)
  const layerItems = useMemo(() => {
    const items: LayerItem[] = [];

    // 키 아이템 추가
    const currentPositions = positions[selectedKeyType] || [];
    const currentKeyMappings = keyMappings[selectedKeyType] || [];

    currentPositions.forEach((pos, index) => {
      const keyCode = currentKeyMappings[index] || "";
      const keyInfo = keyCode ? getKeyInfoByGlobalKey(keyCode) : null;
      const defaultName = keyInfo?.displayName || keyCode || `Key ${index + 1}`;
      items.push({
        type: "key",
        id: `key-${index}`,
        index,
        name: pos.layerName || defaultName,
        zIndex: pos.zIndex ?? index,
        hidden: !!pos.hidden,
        groupId: pos.groupId,
      });
    });

    // 통계 아이템 추가
    const currentStatPositions = statPositions[selectedKeyType] || [];
    currentStatPositions.forEach((pos, index) => {
      const defaultName =
        pos.statType === "kpsAvg"
          ? "AVG"
          : pos.statType === "kpsMax"
          ? "MAX"
          : pos.statType === "total"
          ? "Total"
          : "KPS";
      items.push({
        type: "stat",
        id: `stat-${index}`,
        index,
        name: (pos as any).layerName || defaultName,
        zIndex: pos.zIndex ?? index,
        hidden: !!pos.hidden,
        groupId: (pos as any).groupId,
      });
    });

    // 그래프 아이템 추가
    const currentGraphPositions = graphPositions[selectedKeyType] || [];
    currentGraphPositions.forEach((pos, index) => {
      const defaultName =
        pos.statType === "kpsAvg"
          ? "AVG Graph"
          : pos.statType === "kpsMax"
            ? "MAX Graph"
            : pos.statType === "total"
              ? "Total Graph"
              : "KPS Graph";
      items.push({
        type: "graph",
        id: `graph-${index}`,
        index,
        name: (pos as any).layerName || defaultName,
        zIndex: pos.zIndex ?? index,
        hidden: !!pos.hidden,
        groupId: (pos as any).groupId,
      });
    });

    // 플러그인 아이템 추가
    pluginElements.forEach((el) => {
      items.push({
        type: "plugin",
        id: el.fullId,
        name: el.definitionId || "Plugin",
        zIndex: el.zIndex ?? 0,
        hidden: !!el.hidden,
        groupId: (el as any).groupId,
      });
    });

    // z-index 내림차순 정렬 (높은 것이 위에)
    items.sort((a, b) => b.zIndex - a.zIndex);

    return items;
  }, [
    positions,
    statPositions,
    graphPositions,
    selectedKeyType,
    keyMappings,
    pluginElements,
  ]);

  // 레이어 그룹 스토어 (안정적인 참조 유지: 셀렉터에서 새 객체를 생성하지 않음)
  const allLayerGroups = useLayerGroupStore((state) => state.layerGroups);
  const layerGroupsForMode = useMemo(
    () => allLayerGroups[selectedKeyType] || [],
    [allLayerGroups, selectedKeyType],
  );
  const collapsedGroups = useLayerGroupStore((state) => state.collapsedGroups);
  const toggleCollapsed = useLayerGroupStore((state) => state.toggleCollapsed);

  // 디스플레이 아이템: 그룹 헤더가 삽입된 목록
  const displayItems = useMemo((): DisplayItem[] => {
    const result: DisplayItem[] = [];
    const seenGroups = new Set<string>();
    // 그룹별 자식 아이템 사전 수집
    const groupChildren = new Map<string, LayerItem[]>();
    layerItems.forEach((item) => {
      if (item.groupId) {
        const children = groupChildren.get(item.groupId) || [];
        children.push(item);
        groupChildren.set(item.groupId, children);
      }
    });

    let flatIdx = 0;
    layerItems.forEach((item) => {
      if (item.groupId) {
        if (!seenGroups.has(item.groupId)) {
          seenGroups.add(item.groupId);
          // 그룹 정의 찾기
          const groupDef = layerGroupsForMode.find(
            (g) => g.id === item.groupId,
          );
          const children = groupChildren.get(item.groupId) || [];
          const isCollapsed = collapsedGroups.has(item.groupId);
          const allHidden = children.every((c) => c.hidden);

          result.push({
            displayType: "group-header",
            groupId: item.groupId,
            groupName: groupDef?.name || t("layerGroup.defaultName"),
            isCollapsed,
            childCount: children.length,
            allHidden,
          });

          if (!isCollapsed) {
            // 펼쳐진 상태: 자식 아이템 추가
            children.forEach((child) => {
              const childFlatIdx = layerItems.indexOf(child);
              result.push({
                displayType: "layer",
                item: child,
                groupDepth: 1,
                flatIndex: childFlatIdx,
              });
            });
          }
        }
        // 이미 처리된 그룹 아이템은 건너뜀
      } else {
        // 그룹에 속하지 않는 아이템
        result.push({
          displayType: "layer",
          item,
          groupDepth: 0,
          flatIndex: flatIdx,
        });
      }
      flatIdx++;
    });

    return result;
  }, [layerItems, layerGroupsForMode, collapsedGroups, t]);

  // layerItems를 ref로도 저장 (이벤트 핸들러에서 최신 값 참조용)
  const layerItemsRef = useRef(layerItems);
  layerItemsRef.current = layerItems;

  const displayItemsRef = useRef(displayItems);
  displayItemsRef.current = displayItems;

  // 선택된 요소들 설정
  const setSelectedElements = useGridSelectionStore(
    (state) => state.setSelectedElements,
  );

  // 더블클릭 핸들러 - 속성 패널로 전환 (클릭과 충돌 방지)
  const handleItemDoubleClick = useCallback(
    (item: LayerItem, index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (didDragRef.current || isDraggingRef.current) return;

      // 더블클릭이면, 클릭에서 예약된 선택 해제(또는 클릭 처리)를 취소
      clearPendingDeselect();

      // 레이어 패널에서 선택했음을 알림
      onSelectionFromPanel?.();

      // 더블클릭 시에는 해당 아이템을 확실히 선택한 뒤 속성 패널로 전환
      clearSelection();
      if (item.type === "key" && item.index !== undefined) {
        toggleSelection({ type: "key", id: item.id, index: item.index });
      } else if (item.type === "stat" && item.index !== undefined) {
        toggleSelection({ type: "stat", id: item.id, index: item.index });
      } else if (item.type === "graph" && item.index !== undefined) {
        toggleSelection({ type: "graph", id: item.id, index: item.index });
      } else if (item.type === "plugin") {
        toggleSelection({ type: "plugin", id: item.id });
      }

      onSwitchToProperty?.();
      setLastClickedIndex(index);
    },
    [
      clearPendingDeselect,
      clearSelection,
      onSelectionFromPanel,
      onSwitchToProperty,
      toggleSelection,
    ],
  );

  // 아이템 클릭 핸들러 (드래그 중이 아닐 때만 선택)
  const handleItemClick = useCallback(
    (item: LayerItem, index: number, e: React.MouseEvent) => {
      // 이전 클릭에서 예약된 선택 해제(더블클릭/빠른 연속 클릭 충돌 방지)
      clearPendingDeselect();

      // 드래그 직후 클릭 무시
      if (didDragRef.current) {
        didDragRef.current = false;
        return;
      }
      if (isDraggingRef.current) return;

      // 레이어 패널에서 선택했음을 알림 (모드 전환 방지)
      onSelectionFromPanel?.();

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isPrimaryModifierPressed = isMac ? e.metaKey : e.ctrlKey;
      const isShiftPressed = e.shiftKey;

      // Shift+클릭: 범위 선택
      if (isShiftPressed && lastClickedIndex !== null) {
        const startIdx = Math.min(lastClickedIndex, index);
        const endIdx = Math.max(lastClickedIndex, index);
        const currentItems = layerItemsRef.current;

        // 범위 내의 모든 아이템 선택
        const rangeElements: typeof selectedElements = [];
        for (let i = startIdx; i <= endIdx; i++) {
          const rangeItem = currentItems[i];
          if (rangeItem.type === "key" && rangeItem.index !== undefined) {
            rangeElements.push({
              type: "key",
              id: rangeItem.id,
              index: rangeItem.index,
            });
          } else if (rangeItem.type === "stat" && rangeItem.index !== undefined) {
            rangeElements.push({
              type: "stat",
              id: rangeItem.id,
              index: rangeItem.index,
            });
          } else if (rangeItem.type === "graph" && rangeItem.index !== undefined) {
            rangeElements.push({
              type: "graph",
              id: rangeItem.id,
              index: rangeItem.index,
            });
          } else if (rangeItem.type === "plugin") {
            rangeElements.push({ type: "plugin", id: rangeItem.id });
          }
        }

        if (isPrimaryModifierPressed) {
          // Ctrl+Shift+클릭: 기존 선택에 범위 추가
          const existingIds = new Set(selectedElements.map((el) => el.id));
          const newElements = rangeElements.filter(
            (el) => !existingIds.has(el.id),
          );
          setSelectedElements([...selectedElements, ...newElements]);
        } else {
          // Shift+클릭: 범위만 선택
          setSelectedElements(rangeElements);
        }
        // Shift 선택 시에는 lastClickedIndex를 유지
        return;
      }

      // Ctrl+클릭 또는 일반 클릭
      const isAlreadySelected = selectedElements.some(
        (el) => el.id === item.id,
      );

      if (item.type === "key" && item.index !== undefined) {
        if (isPrimaryModifierPressed) {
          // Ctrl+클릭: 다중 선택/해제 토글
          toggleSelection({ type: "key", id: item.id, index: item.index });
        } else {
          // 일반 클릭: 이미 선택된 경우 해제, 아니면 단일 선택
          if (isAlreadySelected) {
            // 더블클릭과 충돌 방지: 선택 해제는 잠깐 지연하고, 더블클릭이면 취소됨
            pendingDeselectTimerRef.current = window.setTimeout(() => {
              clearSelection();
              pendingDeselectTimerRef.current = null;
            }, 50);
          } else {
            clearSelection();
            toggleSelection({ type: "key", id: item.id, index: item.index });
          }
        }
      } else if (item.type === "stat" && item.index !== undefined) {
        if (isPrimaryModifierPressed) {
          toggleSelection({ type: "stat", id: item.id, index: item.index });
        } else {
          if (isAlreadySelected) {
            pendingDeselectTimerRef.current = window.setTimeout(() => {
              clearSelection();
              pendingDeselectTimerRef.current = null;
            }, 50);
          } else {
            clearSelection();
            toggleSelection({ type: "stat", id: item.id, index: item.index });
          }
        }
      } else if (item.type === "graph" && item.index !== undefined) {
        if (isPrimaryModifierPressed) {
          toggleSelection({ type: "graph", id: item.id, index: item.index });
        } else {
          if (isAlreadySelected) {
            pendingDeselectTimerRef.current = window.setTimeout(() => {
              clearSelection();
              pendingDeselectTimerRef.current = null;
            }, 50);
          } else {
            clearSelection();
            toggleSelection({ type: "graph", id: item.id, index: item.index });
          }
        }
      } else if (item.type === "plugin") {
        if (isPrimaryModifierPressed) {
          toggleSelection({ type: "plugin", id: item.id });
        } else {
          if (isAlreadySelected) {
            pendingDeselectTimerRef.current = window.setTimeout(() => {
              clearSelection();
              pendingDeselectTimerRef.current = null;
            }, 50);
          } else {
            clearSelection();
            toggleSelection({ type: "plugin", id: item.id });
          }
        }
      }

      // 마지막 클릭 인덱스 업데이트 (Shift 선택의 기준점)
      setLastClickedIndex(index);
    },
    [
      clearPendingDeselect,
      clearSelection,
      lastClickedIndex,
      onSelectionFromPanel,
      selectedElements,
      setSelectedElements,
      toggleSelection,
    ],
  );

  const handleToggleVisibility = useCallback(
    async (e: React.MouseEvent, item: LayerItem) => {
      e.preventDefault();
      e.stopPropagation();

      clearPendingDeselect();
      onSelectionFromPanel?.();

      const { keyMappings: km, positions: pos } = useKeyStore.getState();
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      useHistoryStore
        .getState()
        .pushState(
          km,
          pos,
          currentStatPositions as any,
          currentGraphPositions as any,
          currentPluginElements
        );

      if (item.type === "key" && item.index !== undefined) {
        const currentPositions = pos[selectedKeyType] || [];
        const current = currentPositions[item.index];
        if (!current) return;

        const updatedPositions = { ...pos };
        const updatedModePositions = [...currentPositions];
        updatedModePositions[item.index] = {
          ...current,
          hidden: !current.hidden,
        };
        updatedPositions[selectedKeyType] = updatedModePositions;

        useKeyStore.getState().setLocalUpdateInProgress(true);
        useKeyStore.getState().setPositions(updatedPositions);
        try {
          await window.api.keys.updatePositions(updatedPositions);
        } catch (error) {
          console.error("Failed to toggle key visibility", error);
        } finally {
          useKeyStore.getState().setLocalUpdateInProgress(false);
        }

        return;
      }

      if (item.type === "stat" && item.index !== undefined) {
        const current = useStatItemStore.getState().positions;
        const currentPositions = current[selectedKeyType] || [];
        const target = currentPositions[item.index];
        if (!target) return;

        const updatedPositions = { ...current };
        const updatedModePositions = [...currentPositions];
        updatedModePositions[item.index] = {
          ...target,
          hidden: !target.hidden,
        };
        updatedPositions[selectedKeyType] = updatedModePositions;

        useStatItemStore.getState().setLocalUpdateInProgress(true);
        useStatItemStore.getState().setPositions(updatedPositions);
        try {
          await window.api.statItems.updatePositions(updatedPositions);
        } catch (error) {
          console.error("Failed to toggle stat item visibility", error);
        } finally {
          useStatItemStore.getState().setLocalUpdateInProgress(false);
        }

        try {
          window.api.bridge.sendTo("overlay", "statPositions:sync", {
            positions: updatedPositions,
          });
        } catch {
          // ignore
        }

        return;
      }

      if (item.type === "graph" && item.index !== undefined) {
        const current = useGraphItemStore.getState().positions;
        const currentPositions = current[selectedKeyType] || [];
        const target = currentPositions[item.index];
        if (!target) return;

        const updatedPositions = { ...current };
        const updatedModePositions = [...currentPositions];
        updatedModePositions[item.index] = {
          ...target,
          hidden: !target.hidden,
        };
        updatedPositions[selectedKeyType] = updatedModePositions;

        useGraphItemStore.getState().setLocalUpdateInProgress(true);
        useGraphItemStore.getState().setPositions(updatedPositions);
        try {
          await window.api.graphItems.updatePositions(updatedPositions);
        } catch (error) {
          console.error("Failed to toggle graph item visibility", error);
        } finally {
          useGraphItemStore.getState().setLocalUpdateInProgress(false);
        }

        try {
          window.api.bridge.sendTo("overlay", "graphPositions:sync", {
            positions: updatedPositions,
          });
        } catch {
          // ignore
        }

        return;
      }

      if (item.type === "plugin") {
        const el = currentPluginElements.find((p) => p.fullId === item.id);
        if (!el) return;
        usePluginDisplayElementStore
          .getState()
          .updateElement(item.id, { hidden: !el.hidden });
      }
    },
    [clearPendingDeselect, onSelectionFromPanel, selectedKeyType],
  );

  // 아이템이 선택되었는지 확인
  const selectedElementIdSet = useMemo(
    () => new Set(selectedElements.map((el) => el.id)),
    [selectedElements],
  );

  const isItemSelected = useCallback(
    (item: LayerItem) => {
      return selectedElementIdSet.has(item.id);
    },
    [selectedElementIdSet],
  );

  const isGroupHeaderSelected = useCallback(
    (groupId: string) => {
      return layerItems.some(
        (item) => item.groupId === groupId && selectedElementIdSet.has(item.id),
      );
    },
    [layerItems, selectedElementIdSet],
  );

  // 인라인 이름 변경 상태 (레이어 + 그룹 공용)
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);

  // 그룹 컨텍스트 메뉴 상태 (그룹 헤더 우클릭 시)
  const [contextMenuGroupId, setContextMenuGroupId] = useState<string | null>(
    null,
  );

  // 컨텍스트 메뉴 아이템 (동적 생성)
  const contextMenuItems = useMemo<ListItem[]>(() => {
    // 그룹 헤더 우클릭
    if (contextMenuGroupId) {
      return [
        {
          id: "renameGroup",
          label: t("contextMenu.renameGroup") || "Rename",
        },
        { id: "ungroup", label: t("contextMenu.ungroup") || "Ungroup" },
      ];
    }

    // 레이어 아이템 우클릭
    const items: ListItem[] = [{ id: "rename", label: t("contextMenu.rename") || "Rename" }];

    // 여러 아이템이 선택되어 있고, 우클릭 항목이 그룹 미소속일 때만 그룹화 노출
    if (selectedElements.length >= 2 && !contextMenuItem?.groupId) {
      items.push({
        id: "groupSelected",
        label: t("contextMenu.groupSelected") || "Group",
      });
    }

    // 우클릭한 아이템이 그룹에 속해 있으면 그룹 해제 옵션 추가
    if (contextMenuItem?.groupId) {
      items.push({
        id: "removeFromGroup",
        label: t("contextMenu.removeFromGroup") || "Remove from Group",
      });
    }

    items.push({ id: "delete", label: t("propertiesPanel.delete") || "Delete" });

    return items;
  }, [t, selectedElements.length, contextMenuItem, contextMenuGroupId]);

  // 우클릭 핸들러
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, item: LayerItem, index: number) => {
      e.preventDefault();
      e.stopPropagation();

      clearPendingDeselect();

      // 레이어 패널에서 선택했음을 알림 (모드 전환 방지)
      onSelectionFromPanel?.();

      // 우클릭한 아이템이 선택되어 있지 않으면 해당 아이템만 선택
      if (!isItemSelected(item)) {
        clearSelection();
        if (item.type === "key" && item.index !== undefined) {
          toggleSelection({ type: "key", id: item.id, index: item.index });
        } else if (item.type === "stat" && item.index !== undefined) {
          toggleSelection({ type: "stat", id: item.id, index: item.index });
        } else if (item.type === "graph" && item.index !== undefined) {
          toggleSelection({ type: "graph", id: item.id, index: item.index });
        } else if (item.type === "plugin") {
          toggleSelection({ type: "plugin", id: item.id });
        }
        setLastClickedIndex(index);
      }

      setContextMenuItem(item);
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
      setContextMenuOpen(true);
    },
    [
      clearPendingDeselect,
      clearSelection,
      isItemSelected,
      onSelectionFromPanel,
      toggleSelection,
    ],
  );

  // 레이어 이름 변경 커밋
  const handleLayerRenameCommit = useCallback(
    async (item: LayerItem, value: string) => {
      setRenamingItemId(null);
      const trimmed = value.trim();
      // 빈 문자열이면 layerName 제거 (기본 이름으로 복원)
      const newLayerName = trimmed === "" ? undefined : trimmed;

      if (item.type === "key" && item.index !== undefined) {
        const { keyMappings: km, positions: pos } = useKeyStore.getState();
        const currentPositions = pos[selectedKeyType] || [];
        const current = currentPositions[item.index];
        if (!current) return;

        const updatedPositions = { ...pos };
        const updatedModePositions = [...currentPositions];
        updatedModePositions[item.index] = { ...current, layerName: newLayerName };
        updatedPositions[selectedKeyType] = updatedModePositions;

        useKeyStore.getState().setLocalUpdateInProgress(true);
        useKeyStore.getState().setPositions(updatedPositions);
        try {
          await window.api.keys.updatePositions(updatedPositions);
        } finally {
          useKeyStore.getState().setLocalUpdateInProgress(false);
        }
      } else if (item.type === "stat" && item.index !== undefined) {
        const current = useStatItemStore.getState().positions;
        const currentPositions = current[selectedKeyType] || [];
        const target = currentPositions[item.index];
        if (!target) return;

        const updatedPositions = { ...current };
        const updatedModePositions = [...currentPositions];
        updatedModePositions[item.index] = { ...target, layerName: newLayerName };
        updatedPositions[selectedKeyType] = updatedModePositions;

        useStatItemStore.getState().setLocalUpdateInProgress(true);
        useStatItemStore.getState().setPositions(updatedPositions);
        try {
          await window.api.statItems.updatePositions(updatedPositions);
        } finally {
          useStatItemStore.getState().setLocalUpdateInProgress(false);
        }
      } else if (item.type === "graph" && item.index !== undefined) {
        const current = useGraphItemStore.getState().positions;
        const currentPositions = current[selectedKeyType] || [];
        const target = currentPositions[item.index];
        if (!target) return;

        const updatedPositions = { ...current };
        const updatedModePositions = [...currentPositions];
        updatedModePositions[item.index] = { ...target, layerName: newLayerName };
        updatedPositions[selectedKeyType] = updatedModePositions;

        useGraphItemStore.getState().setLocalUpdateInProgress(true);
        useGraphItemStore.getState().setPositions(updatedPositions);
        try {
          await window.api.graphItems.updatePositions(updatedPositions);
        } finally {
          useGraphItemStore.getState().setLocalUpdateInProgress(false);
        }
      }
    },
    [selectedKeyType],
  );

  // 선택된 레이어들에 groupId 설정하는 유틸리티
  const setGroupIdOnSelected = useCallback(
    async (
      targetGroupId: string | undefined,
      elementsOverride?: typeof selectedElements,
      options?: {
        skipHistory?: boolean;
        historyLayerGroups?: LayerGroups;
        layerGroupsForNormalization?: LayerGroups;
      },
    ) => {
      const selectedForUpdate = elementsOverride ?? selectedElements;
      if (selectedForUpdate.length === 0) return false;

      const { keyMappings: km, positions: pos } = useKeyStore.getState();
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const currentPluginElements = usePluginDisplayElementStore.getState().elements;
      const storeLayerGroups = useLayerGroupStore.getState().layerGroups;
      const historyLayerGroups = options?.historyLayerGroups ?? storeLayerGroups;
      const layerGroupsForNormalization =
        options?.layerGroupsForNormalization ?? storeLayerGroups;

      const grouped = applyGroupIdToSelectedElements({
        mode: selectedKeyType,
        selectedElements: selectedForUpdate,
        keyPositions: pos,
        statPositions: currentStatPositions,
        graphPositions: currentGraphPositions,
        targetGroupId,
      });

      const normalized = normalizeLayerGroupsForMode({
        mode: selectedKeyType,
        keyPositions: grouped.keyPositions,
        statPositions: grouped.statPositions,
        graphPositions: grouped.graphPositions,
        layerGroups: layerGroupsForNormalization,
      });

      const shouldPersistGroups =
        normalized.groupsChanged ||
        options?.layerGroupsForNormalization !== undefined;
      const hasChange =
        grouped.changed || normalized.positionsChanged || shouldPersistGroups;
      if (!hasChange) return false;

      if (!options?.skipHistory) {
        useHistoryStore
          .getState()
          .pushState(
            km,
            pos,
            currentStatPositions as any,
            currentGraphPositions as any,
            currentPluginElements,
            historyLayerGroups,
          );
      }

      useKeyStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setLocalUpdateInProgress(true);
      useGraphItemStore.getState().setLocalUpdateInProgress(true);

      useKeyStore.getState().setPositions(normalized.keyPositions);
      useStatItemStore.getState().setPositions(normalized.statPositions);
      useGraphItemStore.getState().setPositions(normalized.graphPositions);

      if (shouldPersistGroups) {
        useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
      }

      try {
        await window.api.keys.updatePositions(normalized.keyPositions);
        await window.api.statItems.updatePositions(normalized.statPositions);
        await window.api.graphItems.updatePositions(normalized.graphPositions);
        if (shouldPersistGroups) {
          await window.api.layerGroups.update(normalized.layerGroups);
        }
      } finally {
        useKeyStore.getState().setLocalUpdateInProgress(false);
        useStatItemStore.getState().setLocalUpdateInProgress(false);
        useGraphItemStore.getState().setLocalUpdateInProgress(false);
      }

      return true;
    },
    [selectedElements, selectedKeyType],
  );

  // 그룹 이름 변경 커밋
  const handleGroupRenameCommit = useCallback(
    async (groupId: string, value: string) => {
      setRenamingItemId(null);
      const trimmed = value.trim();
      if (trimmed === "") return;

      const { keyMappings: km, positions: pos } = useKeyStore.getState();
      const statPos = useStatItemStore.getState().positions;
      const graphPos = useGraphItemStore.getState().positions;
      const pluginEls = usePluginDisplayElementStore.getState().elements;
      const currentGroups = useLayerGroupStore.getState().layerGroups;
      const currentModeGroups = currentGroups[selectedKeyType] || [];
      const currentGroup = currentModeGroups.find((group) => group.id === groupId);
      if (!currentGroup || currentGroup.name === trimmed) return;

      useHistoryStore
        .getState()
        .pushState(km, pos, statPos as any, graphPos as any, pluginEls, currentGroups);

      const updated: LayerGroups = {
        ...currentGroups,
        [selectedKeyType]: currentModeGroups.map((group) =>
          group.id === groupId ? { ...group, name: trimmed } : group,
        ),
      };

      useLayerGroupStore.getState().setLayerGroups(updated);
      try {
        await window.api.layerGroups.update(updated);
      } catch (error) {
        console.error("Failed to rename group", error);
      }
    },
    [selectedKeyType],
  );

  // 그룹 전체 표시/숨김 토글
  const handleToggleGroupVisibility = useCallback(
    async (e: React.MouseEvent, groupId: string) => {
      e.preventDefault();
      e.stopPropagation();

      // 그룹 소속 아이템 목록
      const children = layerItems.filter((item) => item.groupId === groupId);
      if (children.length === 0) return;

      const allHidden = children.every((c) => c.hidden);
      const newHidden = !allHidden;

      // 히스토리 저장
      const { keyMappings: km, positions: pos } = useKeyStore.getState();
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      useHistoryStore
        .getState()
        .pushState(
          km,
          pos,
          currentStatPositions as any,
          currentGraphPositions as any,
          currentPluginElements,
        );

      // 키 positions 업데이트
      const keyChildren = children.filter(
        (c) => c.type === "key" && c.index !== undefined,
      );
      if (keyChildren.length > 0) {
        const updatedPositions = { ...pos };
        const modePositions = [...(pos[selectedKeyType] || [])];
        keyChildren.forEach((c) => {
          if (c.index !== undefined && modePositions[c.index]) {
            modePositions[c.index] = {
              ...modePositions[c.index],
              hidden: newHidden,
            };
          }
        });
        updatedPositions[selectedKeyType] = modePositions;
        useKeyStore.getState().setLocalUpdateInProgress(true);
        useKeyStore.getState().setPositions(updatedPositions);
        try {
          await window.api.keys.updatePositions(updatedPositions);
        } finally {
          useKeyStore.getState().setLocalUpdateInProgress(false);
        }
      }

      // 통계 positions 업데이트
      const statChildren = children.filter(
        (c) => c.type === "stat" && c.index !== undefined,
      );
      if (statChildren.length > 0) {
        const current = useStatItemStore.getState().positions;
        const modePositions = [...(current[selectedKeyType] || [])];
        statChildren.forEach((c) => {
          if (c.index !== undefined && modePositions[c.index]) {
            modePositions[c.index] = {
              ...modePositions[c.index],
              hidden: newHidden,
            };
          }
        });
        const updatedPositions = {
          ...current,
          [selectedKeyType]: modePositions,
        };
        useStatItemStore.getState().setLocalUpdateInProgress(true);
        useStatItemStore.getState().setPositions(updatedPositions);
        try {
          await window.api.statItems.updatePositions(updatedPositions);
        } finally {
          useStatItemStore.getState().setLocalUpdateInProgress(false);
        }
      }

      // 그래프 positions 업데이트
      const graphChildren = children.filter(
        (c) => c.type === "graph" && c.index !== undefined,
      );
      if (graphChildren.length > 0) {
        const current = useGraphItemStore.getState().positions;
        const modePositions = [...(current[selectedKeyType] || [])];
        graphChildren.forEach((c) => {
          if (c.index !== undefined && modePositions[c.index]) {
            modePositions[c.index] = {
              ...modePositions[c.index],
              hidden: newHidden,
            };
          }
        });
        const updatedPositions = {
          ...current,
          [selectedKeyType]: modePositions,
        };
        useGraphItemStore.getState().setLocalUpdateInProgress(true);
        useGraphItemStore.getState().setPositions(updatedPositions);
        try {
          await window.api.graphItems.updatePositions(updatedPositions);
        } finally {
          useGraphItemStore.getState().setLocalUpdateInProgress(false);
        }
      }

      // 플러그인
      const pluginChildren = children.filter((c) => c.type === "plugin");
      pluginChildren.forEach((c) => {
        usePluginDisplayElementStore
          .getState()
          .updateElement(c.id, { hidden: newHidden });
      });
    },
    [layerItems, selectedKeyType],
  );

  // 컨텍스트 메뉴 선택 핸들러
  const handleContextMenuSelect = useCallback(
    async (itemId: string) => {
      // 그룹 헤더 컨텍스트 메뉴 처리
      if (contextMenuGroupId) {
        if (itemId === "renameGroup") {
          const groupDef = layerGroupsForMode.find(
            (g) => g.id === contextMenuGroupId,
          );
          setRenamingItemId(`group:${contextMenuGroupId}`);
          setRenameValue(groupDef?.name || "");
          setContextMenuOpen(false);
          setContextMenuGroupId(null);
          requestAnimationFrame(() => {
            renameInputRef.current?.focus();
            renameInputRef.current?.select();
          });
          return;
        }
        if (itemId === "ungroup") {
          const children = layerItems.filter(
            (item) => item.groupId === contextMenuGroupId,
          );
          const elements = children.map((child) => ({
            type: child.type as any,
            id: child.id,
            index: child.index,
          }));
          await setGroupIdOnSelected(undefined, elements);

          onSelectionFromPanel?.();
          clearSelection();
          setContextMenuOpen(false);
          setContextMenuGroupId(null);
          return;
        }
        setContextMenuOpen(false);
        setContextMenuGroupId(null);
        return;
      }

      if (itemId === "rename") {
        // 우클릭한 아이템에 대해 인라인 이름 변경 시작
        if (contextMenuItem) {
          setRenamingItemId(contextMenuItem.id);
          setRenameValue(contextMenuItem.name);
          setContextMenuOpen(false);
          requestAnimationFrame(() => {
            renameInputRef.current?.focus();
            renameInputRef.current?.select();
          });
        }
        return;
      }

      // 선택 항목 그룹화
      if (itemId === "groupSelected") {
        if (selectedElements.length < 2) return;

        const currentGroups = useLayerGroupStore.getState().layerGroups;
        const modeGroups = currentGroups[selectedKeyType] || [];
        const keyPos = useKeyStore.getState().positions;
        const statPos = useStatItemStore.getState().positions;
        const graphPos = useGraphItemStore.getState().positions;

        const singleGroupId = resolveSingleGroupIdFromSelection(
          selectedKeyType,
          selectedElements,
          keyPos,
          statPos,
          graphPos,
        );

        if (singleGroupId) {
          await setGroupIdOnSelected(singleGroupId);
        } else {
          const groupId = crypto.randomUUID();
          const groupName = buildNextLayerGroupName(
            t("layerGroup.newGroup") || "New Group",
            modeGroups,
          );
          const nextGroups: LayerGroups = {
            ...currentGroups,
            [selectedKeyType]: [...modeGroups, { id: groupId, name: groupName }],
          };

          await setGroupIdOnSelected(groupId, undefined, {
            historyLayerGroups: currentGroups,
            layerGroupsForNormalization: nextGroups,
          });
        }

        setContextMenuOpen(false);
        return;
      }

      // 그룹에서 제거
      if (itemId === "removeFromGroup") {
        if (contextMenuItem) {
          // 단일 아이템만 그룹에서 제거
          const elements = [
            {
              type: contextMenuItem.type as any,
              id: contextMenuItem.id,
              index: contextMenuItem.index,
            },
          ];
          await setGroupIdOnSelected(undefined, elements);
          onSelectionFromPanel?.();
          clearSelection();
        }
        setContextMenuOpen(false);
        return;
      }

      if (itemId === "delete") {
        // 선택된 요소들 삭제
        if (selectedElements.length === 0) return;

        const keysToDelete = selectedElements
          .filter((el) => el.type === "key" && el.index !== undefined)
          .map((el) => el.index as number);

        const statsToDelete = selectedElements
          .filter((el) => el.type === "stat" && el.index !== undefined)
          .map((el) => el.index as number);

        const graphsToDelete = selectedElements
          .filter((el) => el.type === "graph" && el.index !== undefined)
          .map((el) => el.index as number);

        const pluginsToDelete = selectedElements
          .filter((el) => el.type === "plugin")
          .map((el) => el.id);

        // 히스토리 저장
        if (
          keysToDelete.length > 0 ||
          statsToDelete.length > 0 ||
          graphsToDelete.length > 0 ||
          pluginsToDelete.length > 0
        ) {
          const { keyMappings: km, positions: pos } = useKeyStore.getState();
          const currentStatPositions = useStatItemStore.getState().positions;
          const currentGraphPositions = useGraphItemStore.getState().positions;
          const currentPluginElements =
            usePluginDisplayElementStore.getState().elements;
          const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
          useHistoryStore
            .getState()
            .pushState(
              km,
              pos,
              currentStatPositions as any,
              currentGraphPositions as any,
              currentPluginElements,
              currentLayerGroups,
            );
        }

        // 선택 해제
        onSelectionFromPanel?.();
        clearSelection();

        // 키 배치 삭제
        if (keysToDelete.length > 0) {
          const { keyMappings: km, positions: pos } = useKeyStore.getState();
          const mapping = km[selectedKeyType] || [];
          const posArray = pos[selectedKeyType] || [];

          const deleteSet = new Set(keysToDelete);

          const updatedMappings = {
            ...km,
            [selectedKeyType]: mapping.filter(
              (_, index) => !deleteSet.has(index),
            ),
          };

          const updatedPositions = {
            ...pos,
            [selectedKeyType]: posArray.filter(
              (_, index) => !deleteSet.has(index),
            ),
          };

          useKeyStore.getState().setLocalUpdateInProgress(true);

          useKeyStore
            .getState()
            .setKeyMappingsAndPositions(updatedMappings, updatedPositions);

          try {
            await window.api.keys.update(updatedMappings);
            await window.api.keys.updatePositions(updatedPositions);
          } catch (error) {
            console.error("Failed to delete keys", error);
          } finally {
            useKeyStore.getState().setLocalUpdateInProgress(false);
          }
        }

        // 통계 요소 배치 삭제
        if (statsToDelete.length > 0) {
          const current = useStatItemStore.getState().positions;
          const posArray = current[selectedKeyType] || [];
          const deleteSet = new Set(statsToDelete);

          const updatedPositions = {
            ...current,
            [selectedKeyType]: posArray.filter((_, index) => !deleteSet.has(index)),
          };

          useStatItemStore.getState().setLocalUpdateInProgress(true);
          useStatItemStore.getState().setPositions(updatedPositions);
          try {
            await window.api.statItems.updatePositions(updatedPositions);
          } catch (error) {
            console.error("Failed to delete stat items", error);
          } finally {
            useStatItemStore.getState().setLocalUpdateInProgress(false);
          }

          try {
            window.api.bridge.sendTo("overlay", "statPositions:sync", {
              positions: updatedPositions,
            });
          } catch {
            // ignore
          }
        }

        // 그래프 요소 배치 삭제
        if (graphsToDelete.length > 0) {
          const current = useGraphItemStore.getState().positions;
          const posArray = current[selectedKeyType] || [];
          const deleteSet = new Set(graphsToDelete);

          const updatedPositions = {
            ...current,
            [selectedKeyType]: posArray.filter((_, index) => !deleteSet.has(index)),
          };

          useGraphItemStore.getState().setLocalUpdateInProgress(true);
          useGraphItemStore.getState().setPositions(updatedPositions);
          try {
            await window.api.graphItems.updatePositions(updatedPositions);
          } catch (error) {
            console.error("Failed to delete graph items", error);
          } finally {
            useGraphItemStore.getState().setLocalUpdateInProgress(false);
          }

          try {
            window.api.bridge.sendTo("overlay", "graphPositions:sync", {
              positions: updatedPositions,
            });
          } catch {
            // ignore
          }
        }

        // 플러그인 요소 배치 삭제
        if (pluginsToDelete.length > 0) {
          const currentElements =
            usePluginDisplayElementStore.getState().elements;
          const deleteSet = new Set(pluginsToDelete);
          const newElements = currentElements.filter(
            (el) => !deleteSet.has(el.fullId),
          );
          usePluginDisplayElementStore.getState().setElements(newElements);
        }

        const normalized = normalizeLayerGroupsForMode({
          mode: selectedKeyType,
          keyPositions: useKeyStore.getState().positions,
          statPositions: useStatItemStore.getState().positions,
          graphPositions: useGraphItemStore.getState().positions,
          layerGroups: useLayerGroupStore.getState().layerGroups,
        });

        if (normalized.positionsChanged || normalized.groupsChanged) {
          useKeyStore.getState().setLocalUpdateInProgress(true);
          useStatItemStore.getState().setLocalUpdateInProgress(true);
          useGraphItemStore.getState().setLocalUpdateInProgress(true);
          useKeyStore.getState().setPositions(normalized.keyPositions);
          useStatItemStore.getState().setPositions(normalized.statPositions);
          useGraphItemStore.getState().setPositions(normalized.graphPositions);
          if (normalized.groupsChanged) {
            useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
          }
          try {
            await window.api.keys.updatePositions(normalized.keyPositions);
            await window.api.statItems.updatePositions(normalized.statPositions);
            await window.api.graphItems.updatePositions(normalized.graphPositions);
            if (normalized.groupsChanged) {
              await window.api.layerGroups.update(normalized.layerGroups);
            }
          } finally {
            useKeyStore.getState().setLocalUpdateInProgress(false);
            useStatItemStore.getState().setLocalUpdateInProgress(false);
            useGraphItemStore.getState().setLocalUpdateInProgress(false);
          }
        }
      }

      setContextMenuOpen(false);
    },
    [
      selectedElements,
      selectedKeyType,
      clearSelection,
      contextMenuItem,
      contextMenuGroupId,
      layerGroupsForMode,
      layerItems,
      onSelectionFromPanel,
      setGroupIdOnSelected,
      t,
    ],
  );

  // 드롭 처리
  const performDrop = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;

      const items = [...layerItemsRef.current];

      if (fromIndex === -1 || fromIndex === toIndex) return;

      // 아이템 재정렬
      const [removed] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, removed);

      const previousItem = items[toIndex - 1];
      const nextItem = items[toIndex + 1];
      let droppedGroupId: string | undefined = removed.groupId;
      if (removed.type !== "plugin") {
        const prevGroupId = previousItem?.groupId;
        const nextGroupId = nextItem?.groupId;
        if (prevGroupId && nextGroupId) {
          droppedGroupId =
            prevGroupId === nextGroupId ? prevGroupId : undefined;
        } else if (prevGroupId) {
          droppedGroupId = prevGroupId;
        } else if (nextGroupId) {
          droppedGroupId = nextGroupId;
        } else {
          droppedGroupId = undefined;
        }
      }

      const currentPositions = useKeyStore.getState().positions;
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
      const { keyMappings: km } = useKeyStore.getState();
      useHistoryStore
        .getState()
        .pushState(
          km,
          currentPositions,
          currentStatPositions as any,
          currentGraphPositions as any,
          currentPluginElements,
          currentLayerGroups,
        );

      // 새 z-index 계산 및 적용
      const maxZIndex = items.length - 1;

      // 키 positions 복사 및 업데이트
      const updatedPositions = { ...currentPositions };
      const currentModePositions = [
        ...(updatedPositions[selectedKeyType] || []),
      ];

      // 통계 positions 복사 및 업데이트
      const updatedStatPositions = { ...currentStatPositions };
      const currentStatModePositions = [
        ...(updatedStatPositions[selectedKeyType] || []),
      ];
      // 그래프 positions 복사 및 업데이트
      const updatedGraphPositions = {
        ...currentGraphPositions,
      };
      const currentGraphModePositions = [
        ...(updatedGraphPositions[selectedKeyType] || []),
      ];

      items.forEach((item, idx) => {
        const newZIndex = maxZIndex - idx; // 맨 위가 가장 높은 z-index

        if (item.type === "key" && item.index !== undefined) {
          // 키 z-index 업데이트
          if (currentModePositions[item.index]) {
            const isDroppedItem = item.id === removed.id;
            currentModePositions[item.index] = {
              ...currentModePositions[item.index],
              zIndex: newZIndex,
              ...(isDroppedItem ? { groupId: droppedGroupId } : {}),
            };
          }
        } else if (item.type === "stat" && item.index !== undefined) {
          if (currentStatModePositions[item.index]) {
            const isDroppedItem = item.id === removed.id;
            currentStatModePositions[item.index] = {
              ...currentStatModePositions[item.index],
              zIndex: newZIndex,
              ...(isDroppedItem ? { groupId: droppedGroupId } : {}),
            };
          }
        } else if (item.type === "graph" && item.index !== undefined) {
          if (currentGraphModePositions[item.index]) {
            const isDroppedItem = item.id === removed.id;
            currentGraphModePositions[item.index] = {
              ...currentGraphModePositions[item.index],
              zIndex: newZIndex,
              ...(isDroppedItem ? { groupId: droppedGroupId } : {}),
            };
          }
        } else if (item.type === "plugin") {
          // 플러그인 z-index 업데이트
          usePluginDisplayElementStore.getState().updateElement(item.id, {
            zIndex: newZIndex,
          });
        }
      });

      // 키 positions 일괄 업데이트
      updatedPositions[selectedKeyType] = currentModePositions;

      // 통계 positions 일괄 업데이트
      updatedStatPositions[selectedKeyType] = currentStatModePositions;
      // 그래프 positions 일괄 업데이트
      updatedGraphPositions[selectedKeyType] = currentGraphModePositions;
      const normalized = normalizeLayerGroupsForMode({
        mode: selectedKeyType,
        keyPositions: updatedPositions,
        statPositions: updatedStatPositions,
        graphPositions: updatedGraphPositions,
        layerGroups: currentLayerGroups,
      });

      useGraphItemStore.getState().setPositions(normalized.graphPositions);
      useKeyStore.getState().setPositions(normalized.keyPositions);
      useStatItemStore.getState().setPositions(normalized.statPositions);
      if (normalized.groupsChanged) {
        useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
      }

      // 백엔드/오버레이 동기화 (레이어 정렬 결과 즉시 반영)
      useKeyStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setLocalUpdateInProgress(true);
      useGraphItemStore.getState().setLocalUpdateInProgress(true);
      try {
        await window.api.keys.updatePositions(normalized.keyPositions);
        await window.api.statItems.updatePositions(normalized.statPositions);
        await window.api.graphItems.updatePositions(normalized.graphPositions);
        if (normalized.groupsChanged) {
          await window.api.layerGroups.update(normalized.layerGroups);
        }
      } catch (error) {
        console.error("Failed to reorder layers", error);
      } finally {
        useKeyStore.getState().setLocalUpdateInProgress(false);
        useStatItemStore.getState().setLocalUpdateInProgress(false);
        useGraphItemStore.getState().setLocalUpdateInProgress(false);
      }

      try {
        window.api.bridge.sendTo("overlay", "positions:sync", {
          positions: normalized.keyPositions,
        });
      } catch {
        // ignore
      }

      try {
        window.api.bridge.sendTo("overlay", "statPositions:sync", {
          positions: normalized.statPositions,
        });
      } catch {
        // ignore
      }
      try {
        window.api.bridge.sendTo("overlay", "graphPositions:sync", {
          positions: normalized.graphPositions,
        });
      } catch {
        // ignore
      }

      try {
        const currentPluginElements =
          usePluginDisplayElementStore.getState().elements;
        window.api.bridge.sendTo("overlay", "plugin:displayElements:sync", {
          elements: currentPluginElements,
        });
      } catch {
        // ignore
      }
    },
    [selectedKeyType],
  );

  // 그룹 드롭 처리 (그룹 단위 이동)
  const performGroupDrop = useCallback(
    async (groupId: string, targetDisplayIndex: number) => {
      const items = [...layerItemsRef.current];
      const currentDisplay = displayItemsRef.current;

      // 그룹 자식 아이템 수집 (items 내 순서 유지)
      const groupChildren = items.filter((item) => item.groupId === groupId);
      const remainingItems = items.filter((item) => item.groupId !== groupId);

      if (groupChildren.length === 0) return;

      // targetDisplayIndex에서 드래그 중인 그룹 행을 제외하여 필터된 인덱스 계산
      let offset = 0;
      for (let i = 0; i < targetDisplayIndex && i < currentDisplay.length; i++) {
        const di = currentDisplay[i];
        if (di.displayType === "group-header" && di.groupId === groupId) offset++;
        else if (di.displayType === "layer" && di.item.groupId === groupId)
          offset++;
      }
      const filteredTargetIndex = targetDisplayIndex - offset;

      // 필터된 디스플레이 목록 (드래그 중인 그룹 제외)
      const filteredDisplay = currentDisplay.filter((di) => {
        if (di.displayType === "group-header" && di.groupId === groupId)
          return false;
        if (di.displayType === "layer" && di.item.groupId === groupId)
          return false;
        return true;
      });

      // remainingItems 내 삽입 위치 계산
      let insertionIndex = remainingItems.length;

      if (filteredTargetIndex < filteredDisplay.length) {
        const targetDI = filteredDisplay[filteredTargetIndex];
        if (targetDI.displayType === "layer") {
          const idx = remainingItems.findIndex(
            (i) => i.id === targetDI.item.id,
          );
          if (idx !== -1) insertionIndex = idx;
        } else if (targetDI.displayType === "group-header") {
          const firstChild = remainingItems.find(
            (i) => i.groupId === targetDI.groupId,
          );
          if (firstChild) {
            const idx = remainingItems.indexOf(firstChild);
            if (idx !== -1) insertionIndex = idx;
          }
        }
      }

      // 새 순서 구성
      const newItems = [
        ...remainingItems.slice(0, insertionIndex),
        ...groupChildren,
        ...remainingItems.slice(insertionIndex),
      ];

      // 순서 변경 여부 확인
      const orderChanged = newItems.some(
        (item, idx) => item.id !== items[idx]?.id,
      );
      if (!orderChanged) return;

      // 히스토리 저장
      const currentPositions = useKeyStore.getState().positions;
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
      const { keyMappings: km } = useKeyStore.getState();
      useHistoryStore
        .getState()
        .pushState(
          km,
          currentPositions,
          currentStatPositions as any,
          currentGraphPositions as any,
          currentPluginElements,
          currentLayerGroups,
        );

      // z-index 재계산
      const maxZIndex = newItems.length - 1;

      const updatedPositions = { ...useKeyStore.getState().positions };
      const currentModePositions = [
        ...(updatedPositions[selectedKeyType] || []),
      ];
      const updatedStatPositions = {
        ...useStatItemStore.getState().positions,
      };
      const currentStatModePositions = [
        ...(updatedStatPositions[selectedKeyType] || []),
      ];
      const updatedGraphPositions = {
        ...useGraphItemStore.getState().positions,
      };
      const currentGraphModePositions = [
        ...(updatedGraphPositions[selectedKeyType] || []),
      ];

      newItems.forEach((item, idx) => {
        const newZIndex = maxZIndex - idx;
        if (item.type === "key" && item.index !== undefined) {
          if (currentModePositions[item.index]) {
            currentModePositions[item.index] = {
              ...currentModePositions[item.index],
              zIndex: newZIndex,
            };
          }
        } else if (item.type === "stat" && item.index !== undefined) {
          if (currentStatModePositions[item.index]) {
            currentStatModePositions[item.index] = {
              ...currentStatModePositions[item.index],
              zIndex: newZIndex,
            };
          }
        } else if (item.type === "graph" && item.index !== undefined) {
          if (currentGraphModePositions[item.index]) {
            currentGraphModePositions[item.index] = {
              ...currentGraphModePositions[item.index],
              zIndex: newZIndex,
            };
          }
        } else if (item.type === "plugin") {
          usePluginDisplayElementStore.getState().updateElement(item.id, {
            zIndex: newZIndex,
          });
        }
      });

      // 일괄 업데이트
      updatedPositions[selectedKeyType] = currentModePositions;
      useKeyStore.getState().setPositions(updatedPositions);
      updatedStatPositions[selectedKeyType] = currentStatModePositions;
      useStatItemStore.getState().setPositions(updatedStatPositions);
      updatedGraphPositions[selectedKeyType] = currentGraphModePositions;
      useGraphItemStore.getState().setPositions(updatedGraphPositions);

      // 백엔드 동기화
      useKeyStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setLocalUpdateInProgress(true);
      useGraphItemStore.getState().setLocalUpdateInProgress(true);
      try {
        await window.api.keys.updatePositions(updatedPositions);
        await window.api.statItems.updatePositions(updatedStatPositions);
        await window.api.graphItems.updatePositions(updatedGraphPositions);
      } catch (error) {
        console.error("Failed to reorder group", error);
      } finally {
        useKeyStore.getState().setLocalUpdateInProgress(false);
        useStatItemStore.getState().setLocalUpdateInProgress(false);
        useGraphItemStore.getState().setLocalUpdateInProgress(false);
      }

      // 오버레이 동기화
      try {
        window.api.bridge.sendTo("overlay", "positions:sync", {
          positions: updatedPositions,
        });
      } catch {
        // ignore
      }
      try {
        window.api.bridge.sendTo("overlay", "statPositions:sync", {
          positions: updatedStatPositions,
        });
      } catch {
        // ignore
      }
      try {
        window.api.bridge.sendTo("overlay", "graphPositions:sync", {
          positions: updatedGraphPositions,
        });
      } catch {
        // ignore
      }
      try {
        const pluginEls =
          usePluginDisplayElementStore.getState().elements;
        window.api.bridge.sendTo("overlay", "plugin:displayElements:sync", {
          elements: pluginEls,
        });
      } catch {
        // ignore
      }
    },
    [selectedKeyType],
  );

  // 드래그 시작 (마우스 다운)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, item: LayerItem, index: number) => {
      if (e.button !== 0) return;

      clearPendingDeselect();

      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();

      dragStateRef.current = {
        startIndex: index,
        itemHeight: rect.height,
        currentOverIndex: null,
      };
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;

      // 마우스 이동 이벤트 핸들러
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (
          !dragStateRef.current ||
          !scrollElementRef.current ||
          !dragStartRef.current
        )
          return;

        const dx = moveEvent.clientX - dragStartRef.current.x;
        const dy = moveEvent.clientY - dragStartRef.current.y;

        if (!isDraggingRef.current) {
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          isDraggingRef.current = true;
          didDragRef.current = true;
          setDraggedItemId(item.id);
          setIsDragging(true);
        }

        moveEvent.preventDefault();

        const scrollRect = scrollElementRef.current.getBoundingClientRect();
        const relativeY =
          moveEvent.clientY -
          scrollRect.top +
          scrollElementRef.current.scrollTop;
        const newIndex = Math.max(
          0,
          Math.min(
            layerItemsRef.current.length,
            Math.floor(relativeY / dragStateRef.current.itemHeight),
          ),
        );

        dragStateRef.current.currentOverIndex = newIndex;
        setDragOverIndex(newIndex);
      };

      // 마우스 업 이벤트 핸들러
      const handleMouseUp = () => {
        if (dragStateRef.current && isDraggingRef.current) {
          const fromIndex = dragStateRef.current.startIndex;
          const toIndex = dragStateRef.current.currentOverIndex;

          if (toIndex !== null && fromIndex !== toIndex) {
            // 드롭 위치 계산: toIndex가 fromIndex보다 크면 -1
            const actualToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
            if (fromIndex !== actualToIndex) {
              performDrop(fromIndex, actualToIndex);
            }
          }
        }

        dragStateRef.current = null;
        dragStartRef.current = null;
        isDraggingRef.current = false;
        setDraggedItemId(null);
        setDragOverIndex(null);
        setIsDragging(false);

        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [clearPendingDeselect, performDrop],
  );

  // 그룹 헤더 드래그 시작 (그룹 단위 이동)
  const handleGroupMouseDown = useCallback(
    (e: React.MouseEvent, groupId: string) => {
      if (e.button !== 0) return;
      clearPendingDeselect();

      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();

      groupDragStateRef.current = {
        groupId,
        itemHeight: rect.height,
        currentOverIndex: null,
      };
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (
          !groupDragStateRef.current ||
          !scrollElementRef.current ||
          !dragStartRef.current
        )
          return;

        const dx = moveEvent.clientX - dragStartRef.current.x;
        const dy = moveEvent.clientY - dragStartRef.current.y;

        if (!isDraggingRef.current) {
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          isDraggingRef.current = true;
          didDragRef.current = true;
          setDraggedGroupId(groupId);
          setIsDragging(true);
        }

        moveEvent.preventDefault();

        const scrollRect = scrollElementRef.current.getBoundingClientRect();
        const relativeY =
          moveEvent.clientY -
          scrollRect.top +
          scrollElementRef.current.scrollTop;
        const displayCount = displayItemsRef.current.length;
        const newIndex = Math.max(
          0,
          Math.min(
            displayCount,
            Math.floor(relativeY / groupDragStateRef.current.itemHeight),
          ),
        );

        groupDragStateRef.current.currentOverIndex = newIndex;
        setDragOverDisplayIndex(newIndex);
      };

      const handleMouseUp = () => {
        if (groupDragStateRef.current && isDraggingRef.current) {
          const targetIdx = groupDragStateRef.current.currentOverIndex;
          if (targetIdx !== null) {
            performGroupDrop(groupId, targetIdx);
          }
        }

        groupDragStateRef.current = null;
        dragStartRef.current = null;
        isDraggingRef.current = false;
        setDraggedGroupId(null);
        setDragOverDisplayIndex(null);
        setIsDragging(false);

        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [clearPendingDeselect, performGroupDrop],
  );

  // 그룹 헤더 클릭 → 그룹 소속 아이템 전체 선택
  const handleGroupHeaderClick = useCallback(
    (groupId: string) => {
      onSelectionFromPanel?.();
      const children = layerItems.filter((item) => item.groupId === groupId);
      const elements = children.map((child) => ({
        type: child.type as any,
        id: child.id,
        index: child.index,
      }));
      clearSelection();
      setSelectedElements(elements);
    },
    [layerItems, clearSelection, setSelectedElements, onSelectionFromPanel],
  );

  // 그룹 헤더 우클릭 핸들러
  const handleGroupHeaderContextMenu = useCallback(
    (e: React.MouseEvent, groupId: string) => {
      e.preventDefault();
      e.stopPropagation();
      clearPendingDeselect();
      setContextMenuGroupId(groupId);
      setContextMenuItem(null);
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
      setContextMenuOpen(true);
    },
    [clearPendingDeselect],
  );

  return (
    <div className="flex-1 properties-panel-overlay-scroll">
      <div ref={setScrollRef} className="properties-panel-overlay-viewport">
        {layerItems.length === 0 ? (
          <div className="flex items-center justify-center h-full p-[16px]">
            <p className="text-[#6B6D75] text-style-4 text-center">
              {t("propertiesPanel.noLayers") || "No layers"}
            </p>
          </div>
        ) : (
          <div className="relative">
            {displayItems.map((displayItem, displayIndex) => {
              // ──────────────────────────────────────────────────
              // 그룹 헤더 렌더링
              // ──────────────────────────────────────────────────
              if (displayItem.displayType === "group-header") {
                const gh = displayItem;
                const isRenamingGroup =
                  renamingItemId === `group:${gh.groupId}`;
                const isBeingDragged = draggedGroupId === gh.groupId;
                const isSelected = isGroupHeaderSelected(gh.groupId);

                return (
                  <div
                    key={`group:${gh.groupId}`}
                    onMouseDown={(e) => handleGroupMouseDown(e, gh.groupId)}
                    onContextMenu={(e) =>
                      handleGroupHeaderContextMenu(e, gh.groupId)
                    }
                    onClick={() => {
                      if (didDragRef.current) {
                        didDragRef.current = false;
                        return;
                      }
                      handleGroupHeaderClick(gh.groupId);
                    }}
                    className={`
                      relative flex items-center gap-[8px] px-[12px] h-[34px]
                      select-none cursor-grab
                      ${gh.allHidden && !isBeingDragged ? "opacity-60" : ""}
                      ${isBeingDragged ? "opacity-30" : ""}
                      ${
                        isSelected
                          ? "bg-[#3B82F6]/20 text-[#DBDEE8]"
                          : isDragging
                            ? "text-[#9B9DA5]"
                            : "hover:bg-[#2A2A30] text-[#9B9DA5]"
                      }
                    `}
                  >
                    {/* 그룹 드래그 드롭 인디케이터 */}
                    {draggedGroupId &&
                      dragOverDisplayIndex === displayIndex &&
                      draggedGroupId !== gh.groupId && (
                        <div className="absolute left-0 right-0 top-0 h-[2px] bg-[#3B82F6] z-10" />
                      )}
                    {/* 접기/펼치기 토글 (아이콘 왼쪽 좁은 영역) */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[12px] flex items-center justify-center cursor-pointer z-[1]"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapsed(gh.groupId);
                      }}
                    >
                      <ChevronIcon collapsed={gh.isCollapsed} />
                    </div>

                    {/* 폴더 아이콘 (다른 요소 아이콘과 같은 X 위치) */}
                    <div className="flex-shrink-0">
                      <FolderIcon open={!gh.isCollapsed} />
                    </div>

                    {/* 그룹 이름 */}
                    {isRenamingGroup ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        className="flex-1 text-[12px] bg-transparent border-none p-0 outline-none text-[#DBDEE8] min-w-0 caret-[#3B82F6]"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => {
                          if (!renameCancelledRef.current) {
                            handleGroupRenameCommit(gh.groupId, renameValue);
                          }
                          renameCancelledRef.current = false;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            renameCancelledRef.current = true;
                            setRenamingItemId(null);
                          }
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="flex-1 text-[12px] truncate font-medium">
                        {gh.groupName}
                      </span>
                    )}

                    {/* 그룹 표시/숨김 토글 */}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleGroupVisibility(e, gh.groupId);
                      }}
                      className="flex-shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-[6px] hover:bg-[#4C4D53] cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                    >
                      {gh.allHidden ? (
                        <CloseEyeIcon
                          width={14}
                          height={14}
                          fill="currentColor"
                        />
                      ) : (
                        <OpenEyeIcon
                          width={14}
                          height={14}
                          fill="currentColor"
                        />
                      )}
                    </button>
                  </div>
                );
              }

              // ──────────────────────────────────────────────────
              // 레이어 아이템 렌더링
              // ──────────────────────────────────────────────────
              const { item, groupDepth, flatIndex } = displayItem;
              const paddingLeft = groupDepth > 0 ? 28 : 12;
              const isInDraggedGroup =
                draggedGroupId != null && item.groupId === draggedGroupId;

              return (
                <div
                  key={item.id}
                  onMouseDown={(e) => handleMouseDown(e, item, flatIndex)}
                  onClick={(e) => handleItemClick(item, flatIndex, e)}
                  onDoubleClick={(e) =>
                    handleItemDoubleClick(item, flatIndex, e)
                  }
                  onContextMenu={(e) => handleContextMenu(e, item, flatIndex)}
                  style={{ paddingLeft }}
                  className={`
                    relative flex items-center gap-[8px] pr-[12px] h-[34px]
                    select-none cursor-grab
                    ${item.hidden && !isInDraggedGroup ? "opacity-60" : ""}
                    ${isInDraggedGroup ? "opacity-30" : ""}
                    ${
                      isItemSelected(item)
                        ? "bg-[#3B82F6]/20 text-[#DBDEE8]"
                        : isDragging
                          ? "text-[#8B8D95]"
                          : "hover:bg-[#2A2A30] text-[#8B8D95]"
                    }
                  `}
                >
                  {/* 드롭 인디케이터 (피그마 스타일 선) - 위쪽 */}
                  {dragOverIndex === flatIndex &&
                    draggedItemId !== item.id && (
                      <div className="absolute left-0 right-0 top-0 h-[2px] bg-[#3B82F6] z-10" />
                    )}
                  {/* 그룹 드래그 드롭 인디케이터 */}
                  {draggedGroupId &&
                    dragOverDisplayIndex === displayIndex &&
                    item.groupId !== draggedGroupId && (
                      <div className="absolute left-0 right-0 top-0 h-[2px] bg-[#3B82F6] z-10" />
                    )}

                  {/* 아이콘 */}
                  <div className="flex-shrink-0">
                    {item.type === "key" ? (
                      <KeyIcon />
                    ) : item.type === "stat" ? (
                      <StatIcon />
                    ) : item.type === "graph" ? (
                      <GraphIcon />
                    ) : (
                      <PluginIcon />
                    )}
                  </div>

                  {/* 이름 */}
                  {renamingItemId === item.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="flex-1 text-[12px] bg-transparent border-none p-0 outline-none text-[#DBDEE8] min-w-0 caret-[#3B82F6]"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (!renameCancelledRef.current) {
                          handleLayerRenameCommit(item, renameValue);
                        }
                        renameCancelledRef.current = false;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          renameCancelledRef.current = true;
                          setRenamingItemId(null);
                        }
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-[12px] truncate">
                      {item.name}
                    </span>
                  )}

                  {/* 표시/숨김 토글 */}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => handleToggleVisibility(e, item)}
                    title={
                      item.hidden
                        ? t("propertiesPanel.showLayer") || "Show"
                        : t("propertiesPanel.hideLayer") || "Hide"
                    }
                    className="flex-shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-[6px] hover:bg-[#4C4D53] cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                  >
                    {item.hidden ? (
                      <CloseEyeIcon
                        width={14}
                        height={14}
                        fill="currentColor"
                      />
                    ) : (
                      <OpenEyeIcon
                        width={14}
                        height={14}
                        fill="currentColor"
                      />
                    )}
                  </button>
                </div>
              );
            })}

            {/* 마지막 아이템 뒤 드롭 인디케이터 */}
            {dragOverIndex === layerItems.length && (
              <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-[#3B82F6] z-10" />
            )}
            {/* 그룹 드래그: 마지막 아이템 뒤 드롭 인디케이터 */}
            {draggedGroupId &&
              dragOverDisplayIndex === displayItems.length && (
                <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-[#3B82F6] z-10" />
              )}
          </div>
        )}

        {/* 커스텀 스크롤바 */}
        <div className="properties-panel-overlay-bar">
          <div
            ref={thumbRef}
            className="properties-panel-overlay-thumb"
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* 컨텍스트 메뉴 */}
      {contextMenuOpen &&
        createPortal(
          <ListPopup
            open={contextMenuOpen}
            position={contextMenuPosition}
            onClose={() => {
              setContextMenuOpen(false);
              setContextMenuGroupId(null);
            }}
            items={contextMenuItems}
            onSelect={handleContextMenuSelect}
            className="!z-[10000]"
          />,
          document.body,
        )}
    </div>
  );
};

export default LayerTabContent;
