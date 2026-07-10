import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@contexts/useTranslation';
import {
  useGridSelectionStore,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { isMac } from '@utils/core/platform';
import { useLenis } from '@hooks/useLenis';
import ListPopup from '@components/main/Modal/ListPopup';
import CloseEyeIcon from '@assets/svgs/close_eye.svg';
import OpenEyeIcon from '@assets/svgs/open_eye.svg';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import type { LayerItem } from '../types';
import { buildLayerItems, buildDisplayItems } from './layerPanelModel';
import {
  FolderIcon,
  ChevronIcon,
  KeyIcon,
  KnobIcon,
  PluginIcon,
  StatIcon,
  GraphIcon,
} from './LayerIcons';
import { useLayerActions } from './useLayerActions';
import { useLayerDnD } from './useLayerDnD';

function layerItemToSelectedElement(item: LayerItem): SelectedElement {
  return {
    type: item.type,
    id: item.id,
    ...(item.index !== undefined ? { index: item.index } : {}),
  };
}

// ============================================================================
// 레이어 탭 콘텐츠 Props
// ============================================================================

interface LayerTabContentProps {
  onSwitchToProperty?: () => void;
  onSelectionFromPanel?: () => void;
}

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
  const knobPositions = useKnobItemStore((state) => state.positions);
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
  const selectedGroupIds = useGridSelectionStore(
    (state) => state.selectedGroupIds,
  );
  const setFullSelection = useGridSelectionStore(
    (state) => state.setFullSelection,
  );
  const setSelectedElements = useGridSelectionStore(
    (state) => state.setSelectedElements,
  );

  // Shift 선택 앵커
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [lastClickedDisplayIndex, setLastClickedDisplayIndex] = useState<
    number | null
  >(null);

  // 더블클릭/클릭 충돌 방지 타이머
  const pendingDeselectTimerRef = useRef<number | null>(null);
  const clearPendingDeselect = () => {
    if (pendingDeselectTimerRef.current !== null) {
      window.clearTimeout(pendingDeselectTimerRef.current);
      pendingDeselectTimerRef.current = null;
    }
  };
  useEffect(() => {
    return () => clearPendingDeselect();
  });

  // 스크롤 상태
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  const calculateThumb = (el: HTMLDivElement) => {
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

  const updateThumbDOM = () => {
    if (!thumbRef.current || !scrollElementRef.current) return;
    const thumb = calculateThumb(scrollElementRef.current);
    thumbRef.current.style.top = `${thumb.top}px`;
    thumbRef.current.style.height = `${thumb.height}px`;
    thumbRef.current.style.display = thumb.visible ? 'block' : 'none';
  };

  const { scrollContainerRef: lenisRef, lenisInstance } = useLenis({
    onScroll: updateThumbDOM,
  });

  const setScrollRef = (node: HTMLDivElement | null) => {
    scrollElementRef.current = node;
    lenisRef(node);
  };

  useEffect(() => {
    updateThumbDOM();
  });

  // 레이어 아이템 목록
  const layerItems = buildLayerItems({
    selectedKeyType,
    positions,
    keyMappings,
    statPositions,
    graphPositions,
    knobPositions,
    pluginElements,
  });

  // 레이어 그룹 스토어
  const allLayerGroups = useLayerGroupStore((state) => state.layerGroups);
  const layerGroupsForMode = allLayerGroups[selectedKeyType] || [];
  const collapsedGroups = useLayerGroupStore((state) => state.collapsedGroups);
  const toggleCollapsed = useLayerGroupStore((state) => state.toggleCollapsed);

  // 디스플레이 아이템
  const displayItems = buildDisplayItems({
    layerItems,
    layerGroupsForMode,
    collapsedGroups,
    defaultGroupName: t('layerGroup.defaultName'),
  });

  // Refs (이벤트 핸들러에서 최신 값 참조)
  const layerItemsRef = useRef(layerItems);
  const displayItemsRef = useRef(displayItems);
  useEffect(() => {
    layerItemsRef.current = layerItems;
    displayItemsRef.current = displayItems;
  });

  // 콘텐츠 높이 변경 시 Lenis 갱신
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize();
      updateThumbDOM();
    });
    return () => cancelAnimationFrame(rafId);
  });

  // 접기/펼치기 시 displayIndex 앵커 리셋 (stale 인덱스 방지)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- collapsedGroups 변경 시 stale 앵커 리셋 (의도적)
    setLastClickedDisplayIndex(null);
  }, [collapsedGroups]);

  // ──────────────────────────────────────────────────────────────────────────
  // 액션 훅
  // ──────────────────────────────────────────────────────────────────────────

  const actions = useLayerActions({
    selectedKeyType,
    layerItems,
    layerGroupsForMode,
    onSelectionFromPanel,
    clearPendingDeselect,
    displayItemsRef,
    setLastClickedIndex,
    setLastClickedDisplayIndex,
    t,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DnD 훅
  // ──────────────────────────────────────────────────────────────────────────

  const dnd = useLayerDnD({
    selectedKeyType,
    layerItemsRef,
    displayItemsRef,
    scrollElementRef,
    clearPendingDeselect,
  });

  // 선택 상태 (렌더링용)
  const selectedElementIdSet = new Set(selectedElements.map((el) => el.id));
  const selectedGroupIdSet = new Set(selectedGroupIds);
  const isItemSelected = (item: LayerItem) => selectedElementIdSet.has(item.id);
  const isGroupHeaderSelected = (groupId: string) =>
    selectedGroupIdSet.has(groupId);

  // ──────────────────────────────────────────────────────────────────────────
  // 더블클릭 핸들러
  // ──────────────────────────────────────────────────────────────────────────

  const handleItemDoubleClick = (
    item: LayerItem,
    index: number,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    if (dnd.getDidDrag() || dnd.getIsDraggingRef()) return;

    clearPendingDeselect();
    onSelectionFromPanel?.();

    clearSelection();
    toggleSelection(layerItemToSelectedElement(item));

    onSwitchToProperty?.();
    setLastClickedIndex(index);

    const displayIdx = displayItemsRef.current.findIndex(
      (di) => di.displayType === 'layer' && di.item.id === item.id,
    );
    setLastClickedDisplayIndex(displayIdx !== -1 ? displayIdx : null);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 아이템 클릭 핸들러
  // ──────────────────────────────────────────────────────────────────────────

  const handleItemClick = (
    item: LayerItem,
    index: number,
    e: React.MouseEvent,
  ) => {
    clearPendingDeselect();

    if (dnd.getDidDrag()) {
      dnd.resetDidDrag();
      return;
    }
    if (dnd.getIsDraggingRef()) return;

    onSelectionFromPanel?.();

    const isPrimaryModifierPressed = isMac() ? e.metaKey : e.ctrlKey;
    const isShiftPressed = e.shiftKey;

    // Shift+클릭: 범위 선택
    if (
      isShiftPressed &&
      (lastClickedDisplayIndex !== null || lastClickedIndex !== null)
    ) {
      const thisDisplayIdx = displayItemsRef.current.findIndex(
        (di) => di.displayType === 'layer' && di.item.id === item.id,
      );

      if (lastClickedDisplayIndex !== null && thisDisplayIdx !== -1) {
        const startIdx = Math.min(lastClickedDisplayIndex, thisDisplayIdx);
        const endIdx = Math.max(lastClickedDisplayIndex, thisDisplayIdx);
        const currentDisplay = displayItemsRef.current;

        const rangeElements: SelectedElement[] = [];
        const rangeGroupIds: string[] = [];

        for (let i = startIdx; i <= endIdx; i++) {
          const di = currentDisplay[i];
          if (!di) continue;
          if (di.displayType === 'group-header') {
            rangeGroupIds.push(di.groupId);
            const groupChildren = layerItemsRef.current.filter(
              (it) => it.groupId === di.groupId,
            );
            groupChildren.forEach((child) => {
              rangeElements.push(layerItemToSelectedElement(child));
            });
          } else {
            rangeElements.push(layerItemToSelectedElement(di.item));
          }
        }

        const seen = new Set<string>();
        const deduped = rangeElements.filter((el) => {
          if (seen.has(el.id)) return false;
          seen.add(el.id);
          return true;
        });

        if (isPrimaryModifierPressed) {
          const existingIds = new Set(selectedElements.map((el) => el.id));
          const newEls = deduped.filter((el) => !existingIds.has(el.id));
          const mergedElements = [...selectedElements, ...newEls];
          const existingGroupIds = new Set(selectedGroupIds);
          const newGroupIds = rangeGroupIds.filter(
            (id) => !existingGroupIds.has(id),
          );
          setFullSelection(mergedElements, [
            ...selectedGroupIds,
            ...newGroupIds,
          ]);
        } else {
          setFullSelection(deduped, rangeGroupIds);
        }
        return;
      }

      // fallback: layerItems 인덱스 기반
      if (lastClickedIndex !== null) {
        const startIdx = Math.min(lastClickedIndex, index);
        const endIdx = Math.max(lastClickedIndex, index);
        const currentItems = layerItemsRef.current;

        const rangeElements: SelectedElement[] = [];
        for (let i = startIdx; i <= endIdx; i++) {
          const rangeItem = currentItems[i];
          if (rangeItem) {
            rangeElements.push(layerItemToSelectedElement(rangeItem));
          }
        }

        if (isPrimaryModifierPressed) {
          const existingIds = new Set(selectedElements.map((el) => el.id));
          const newElements = rangeElements.filter(
            (el) => !existingIds.has(el.id),
          );
          setSelectedElements([...selectedElements, ...newElements]);
        } else {
          setSelectedElements(rangeElements);
        }
        return;
      }
    }

    // Ctrl+클릭 또는 일반 클릭
    const isAlreadySelected = selectedElements.some((el) => el.id === item.id);
    const element = layerItemToSelectedElement(item);

    if (isPrimaryModifierPressed) {
      const exists = selectedElements.some((el) => el.id === element.id);
      if (exists) {
        setFullSelection(
          selectedElements.filter((el) => el.id !== element.id),
          selectedGroupIds,
        );
      } else {
        setFullSelection([...selectedElements, element], selectedGroupIds);
      }
    } else {
      if (isAlreadySelected && selectedElements.length > 1) {
        pendingDeselectTimerRef.current = window.setTimeout(() => {
          setFullSelection([element], []);
          pendingDeselectTimerRef.current = null;
        }, 50);
      } else if (isAlreadySelected) {
        pendingDeselectTimerRef.current = window.setTimeout(() => {
          clearSelection();
          pendingDeselectTimerRef.current = null;
        }, 50);
      } else {
        clearSelection();
        toggleSelection(element);
      }
    }

    setLastClickedIndex(index);
    const displayIdx = displayItemsRef.current.findIndex(
      (di) => di.displayType === 'layer' && di.item.id === item.id,
    );
    setLastClickedDisplayIndex(displayIdx !== -1 ? displayIdx : null);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 그룹 헤더 클릭
  // ──────────────────────────────────────────────────────────────────────────

  const handleGroupHeaderClick = (groupId: string, e: React.MouseEvent) => {
    onSelectionFromPanel?.();
    clearPendingDeselect();

    if (dnd.getDidDrag()) {
      dnd.resetDidDrag();
      return;
    }
    if (dnd.getIsDraggingRef()) return;

    const isPrimaryModifierPressed = isMac() ? e.metaKey : e.ctrlKey;
    const isShiftPressed = e.shiftKey;

    const children = layerItems.filter((item) => item.groupId === groupId);
    const childElements = children.map(layerItemToSelectedElement);

    const thisDisplayIdx = displayItemsRef.current.findIndex(
      (di) => di.displayType === 'group-header' && di.groupId === groupId,
    );
    if (thisDisplayIdx < 0) return;

    if (isShiftPressed && lastClickedDisplayIndex !== null) {
      const startIdx = Math.min(lastClickedDisplayIndex, thisDisplayIdx);
      const endIdx = Math.max(lastClickedDisplayIndex, thisDisplayIdx);
      const currentDisplay = displayItemsRef.current;

      const rangeElements: SelectedElement[] = [];
      const rangeGroupIds: string[] = [];

      for (let i = startIdx; i <= endIdx; i++) {
        const di = currentDisplay[i];
        if (!di) continue;
        if (di.displayType === 'group-header') {
          rangeGroupIds.push(di.groupId);
          const groupChildren = layerItemsRef.current.filter(
            (item) => item.groupId === di.groupId,
          );
          groupChildren.forEach((child) => {
            rangeElements.push(layerItemToSelectedElement(child));
          });
        } else {
          rangeElements.push(layerItemToSelectedElement(di.item));
        }
      }

      const seen = new Set<string>();
      const deduped = rangeElements.filter((el) => {
        if (seen.has(el.id)) return false;
        seen.add(el.id);
        return true;
      });

      if (isPrimaryModifierPressed) {
        const existingIds = new Set(selectedElements.map((el) => el.id));
        const newEls = deduped.filter((el) => !existingIds.has(el.id));
        const mergedElements = [...selectedElements, ...newEls];
        const existingGroupIds = new Set(selectedGroupIds);
        const newGroupIds = rangeGroupIds.filter(
          (id) => !existingGroupIds.has(id),
        );
        const mergedGroupIds = [...selectedGroupIds, ...newGroupIds];
        setFullSelection(mergedElements, mergedGroupIds);
      } else {
        setFullSelection(deduped, rangeGroupIds);
      }
      return;
    }

    if (isPrimaryModifierPressed) {
      const isCurrentlySelected = selectedGroupIdSet.has(groupId);
      if (isCurrentlySelected) {
        const childIds = new Set(children.map((c) => c.id));
        const remaining = selectedElements.filter((el) => !childIds.has(el.id));
        const remainingGroups = selectedGroupIds.filter((id) => id !== groupId);
        setFullSelection(remaining, remainingGroups);
      } else {
        const existingIds = new Set(selectedElements.map((el) => el.id));
        const newEls = childElements.filter((el) => !existingIds.has(el.id));
        const mergedElements = [...selectedElements, ...newEls];
        const mergedGroupIds = [...selectedGroupIds, groupId];
        setFullSelection(mergedElements, mergedGroupIds);
      }
    } else {
      setFullSelection(childElements, [groupId]);
    }

    setLastClickedDisplayIndex(thisDisplayIdx);
    setLastClickedIndex(null);
  };

  // 빈 공간 클릭 시 선택 해제
  const handleEmptySpaceMouseDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    clearPendingDeselect();
    onSelectionFromPanel?.();
    clearSelection();
    setLastClickedIndex(null);
    setLastClickedDisplayIndex(null);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 렌더링
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex-1 properties-panel-overlay-scroll group/panel"
      onMouseDown={handleEmptySpaceMouseDown}
    >
      <div
        ref={setScrollRef}
        className="properties-panel-overlay-viewport"
        onMouseDown={handleEmptySpaceMouseDown}
      >
        {layerItems.length === 0 ? (
          <div className="flex items-center justify-center h-full p-[16px]">
            <p className="text-fg-faint text-body text-center">
              {t('propertiesPanel.noLayers') || 'No layers'}
            </p>
          </div>
        ) : (
          <div className="relative">
            {displayItems.map((displayItem, displayIndex) => {
              // ── 그룹 헤더 렌더링 ──
              if (displayItem.displayType === 'group-header') {
                const gh = displayItem;
                const isRenamingGroup =
                  actions.renamingItemId === `group:${gh.groupId}`;
                const isBeingDragged = dnd.draggedGroupId === gh.groupId;
                const isSelected = isGroupHeaderSelected(gh.groupId);

                return (
                  <div
                    key={`group:${gh.groupId}`}
                    onMouseDown={(e) => dnd.handleGroupMouseDown(e, gh.groupId)}
                    onContextMenu={(e) =>
                      actions.handleGroupHeaderContextMenu(e, gh.groupId)
                    }
                    onClick={(e) => {
                      handleGroupHeaderClick(gh.groupId, e);
                    }}
                    className={`
                      group relative flex items-center gap-[8px] pl-[12px] pr-[4px] h-[34px]
                      select-none cursor-grab
                      ${gh.allHidden && !isBeingDragged ? 'opacity-60' : ''}
                      ${isBeingDragged ? 'opacity-30' : ''}
                      ${
                        isSelected
                          ? 'bg-accent-muted text-fg'
                          : dnd.isDragging
                          ? 'text-fg-muted'
                          : 'hover:bg-surface-hover text-fg-muted'
                      }
                    `}
                  >
                    {/* 아이템 드래그 드롭 인디케이터 */}
                    {dnd.draggedItemId &&
                      dnd.dragOverItemDisplayIndex === displayIndex && (
                        <div className="absolute left-0 right-0 top-0 h-[2px] bg-accent z-10" />
                      )}
                    {dnd.draggedItemId &&
                      dnd.dragOverHeaderBottomGroupId === gh.groupId && (
                        <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-accent z-10" />
                      )}
                    {/* 그룹 드래그 드롭 인디케이터 */}
                    {dnd.draggedGroupId &&
                      dnd.dragOverDisplayIndex === displayIndex &&
                      dnd.draggedGroupId !== gh.groupId && (
                        <div className="absolute left-0 right-0 top-0 h-[2px] bg-accent z-10" />
                      )}
                    {/* 접기/펼치기 토글 */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[34px] flex items-center pl-[1px] cursor-pointer z-[1]"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapsed(gh.groupId);
                      }}
                    >
                      <div className="opacity-0 group-hover/panel:opacity-60 hover:!opacity-100">
                        <ChevronIcon collapsed={gh.isCollapsed} />
                      </div>
                    </div>

                    {/* 폴더 아이콘 */}
                    <div className="flex-shrink-0">
                      <FolderIcon open={!gh.isCollapsed} />
                    </div>

                    {/* 그룹 이름 */}
                    {isRenamingGroup ? (
                      <input
                        ref={actions.renameInputRef}
                        type="text"
                        className="flex-1 text-body bg-transparent border-none p-0 outline-none text-fg min-w-0 caret-accent"
                        value={actions.renameValue}
                        onChange={(e) => actions.setRenameValue(e.target.value)}
                        onBlur={() => {
                          if (!actions.renameCancelledRef.current) {
                            actions.handleGroupRenameCommit(
                              gh.groupId,
                              actions.renameValue,
                            );
                          }
                          actions.renameCancelledRef.current = false;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            actions.renameCancelledRef.current = true;
                            actions.setRenamingItemId(null);
                          }
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="flex-1 text-body truncate font-medium">
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
                        actions.handleToggleGroupVisibility(e, gh.groupId);
                      }}
                      className={`flex-shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-[6px] hover:bg-white/[0.12] cursor-pointer ${
                        gh.allHidden
                          ? ''
                          : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                      }`}
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

              // ── 레이어 아이템 렌더링 ──
              const { item, groupDepth, flatIndex } = displayItem;
              const paddingLeft = groupDepth > 0 ? 28 : 12;
              const isInDraggedGroup =
                dnd.draggedGroupId != null &&
                item.groupId === dnd.draggedGroupId;

              return (
                <div
                  key={item.id}
                  onMouseDown={(e) => dnd.handleMouseDown(e, item, flatIndex)}
                  onClick={(e) => handleItemClick(item, flatIndex, e)}
                  onDoubleClick={(e) =>
                    handleItemDoubleClick(item, flatIndex, e)
                  }
                  onContextMenu={(e) =>
                    actions.handleContextMenu(e, item, flatIndex)
                  }
                  style={{ paddingLeft }}
                  className={`
                    group relative flex items-center gap-[8px] pr-[4px] h-[34px]
                    select-none cursor-grab
                    ${item.hidden && !isInDraggedGroup ? 'opacity-60' : ''}
                    ${isInDraggedGroup ? 'opacity-30' : ''}
                    ${
                      isItemSelected(item)
                        ? 'bg-accent-muted text-fg'
                        : dnd.isDragging
                        ? 'text-fg-muted'
                        : 'hover:bg-surface-hover text-fg-muted'
                    }
                  `}
                >
                  {/* 드롭 인디케이터 */}
                  {dnd.draggedItemId &&
                    dnd.dragOverItemDisplayIndex === displayIndex &&
                    !dnd.draggedItemIdsRef.current.includes(item.id) && (
                      <div className="absolute left-0 right-0 top-0 h-[2px] bg-accent z-10" />
                    )}
                  {dnd.draggedGroupId &&
                    dnd.dragOverDisplayIndex === displayIndex &&
                    item.groupId !== dnd.draggedGroupId && (
                      <div className="absolute left-0 right-0 top-0 h-[2px] bg-accent z-10" />
                    )}

                  {/* 아이콘 */}
                  <div className="flex-shrink-0">
                    {item.type === 'key' ? (
                      <KeyIcon />
                    ) : item.type === 'stat' ? (
                      <StatIcon />
                    ) : item.type === 'graph' ? (
                      <GraphIcon />
                    ) : item.type === 'knob' ? (
                      <KnobIcon />
                    ) : (
                      <PluginIcon />
                    )}
                  </div>

                  {/* 이름 */}
                  {actions.renamingItemId === item.id ? (
                    <input
                      ref={actions.renameInputRef}
                      type="text"
                      className="flex-1 text-body bg-transparent border-none p-0 outline-none text-fg min-w-0 caret-accent"
                      value={actions.renameValue}
                      onChange={(e) => actions.setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (!actions.renameCancelledRef.current) {
                          actions.handleLayerRenameCommit(
                            item,
                            actions.renameValue,
                          );
                        }
                        actions.renameCancelledRef.current = false;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          actions.renameCancelledRef.current = true;
                          actions.setRenamingItemId(null);
                        }
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-body truncate">
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
                    onClick={(e) => actions.handleToggleVisibility(e, item)}
                    title={
                      item.hidden
                        ? t('propertiesPanel.showLayer') || 'Show'
                        : t('propertiesPanel.hideLayer') || 'Hide'
                    }
                    className={`flex-shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-[6px] hover:bg-white/[0.12] cursor-pointer ${
                      item.hidden
                        ? ''
                        : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                    }`}
                  >
                    {item.hidden ? (
                      <CloseEyeIcon
                        width={14}
                        height={14}
                        fill="currentColor"
                      />
                    ) : (
                      <OpenEyeIcon width={14} height={14} fill="currentColor" />
                    )}
                  </button>
                </div>
              );
            })}

            {/* 마지막 아이템 뒤 드롭 인디케이터 */}
            {dnd.draggedItemId &&
              dnd.dragOverItemDisplayIndex === displayItems.length && (
                <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-accent z-10" />
              )}
            {dnd.draggedGroupId &&
              dnd.dragOverDisplayIndex === displayItems.length && (
                <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-accent z-10" />
              )}
          </div>
        )}

        {/* 커스텀 스크롤바 */}
        <div className="properties-panel-overlay-bar">
          <div
            ref={thumbRef}
            className="properties-panel-overlay-thumb"
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* 컨텍스트 메뉴 */}
      {actions.contextMenuOpen &&
        createPortal(
          <ListPopup
            open={actions.contextMenuOpen}
            position={actions.contextMenuPosition}
            onClose={() => {
              actions.setContextMenuOpen(false);
              actions.setContextMenuGroupId(null);
            }}
            items={actions.contextMenuItems}
            onSelect={actions.handleContextMenuSelect}
            className="!z-[10000]"
          />,
          document.body,
        )}
    </div>
  );
};

export default LayerTabContent;
