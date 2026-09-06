import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@contexts/useTranslation';
import { usePopupPresence } from '@hooks/ui/usePopupPresence';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import {
  selectPropertyPanelPluginElements,
  usePluginDisplayElementStore,
} from '@stores/plugin/usePluginDisplayElementStore';
import { isMac } from '@utils/core/platform';
import { useLenis } from '@hooks/useLenis';
import { usePanelHost } from '@contexts/PanelHostContext';
import ListPopup from '@components/main/Modal/listPopup/ListPopup';
import IconSwap from '@components/main/common/IconSwap';
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
import LayerRenameInput from './LayerRenameInput';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';
import {
  layerItemToSelectedElement,
  resolveLayerGroupSelectionIntent,
  resolveLayerItemSelectionIntent,
  type LayerSelectionIntent,
} from './layerSelectionIntent';

interface LayerGroupDisclosureProps {
  collapsed: boolean;
  onToggle: () => void;
}

const LayerGroupDisclosure = ({
  collapsed,
  onToggle,
}: LayerGroupDisclosureProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { value: visualCollapsed, toggle } = useOptimisticBooleanCommit({
    canonicalValue: collapsed,
    onCommit: onToggle,
    frameHostRef: buttonRef,
  });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={!visualCollapsed}
        className="absolute left-0 top-0 bottom-0 w-[34px] flex items-center pl-[1px] cursor-pointer z-[1]"
        onMouseDown={(event) => {
          // 행 드래그 시작 억제 (press 동안 grabbing 커서 방지)
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <span className="opacity-0 group-hover/panel:opacity-60 hover:!opacity-100">
          <ChevronIcon collapsed={visualCollapsed} />
        </span>
      </button>
      <div className="flex-shrink-0">
        <FolderIcon open={!visualCollapsed} />
      </div>
    </>
  );
};

interface LayerGroupVisibilityButtonProps {
  groupId: string;
  allHidden: boolean;
  onToggle: (event: React.MouseEvent, groupId: string) => void;
}

export const LayerGroupVisibilityButton = ({
  groupId,
  allHidden,
  onToggle,
}: LayerGroupVisibilityButtonProps) => (
  <button
    type="button"
    aria-label="toggle group visibility"
    onMouseDown={(event) => {
      event.preventDefault();
      event.stopPropagation();
    }}
    onDoubleClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
    }}
    onClick={(event) => {
      event.stopPropagation();
      onToggle(event, groupId);
    }}
    className={`flex-shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-md cursor-pointer ${
      allHidden ? '' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
    }`}
  >
    <IconSwap
      active={allHidden}
      activeIcon={<CloseEyeIcon width={14} height={14} fill="currentColor" />}
      inactiveIcon={<OpenEyeIcon width={14} height={14} fill="currentColor" />}
    />
  </button>
);

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
    selectPropertyPanelPluginElements,
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

  // 패널이 사는 창 - 분리 시 프레임·타이머를 자식 창에 싣는다
  const { window: hostWindow } = usePanelHost();

  // 더블클릭/클릭 충돌 방지 타이머
  const pendingDeselectTimerRef = useRef<number | null>(null);
  const clearPendingDeselect = () => {
    if (pendingDeselectTimerRef.current !== null) {
      (hostWindow ?? window).clearTimeout(pendingDeselectTimerRef.current);
      pendingDeselectTimerRef.current = null;
    }
  };
  useEffect(() => {
    return () => clearPendingDeselect();
  });

  // 스크롤 상태 — scrollElementRef는 DnD 훅의 오토스크롤 계산용
  const scrollElementRef = useRef<HTMLDivElement | null>(null);

  const { scrollContainerRef: lenisRef, lenisInstance } = useLenis();

  const setScrollRef = (node: HTMLDivElement | null) => {
    scrollElementRef.current = node;
    lenisRef(node);
  };

  // 레이어 그룹 스토어
  const allLayerGroups = useLayerGroupStore((state) => state.layerGroups);
  const layerGroupsForMode = allLayerGroups[selectedKeyType] || [];
  const collapsedGroups = useLayerGroupStore((state) => state.collapsedGroups);
  const toggleCollapsed = useLayerGroupStore((state) => state.toggleCollapsed);

  // 레이어 아이템 목록
  const layerItems = buildLayerItems({
    selectedKeyType,
    positions,
    keyMappings,
    statPositions,
    graphPositions,
    knobPositions,
    pluginElements,
    layerGroupsForMode,
  });

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

  // 콘텐츠 높이 변경 시 Lenis 갱신 - 분리 창에서는 그 창의 프레임에 실어야
  // 메인이 가려져도 멈추지 않는다
  useEffect(() => {
    const win = hostWindow ?? window;
    const rafId = win.requestAnimationFrame(() => {
      lenisInstance.current?.resize();
    });
    return () => win.cancelAnimationFrame(rafId);
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

  // 퇴장 모션이 도는 동안 메뉴 DOM과 표시 내용을 유지한다
  const contextMenuPresence = usePopupPresence(actions.contextMenuOpen);
  const contextMenuShown = useRetainedWhileOpen(actions.contextMenuOpen, {
    position: actions.contextMenuPosition,
    items: actions.contextMenuItems,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DnD 훅
  // ──────────────────────────────────────────────────────────────────────────

  // 드롭 확정 시점의 authoritative 재구성 - effect 지연 ref는 외부
  // 재정렬을 한 렌더 늦게 본다
  const buildLiveLayerModel = () => {
    const keyState = useKeyStore.getState();
    const liveGroupState = useLayerGroupStore.getState();
    const liveLayerItems = buildLayerItems({
      selectedKeyType,
      positions: keyState.canonicalPositions,
      keyMappings: keyState.keyMappings,
      statPositions: useStatItemStore.getState().positions,
      graphPositions: useGraphItemStore.getState().positions,
      knobPositions: useKnobItemStore.getState().positions,
      // 패널 창의 elements는 항상 비어 있으므로 창별 미러 셀렉터를 경유한다
      pluginElements: selectPropertyPanelPluginElements(
        usePluginDisplayElementStore.getState(),
      ),
      layerGroupsForMode: liveGroupState.layerGroups[selectedKeyType] || [],
    });
    const groupState = useLayerGroupStore.getState();
    const liveDisplayItems = buildDisplayItems({
      layerItems: liveLayerItems,
      layerGroupsForMode: groupState.layerGroups[selectedKeyType] || [],
      collapsedGroups: groupState.collapsedGroups,
      defaultGroupName: t('layerGroup.defaultName'),
    });
    return { layerItems: liveLayerItems, displayItems: liveDisplayItems };
  };

  const dnd = useLayerDnD({
    selectedKeyType,
    layerItemsRef,
    displayItemsRef,
    scrollElementRef,
    clearPendingDeselect,
    buildLiveLayerModel,
  });

  // 선택 상태 (렌더링용)
  const selectedElementIdSet = new Set(selectedElements.map((el) => el.id));
  const selectedGroupIdSet = new Set(selectedGroupIds);

  // 그룹 안 삽입 인디케이터는 멤버 행과 같은 인덴트로 그룹 밖 삽입과 구분
  const itemIndicatorIndentClass = dnd.dragOverTargetGroupId
    ? 'left-[28px]'
    : 'left-0';
  const isItemSelected = (item: LayerItem) => selectedElementIdSet.has(item.id);
  const isGroupHeaderSelected = (groupId: string) =>
    selectedGroupIdSet.has(groupId);

  const applySelectionIntent = (intent: LayerSelectionIntent) => {
    switch (intent.type) {
      case 'set-full':
        setFullSelection(intent.elements, intent.groupIds);
        return;
      case 'set-elements':
        setSelectedElements(intent.elements);
        return;
      case 'replace':
        clearSelection();
        toggleSelection(intent.element);
        return;
      case 'delay-single':
        pendingDeselectTimerRef.current = (hostWindow ?? window).setTimeout(
          () => {
            setFullSelection([intent.element], []);
            pendingDeselectTimerRef.current = null;
          },
          50,
        );
        return;
      case 'delay-clear':
        pendingDeselectTimerRef.current = (hostWindow ?? window).setTimeout(
          () => {
            clearSelection();
            pendingDeselectTimerRef.current = null;
          },
          50,
        );
        return;
      case 'none':
        return;
    }
  };

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

    // macOS ctrl+클릭은 우클릭 제스처 — contextmenu 뒤에 따라오는 click 무시
    if (isMac() && e.ctrlKey) return;

    const isPrimaryModifierPressed = isMac() ? e.metaKey : e.ctrlKey;
    const isShiftPressed = e.shiftKey;
    const resolution = resolveLayerItemSelectionIntent({
      item,
      index,
      primary: isPrimaryModifierPressed,
      shift: isShiftPressed,
      lastClickedIndex,
      lastClickedDisplayIndex,
      layerItems: layerItemsRef.current,
      displayItems: displayItemsRef.current,
      selectedElements,
      selectedGroupIds,
    });

    applySelectionIntent(resolution.intent);
    if (resolution.anchor) {
      setLastClickedIndex(resolution.anchor.index);
      setLastClickedDisplayIndex(resolution.anchor.displayIndex);
    }
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

    // macOS ctrl+클릭은 우클릭 제스처 — contextmenu 뒤에 따라오는 click 무시
    if (isMac() && e.ctrlKey) return;

    const isPrimaryModifierPressed = isMac() ? e.metaKey : e.ctrlKey;
    const isShiftPressed = e.shiftKey;
    const resolution = resolveLayerGroupSelectionIntent({
      groupId,
      primary: isPrimaryModifierPressed,
      shift: isShiftPressed,
      lastClickedDisplayIndex,
      layerItems,
      rangeLayerItems: layerItemsRef.current,
      displayItems: displayItemsRef.current,
      selectedElements,
      selectedGroupIds,
    });

    applySelectionIntent(resolution.intent);
    if (resolution.anchor) {
      setLastClickedDisplayIndex(resolution.anchor.displayIndex);
      setLastClickedIndex(resolution.anchor.index);
    }
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
                // 그룹 진입 존 - 행 전체를 hover 토큰으로 하이라이트
                const isDropInto =
                  dnd.draggedItemId != null &&
                  dnd.dragOverIntoGroupId === gh.groupId;

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
                      select-none dmn-row-grabbable
                      ${gh.allHidden && !isBeingDragged ? 'opacity-60' : ''}
                      ${isBeingDragged ? 'opacity-30' : ''}
                      ${
                        isDropInto
                          ? 'bg-fill-hover text-fg-muted'
                          : isSelected
                          ? 'bg-accent-muted text-fg'
                          : dnd.isDragging
                          ? 'text-fg-muted'
                          : 'hover:bg-fill text-fg-muted'
                      }
                    `}
                  >
                    {/* 아이템 드래그 드롭 인디케이터 */}
                    {dnd.draggedItemId &&
                      dnd.dragOverItemDisplayIndex === displayIndex && (
                        <div
                          className={`absolute ${itemIndicatorIndentClass} right-0 top-0 h-[2px] bg-accent z-10`}
                        />
                      )}
                    {/* 그룹 드래그 드롭 인디케이터 */}
                    {dnd.draggedGroupId &&
                      dnd.dragOverDisplayIndex === displayIndex &&
                      dnd.draggedGroupId !== gh.groupId && (
                        <div className="absolute left-0 right-0 top-0 h-[2px] bg-accent z-10" />
                      )}
                    <LayerGroupDisclosure
                      collapsed={gh.isCollapsed}
                      onToggle={() => toggleCollapsed(gh.groupId)}
                    />

                    {/* 그룹 이름 */}
                    {isRenamingGroup ? (
                      <LayerRenameInput
                        inputRef={actions.renameInputRef}
                        value={actions.renameValue}
                        cancelledRef={actions.renameCancelledRef}
                        onChange={actions.setRenameValue}
                        onCommit={(value) =>
                          actions.handleGroupRenameCommit(gh.groupId, value)
                        }
                        onCancel={() => actions.setRenamingItemId(null)}
                      />
                    ) : (
                      <span className="flex-1 text-body truncate font-medium">
                        {gh.groupName}
                      </span>
                    )}

                    {/* 그룹 표시/숨김 토글 */}
                    <LayerGroupVisibilityButton
                      groupId={gh.groupId}
                      allHidden={gh.allHidden}
                      onToggle={actions.handleToggleGroupVisibility}
                    />
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
                    select-none dmn-row-grabbable
                    ${item.hidden && !isInDraggedGroup ? 'opacity-60' : ''}
                    ${isInDraggedGroup ? 'opacity-30' : ''}
                    ${
                      isItemSelected(item)
                        ? 'bg-accent-muted text-fg'
                        : dnd.isDragging
                        ? 'text-fg-muted'
                        : 'hover:bg-fill text-fg-muted'
                    }
                  `}
                >
                  {/* 드롭 인디케이터 */}
                  {dnd.draggedItemId &&
                    dnd.dragOverItemDisplayIndex === displayIndex && (
                      <div
                        className={`absolute ${itemIndicatorIndentClass} right-0 top-0 h-[2px] bg-accent z-10`}
                      />
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
                    <LayerRenameInput
                      inputRef={actions.renameInputRef}
                      value={actions.renameValue}
                      cancelledRef={actions.renameCancelledRef}
                      onChange={actions.setRenameValue}
                      onCommit={(value) =>
                        actions.handleLayerRenameCommit(item, value)
                      }
                      onCancel={() => actions.setRenamingItemId(null)}
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
                    className={`flex-shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-md cursor-pointer ${
                      item.hidden
                        ? ''
                        : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                    }`}
                  >
                    <IconSwap
                      active={item.hidden}
                      activeIcon={
                        <CloseEyeIcon
                          width={14}
                          height={14}
                          fill="currentColor"
                        />
                      }
                      inactiveIcon={
                        <OpenEyeIcon
                          width={14}
                          height={14}
                          fill="currentColor"
                        />
                      }
                    />
                  </button>
                </div>
              );
            })}

            {/* 마지막 아이템 뒤 드롭 인디케이터 */}
            {dnd.draggedItemId &&
              dnd.dragOverItemDisplayIndex === displayItems.length && (
                <div
                  className={`absolute ${itemIndicatorIndentClass} right-0 bottom-0 h-[2px] bg-accent z-10`}
                />
              )}
            {dnd.draggedGroupId &&
              dnd.dragOverDisplayIndex === displayItems.length && (
                <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-accent z-10" />
              )}
          </div>
        )}
      </div>

      {/* 컨텍스트 메뉴 */}
      {contextMenuPresence.mounted &&
        createPortal(
          <ListPopup
            open={actions.contextMenuOpen}
            ariaLabel={t('common.more')}
            position={contextMenuShown.position}
            onClose={() => {
              actions.setContextMenuOpen(false);
              actions.setContextMenuGroupId(null);
            }}
            items={contextMenuShown.items}
            onSelect={actions.handleContextMenuSelect}
          />,
          document.body,
        )}
    </div>
  );
};

export default LayerTabContent;
