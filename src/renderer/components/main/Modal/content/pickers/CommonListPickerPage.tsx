import React, { useEffect } from 'react';
import { useLenis } from '@hooks/useLenis';
import Dropdown from '@components/main/common/Dropdown';

type FilterOption = {
  value: string;
  label: string;
};

interface CommonListPickerPageProps<T> {
  open: boolean;
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
  onAdd: (event: React.MouseEvent<HTMLButtonElement>) => void;
  addLabel: string;
  // 추가 버튼에 앵커된 메뉴의 기준점용
  addButtonRef?: React.RefObject<HTMLButtonElement>;
  pageTitle: string;
  onBack: () => void;
}

export default function CommonListPickerPage<T>({
  open,
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
  onAdd,
  addLabel,
  addButtonRef,
  pageTitle,
  onBack,
}: CommonListPickerPageProps<T>) {
  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  useEffect(() => {
    if (!open) return;
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [open, items.length, filterValue, searchQuery, lenisInstance]);

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
      {/* 검색 — 리스트와 인접한 프라이머리 컨트롤 */}
      <div className="px-[12px] pb-[12px] shrink-0">
        <div className="relative">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="absolute left-[10px] top-1/2 -translate-y-1/2 text-fg-faint pointer-events-none"
          >
            <circle
              cx="5"
              cy="5"
              r="3.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M8 8L10.5 10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full h-[30px] pl-[30px] pr-[10px] bg-inset rounded-surface text-fg text-body placeholder-fg-faint focus:shadow-focus-ring outline-none transition-shadow duration-fast"
          />
        </div>
      </div>
      {/* 리스트 웰 — 리세스드 테이블. 빈 공간도 테이블의 빈 영역으로 읽힘 */}
      <div className="mx-[12px] bg-inset rounded-surface p-[4px] flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 flex flex-col overflow-y-auto modal-content-scroll dmn-scroll-fade"
        >
          {/* flex-1로 스크롤 영역을 채워 빈 상태가 중앙에 오게 함 */}
          <div className="flex flex-col gap-[4px] flex-1">
            {items.length === 0 && !isLoading && !errorText ? (
              <div className="flex-1 flex items-center justify-center py-[14px] text-fg-faint text-body">
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
        </div>
      </div>
      {/* 하단 도구 바 — 필터 + 추가 (Xcode 내비게이터 문법) */}
      <div className="p-[12px] shrink-0">
        <div className="flex items-center gap-[8px]">
          {filterOptions && filterValue !== undefined && onFilterChange ? (
            <div className="flex-1 min-w-0">
              <Dropdown
                options={filterOptions}
                value={filterValue}
                onChange={onFilterChange}
                fullWidth
                size="lg"
              />
            </div>
          ) : null}
          <button
            ref={addButtonRef}
            type="button"
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
            className="ml-auto w-[30px] h-[30px] rounded-surface shrink-0 flex items-center justify-center bg-fill hover:bg-fill-hover active:bg-fill-active text-fg-muted hover:text-fg transition-colors duration-fast"
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
      </div>
    </div>
  );
}
