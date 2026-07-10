/* eslint-disable react-hooks/set-state-in-effect */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import FloatingPopup from '../../FloatingPopup';
import { useLenis } from '@hooks/useLenis';
import Dropdown from '@components/main/common/Dropdown';

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
  emptyText: string;
  isLoading?: boolean;
  loadingText?: string;
  errorText?: string;
  listHeightClass?: string;
  onAdd: (event: React.MouseEvent<HTMLButtonElement>) => void;
  addLabel: string;
  // 추가 버튼에 앵커된 메뉴가 열릴 때 외부 클릭 판정 제외용
  addButtonRef?: React.RefObject<HTMLButtonElement>;
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
  emptyText,
  isLoading = false,
  loadingText = '로딩...',
  errorText = '',
  listHeightClass = 'max-h-[120px]',
  onAdd,
  addLabel,
  addButtonRef,
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

  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  useEffect(() => {
    if (!open) {
      setFixedPosition(null);
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
        className={`flex flex-col p-[8px] gap-[8px] ${widthClass} bg-glass-heavy backdrop-blur-[32px] rounded-[14px] shadow-elevation-3`.trim()}
        style={{
          visibility: panelElement && !fixedPosition ? 'hidden' : undefined,
        }}
      >
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-full h-[26px] px-[8px] bg-inset rounded-md text-fg text-body placeholder-fg-faint focus:shadow-focus-ring outline-none transition-shadow duration-fast"
        />

        {/* 필터 + 추가 — 같은 재질의 칩 한 쌍 */}
        <div className="flex items-center gap-[4px]">
          {filterOptions && filterValue !== undefined && onFilterChange ? (
            <div className="flex-1 min-w-0">
              <Dropdown
                options={filterOptions}
                value={filterValue}
                onChange={onFilterChange}
                fullWidth
              />
            </div>
          ) : null}
          <button
            ref={addButtonRef}
            type="button"
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
            className="ml-auto w-[24px] h-[24px] shrink-0 flex items-center justify-center rounded-md bg-fill hover:bg-fill-hover active:bg-fill-active text-fg-muted hover:text-fg transition-colors duration-fast"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path
                d="M4 1V7M1 4H7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* 리스트 웰 — 면으로 영역 구분 */}
        <div className="bg-inset rounded-md p-[4px] flex flex-col gap-[4px]">
          <div
            ref={scrollRef}
            className={`flex flex-col overflow-y-auto modal-content-scroll dmn-scroll-fade ${listHeightClass}`}
          >
            <div className="flex flex-col gap-[4px]">
              {items.length === 0 ? (
                <div className="flex items-center justify-center py-[14px] text-fg-faint text-body">
                  {emptyText}
                </div>
              ) : (
                items.map((item) => renderItem(item))
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <p className="text-fg-muted text-body text-center">{loadingText}</p>
        ) : null}

        {errorText ? (
          <p className="text-danger text-body text-center">{errorText}</p>
        ) : null}
      </div>
    </FloatingPopup>
  );
}
