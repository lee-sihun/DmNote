/* eslint-disable react-hooks/set-state-in-effect */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import FloatingPopup from '../../FloatingPopup';
import { useLenis } from '@hooks/useLenis';
import Dropdown from '@components/main/common/Dropdown';

const SCROLL_CONTENT_GUTTER = 4;

type FilterOption = {
  value: string;
  label: string;
};

interface CommonListPickerPopupProps<T> {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  onClose: () => void;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  widthClass?: string;
  estimatedWidth?: number;
  estimatedHeight?: number;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchPlaceholder: string;
  filterOptions?: FilterOption[];
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  renderItemActions?: (item: T) => React.ReactNode;
  itemRowClassName?: string;
  getItemKey?: (item: T, index: number) => React.Key;
  emptyText: string;
  isLoading?: boolean;
  loadingText?: string;
  errorText?: string;
  listHeightClass?: string;
  onAdd: () => void;
  addButtonContent: React.ReactNode;
}

export default function CommonListPickerPopup<T>({
  open,
  referenceRef,
  panelElement = null,
  onClose,
  interactiveRefs = [],
  widthClass = 'w-[156px]',
  estimatedWidth = 164,
  estimatedHeight = 280,
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder,
  filterOptions,
  filterValue,
  onFilterChange,
  items,
  renderItem,
  renderItemActions,
  itemRowClassName = '',
  getItemKey,
  emptyText,
  isLoading = false,
  loadingText = '로딩...',
  errorText = '',
  listHeightClass = 'min-h-[120px] h-[120px]',
  onAdd,
  addButtonContent,
}: CommonListPickerPopupProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    setContainerEl(node);
  }, []);
  const [fixedPosition, setFixedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  const {
    scrollContainerRef: scrollRef,
    wrapperElement,
    lenisInstance,
    scrollbarWidth,
  } = useLenis();

  useEffect(() => {
    if (!open) {
      setFixedPosition(null);
      setHasOverflow(false);
      return;
    }

    if (!panelElement) {
      setFixedPosition(null);
      return;
    }

    const calculatePosition = () => {
      const panelRect = panelElement.getBoundingClientRect();
      const popupEl = containerRef.current;
      const popupWidth = popupEl ? popupEl.offsetWidth : estimatedWidth;
      const popupHeight = popupEl ? popupEl.offsetHeight : estimatedHeight;

      const gap = 5;
      const padding = 5;
      const panelBottomPadding = 20;

      let fixedX = panelRect.left - popupWidth - gap;
      if (fixedX < padding) {
        fixedX = padding;
      }

      let fixedY = panelRect.bottom - panelBottomPadding - popupHeight;
      if (fixedY < padding) {
        fixedY = padding;
      }

      setFixedPosition((prev) => {
        if (prev && prev.x === fixedX && prev.y === fixedY) return prev;
        return { x: fixedX, y: fixedY };
      });
    };

    const rafId = requestAnimationFrame(calculatePosition);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [estimatedHeight, estimatedWidth, open, panelElement]);

  // 팝업 크기가 변하면(로딩 텍스트 등) 위치 재계산
  // containerEl을 deps로 사용하여 portal 전환 후에도 ResizeObserver가 올바른 DOM에 연결됨
  useEffect(() => {
    if (!open || !panelElement || !containerEl) return;

    const calculatePosition = () => {
      const panelRect = panelElement.getBoundingClientRect();
      const popupWidth = containerEl.offsetWidth || estimatedWidth;
      const popupHeight = containerEl.offsetHeight || estimatedHeight;

      const gap = 5;
      const padding = 5;
      const panelBottomPadding = 20;

      let fixedX = panelRect.left - popupWidth - gap;
      if (fixedX < padding) {
        fixedX = padding;
      }

      let fixedY = panelRect.bottom - panelBottomPadding - popupHeight;
      if (fixedY < padding) {
        fixedY = padding;
      }

      setFixedPosition((prev) => {
        if (prev && prev.x === fixedX && prev.y === fixedY) return prev;
        return { x: fixedX, y: fixedY };
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      calculatePosition();
    });
    resizeObserver.observe(containerEl);

    return () => {
      resizeObserver.disconnect();
    };
  }, [open, panelElement, containerEl, estimatedHeight, estimatedWidth]);

  useEffect(() => {
    if (!open) return;
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [open, items.length, filterValue, searchQuery, lenisInstance]);

  useEffect(() => {
    if (!open) {
      setHasOverflow(false);
      return;
    }

    const wrapper = wrapperElement;
    if (!wrapper) return;

    const updateOverflow = () => {
      const nextHasOverflow = wrapper.scrollHeight > wrapper.clientHeight;
      setHasOverflow((prev) =>
        prev === nextHasOverflow ? prev : nextHasOverflow,
      );
    };

    const rafId = requestAnimationFrame(updateOverflow);
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(wrapper);

    const contentEl = wrapper.firstElementChild;
    if (contentEl instanceof HTMLElement) {
      resizeObserver.observe(contentEl);
    }

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [open, wrapperElement, items.length]);

  const scrollbarCompensation = useMemo(
    () => (hasOverflow ? scrollbarWidth + SCROLL_CONTENT_GUTTER : 0),
    [hasOverflow, scrollbarWidth],
  );

  const effectiveOffsetY = fixedPosition ? 0 : -93;

  return (
    <FloatingPopup
      open={open}
      referenceRef={referenceRef}
      fixedX={fixedPosition?.x}
      fixedY={fixedPosition?.y}
      placement="right-start"
      offset={32}
      offsetY={effectiveOffsetY}
      className="z-50"
      interactiveRefs={interactiveRefs}
      onClose={onClose}
      autoClose={false}
    >
      <div
        ref={containerCallbackRef}
        className={`flex flex-col p-[8px] gap-[8px] ${widthClass} bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30]`.trim()}
      >
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-full h-[23px] px-[8px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] text-[#DBDEE8] text-style-2 placeholder-[#6F6E7A] focus:border-[#459BF8] outline-none"
        />

        {filterOptions && filterValue !== undefined && onFilterChange ? (
          <Dropdown
            options={filterOptions}
            value={filterValue}
            onChange={onFilterChange}
            fullWidth
          />
        ) : null}

        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        <div
          ref={scrollRef}
          className={`flex flex-col gap-[4px] overflow-y-auto modal-content-scroll ${listHeightClass}`}
          style={{
            width:
              scrollbarCompensation > 0
                ? `calc(100% + ${scrollbarCompensation}px)`
                : undefined,
            marginRight:
              scrollbarCompensation > 0
                ? `-${scrollbarCompensation}px`
                : undefined,
          }}
        >
          <div
            className="flex flex-col gap-[4px]"
            style={
              hasOverflow
                ? { width: `calc(100% - ${SCROLL_CONTENT_GUTTER}px)` }
                : undefined
            }
          >
            {items.length === 0 ? (
              <div className="flex items-center justify-center py-[10px] text-[#6F6E7A] text-style-4">
                {emptyText}
              </div>
            ) : (
              items.map((item, index) => {
                const node = renderItem(item);
                if (!renderItemActions) {
                  return node;
                }

                const key = getItemKey ? getItemKey(item, index) : index;
                return (
                  <div
                    key={key}
                    className={`w-full h-[24px] flex items-center gap-[4px] ${itemRowClassName}`.trim()}
                  >
                    <div className="flex-1 min-w-0">{node}</div>
                    <div className="ml-auto shrink-0 flex items-center justify-end gap-[2px]">
                      {renderItemActions(item)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        <button
          type="button"
          className="w-full h-[23px] flex items-center justify-center rounded-[7px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] transition-colors"
          onClick={onAdd}
        >
          {addButtonContent}
        </button>

        {isLoading ? (
          <p className="text-[#9FA3B2] text-style-4 text-center">
            {loadingText}
          </p>
        ) : null}

        {errorText ? (
          <p className="text-[#E6A7A7] text-style-4 text-center">{errorText}</p>
        ) : null}
      </div>
    </FloatingPopup>
  );
}
