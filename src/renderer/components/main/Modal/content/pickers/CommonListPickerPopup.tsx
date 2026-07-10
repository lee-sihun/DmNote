/* eslint-disable react-hooks/set-state-in-effect */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
  // 'page': 사이드 패널 서브 페이지로 렌더 (플로팅 크롬 대신 뒤로가기 헤더)
  renderMode?: 'popup' | 'page';
  pageTitle?: string;
  onBack?: () => void;
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
  listHeightClass = 'h-[120px]',
  onAdd,
  addLabel,
  addButtonRef,
  renderMode = 'popup',
  pageTitle,
  onBack,
}: CommonListPickerPopupProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fixedPosition, setFixedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  const calculatePosition = useCallback(() => {
    if (!panelElement) return;

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
  }, [estimatedHeight, estimatedWidth, panelElement]);

  useLayoutEffect(() => {
    if (!open) {
      setFixedPosition(null);
      return;
    }

    if (!panelElement) {
      setFixedPosition(null);
      return;
    }

    calculatePosition();
  }, [calculatePosition, open, panelElement]);

  // 팝업의 실제 크기가 바뀌면 위치 재계산
  useLayoutEffect(() => {
    if (!open || !panelElement || !containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      calculatePosition();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [calculatePosition, open, panelElement]);

  useEffect(() => {
    if (!open) return;
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [open, items.length, filterValue, searchQuery, lenisInstance]);

  const effectiveOffsetY = fixedPosition ? 0 : -93;

  const searchInput = (
    <input
      type="text"
      value={searchQuery}
      onChange={(event) => onSearchQueryChange(event.target.value)}
      placeholder={searchPlaceholder}
      className="w-full h-[26px] px-[8px] bg-inset rounded-md text-fg text-body placeholder-fg-faint focus:shadow-focus-ring outline-none transition-shadow duration-fast"
    />
  );

  // 필터 + 추가 — 같은 재질의 칩 한 쌍
  const filterAddRow = (
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
  );

  const listInner = (
    <div className="flex flex-col gap-[4px]">
      {items.length === 0 && !isLoading && !errorText ? (
        <div className="flex items-center justify-center py-[14px] text-fg-faint text-body">
          {emptyText}
        </div>
      ) : null}
      {items.map((item) => renderItem(item))}
      {isLoading ? (
        <p className="py-[14px] text-fg-muted text-body text-center">
          {loadingText}
        </p>
      ) : null}
      {errorText ? (
        <p className="py-[14px] text-danger text-body text-center">
          {errorText}
        </p>
      ) : null}
    </div>
  );

  // 페이지 모드 — 패널 서브 페이지: 뒤로가기 헤더 + 전고 리스트
  if (renderMode === 'page') {
    if (!open) return null;
    return (
      <div className="flex flex-col h-full min-h-0">
        {/* 헤더 — 뒤로가기: 타이틀 캡하이트급 셰브론 + 타이틀 통짜 버튼 */}
        <div className="p-[12px]">
          <button
            type="button"
            onClick={onBack}
            className="group flex items-center gap-[6px] min-w-0"
          >
            <svg
              width="7"
              height="12"
              viewBox="0 0 7 12"
              fill="none"
              className="shrink-0 text-fg-muted group-hover:text-fg transition-colors duration-fast"
            >
              <path
                d="M5.5 1.5L1.5 6L5.5 10.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-fg group-hover:text-white text-style-2 leading-none truncate transition-colors duration-fast">
              {pageTitle}
            </span>
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-[8px] px-[12px] pb-[12px]">
          {searchInput}
          <div className="shrink-0">{filterAddRow}</div>
          {/* 리스트 카드 — 전고 고정, 공간 부족 시 내부 스크롤 */}
          <div className="bg-fill-faint rounded-[10px] p-[4px] flex-1 min-h-0 flex flex-col">
            <div
              ref={scrollRef}
              className="min-h-0 flex flex-col overflow-y-auto modal-content-scroll dmn-scroll-fade"
            >
              {listInner}
            </div>
          </div>
        </div>
      </div>
    );
  }

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
      portalToBody={Boolean(panelElement)}
      animate={!panelElement}
    >
      <div
        ref={containerRef}
        className={`flex flex-col p-[8px] gap-[8px] ${widthClass} bg-glass-heavy backdrop-blur-[32px] rounded-[14px] shadow-elevation-3`.trim()}
        style={{
          visibility: panelElement && !fixedPosition ? 'hidden' : undefined,
        }}
      >
        {searchInput}
        {filterAddRow}
        {/* 리스트 웰 — 면으로 영역 구분 */}
        <div className="bg-inset rounded-md p-[4px] flex flex-col gap-[4px]">
          <div
            ref={scrollRef}
            className={`flex flex-col overflow-y-auto modal-content-scroll dmn-scroll-fade ${listHeightClass}`}
          >
            {listInner}
          </div>
        </div>
      </div>
    </FloatingPopup>
  );
}
