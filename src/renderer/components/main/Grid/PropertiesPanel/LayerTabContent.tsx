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
import { usePluginDisplayElementStore } from "@stores/usePluginDisplayElementStore";
import { useHistoryStore } from "@stores/useHistoryStore";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { useLenis } from "@hooks/useLenis";
import ListPopup, { type ListItem } from "@components/main/Modal/ListPopup";
import CloseEyeIcon from "@assets/svgs/close_eye.svg";
import OpenEyeIcon from "@assets/svgs/open_eye.svg";

// ============================================================================
// 레이어 아이템 타입
// ============================================================================

interface LayerItem {
  type: "key" | "stat" | "plugin";
  id: string;
  index?: number; // key/stat인 경우
  name: string;
  zIndex: number;
  hidden: boolean;
}

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
      items.push({
        type: "key",
        id: `key-${index}`,
        index,
        name: keyInfo?.displayName || keyCode || `Key ${index + 1}`,
        zIndex: pos.zIndex ?? index,
        hidden: !!pos.hidden,
      });
    });

    // 통계 아이템 추가
    const currentStatPositions = statPositions[selectedKeyType] || [];
    currentStatPositions.forEach((pos, index) => {
      const name =
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
        name,
        zIndex: pos.zIndex ?? index,
        hidden: !!pos.hidden,
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
      });
    });

    // z-index 내림차순 정렬 (높은 것이 위에)
    items.sort((a, b) => b.zIndex - a.zIndex);

    return items;
  }, [positions, statPositions, selectedKeyType, keyMappings, pluginElements]);

  // layerItems를 ref로도 저장 (이벤트 핸들러에서 최신 값 참조용)
  const layerItemsRef = useRef(layerItems);
  layerItemsRef.current = layerItems;

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
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      useHistoryStore
        .getState()
        .pushState(km, pos, currentStatPositions as any, currentPluginElements);

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
  const isItemSelected = useCallback(
    (item: LayerItem) => {
      return selectedElements.some((el) => el.id === item.id);
    },
    [selectedElements],
  );

  // 컨텍스트 메뉴 아이템
  const contextMenuItems = useMemo<ListItem[]>(() => {
    return [{ id: "delete", label: t("propertiesPanel.delete") || "Delete" }];
  }, [t]);

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

  // 컨텍스트 메뉴 선택 핸들러
  const handleContextMenuSelect = useCallback(
    async (itemId: string) => {
      if (itemId === "delete") {
        // 선택된 요소들 삭제
        if (selectedElements.length === 0) return;

        const keysToDelete = selectedElements
          .filter((el) => el.type === "key" && el.index !== undefined)
          .map((el) => el.index as number);

        const statsToDelete = selectedElements
          .filter((el) => el.type === "stat" && el.index !== undefined)
          .map((el) => el.index as number);

        const pluginsToDelete = selectedElements
          .filter((el) => el.type === "plugin")
          .map((el) => el.id);

        // 히스토리 저장
        if (
          keysToDelete.length > 0 ||
          statsToDelete.length > 0 ||
          pluginsToDelete.length > 0
        ) {
          const { keyMappings: km, positions: pos } = useKeyStore.getState();
          const currentStatPositions = useStatItemStore.getState().positions;
          const currentPluginElements =
            usePluginDisplayElementStore.getState().elements;
          useHistoryStore
            .getState()
            .pushState(km, pos, currentStatPositions as any, currentPluginElements);
        }

        // 선택 해제
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
      }

      setContextMenuOpen(false);
    },
    [selectedElements, selectedKeyType, clearSelection],
  );

  // 드롭 처리
  const performDrop = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;

      const items = [...layerItemsRef.current];

      if (fromIndex === -1 || fromIndex === toIndex) return;

      // 히스토리 저장
      const currentPositions = useKeyStore.getState().positions;
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const { keyMappings: km } = useKeyStore.getState();
      useHistoryStore
        .getState()
        .pushState(km, currentPositions, currentStatPositions as any, currentPluginElements);

      // 아이템 재정렬
      const [removed] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, removed);

      // 새 z-index 계산 및 적용
      const maxZIndex = items.length - 1;

      // 키 positions 복사 및 업데이트
      const updatedPositions = { ...useKeyStore.getState().positions };
      const currentModePositions = [
        ...(updatedPositions[selectedKeyType] || []),
      ];

      // 통계 positions 복사 및 업데이트
      const updatedStatPositions = { ...useStatItemStore.getState().positions };
      const currentStatModePositions = [
        ...(updatedStatPositions[selectedKeyType] || []),
      ];

      items.forEach((item, idx) => {
        const newZIndex = maxZIndex - idx; // 맨 위가 가장 높은 z-index

        if (item.type === "key" && item.index !== undefined) {
          // 키 z-index 업데이트
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
        } else if (item.type === "plugin") {
          // 플러그인 z-index 업데이트
          usePluginDisplayElementStore.getState().updateElement(item.id, {
            zIndex: newZIndex,
          });
        }
      });

      // 키 positions 일괄 업데이트
      updatedPositions[selectedKeyType] = currentModePositions;
      useKeyStore.getState().setPositions(updatedPositions);

      // 통계 positions 일괄 업데이트
      updatedStatPositions[selectedKeyType] = currentStatModePositions;
      useStatItemStore.getState().setPositions(updatedStatPositions);

      // 백엔드/오버레이 동기화 (레이어 정렬 결과 즉시 반영)
      useKeyStore.getState().setLocalUpdateInProgress(true);
      useStatItemStore.getState().setLocalUpdateInProgress(true);
      try {
        await window.api.keys.updatePositions(updatedPositions);
        await window.api.statItems.updatePositions(updatedStatPositions);
      } catch (error) {
        console.error("Failed to reorder layers", error);
      } finally {
        useKeyStore.getState().setLocalUpdateInProgress(false);
        useStatItemStore.getState().setLocalUpdateInProgress(false);
      }

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
            {layerItems.map((item, index) => (
              <div
                key={item.id}
                onMouseDown={(e) => handleMouseDown(e, item, index)}
                onClick={(e) => handleItemClick(item, index, e)}
                onDoubleClick={(e) => handleItemDoubleClick(item, index, e)}
                onContextMenu={(e) => handleContextMenu(e, item, index)}
                className={`
                  relative flex items-center gap-[8px] px-[12px] h-[34px]
                  select-none cursor-grab
                  ${item.hidden ? "opacity-60" : ""}
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
                {dragOverIndex === index && draggedItemId !== item.id && (
                  <div className="absolute left-0 right-0 top-0 h-[2px] bg-[#3B82F6] z-10" />
                )}

                {/* 아이콘 */}
                <div className="flex-shrink-0">
                  {item.type === "key" ? (
                    <KeyIcon />
                  ) : item.type === "stat" ? (
                    <StatIcon />
                  ) : (
                    <PluginIcon />
                  )}
                </div>

                {/* 이름 */}
                <span className="flex-1 text-[12px] truncate">{item.name}</span>

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
                    <CloseEyeIcon width={14} height={14} fill="currentColor" />
                  ) : (
                    <OpenEyeIcon width={14} height={14} fill="currentColor" />
                  )}
                </button>
              </div>
            ))}

            {/* 마지막 아이템 뒤 드롭 인디케이터 */}
            {dragOverIndex === layerItems.length && (
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
            onClose={() => setContextMenuOpen(false)}
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
