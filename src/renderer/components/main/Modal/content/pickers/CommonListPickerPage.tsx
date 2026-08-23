import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { useLenis } from '@hooks/useLenis';
import Dropdown from '@components/main/common/Dropdown';
import SearchField from '@components/main/common/SearchField';
import ListAddRow from '@components/main/common/ListAddRow';

type FilterOption = {
  value: string;
  label: string;
};

// 행 기본 규격 - pickerRowClass의 30px 행 + gap-[4px]
const DEFAULT_ROW_H = 30;
const ROW_GAP = 4;
// 절단 지점 - 행 높이의 2/3, 글자 중간을 지나 미완결로 읽히는 위치
const CUT_RATIO = 2 / 3;
// 리듬 보정 허용 폭 - 이 밖이면 기본 규격 유지
const ROW_H_TOLERANCE = 3;

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
  // 추가 행에 앵커된 메뉴의 기준점용
  addButtonRef?: React.RefObject<HTMLButtonElement>;
  // 추가 행 위치 - 자주 쌓이는 리스트는 start로 항상 손에 닿게
  addRowPlacement?: 'start' | 'end';
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
  addRowPlacement = 'end',
  pageTitle,
  onBack,
}: CommonListPickerPageProps<T>) {
  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();
  const viewportRef = useRef<HTMLElement | null>(null);

  // Lenis 콜백 ref와 로컬 ref를 한 노드에 함께 연결
  const setViewportEl = useCallback(
    (node: HTMLElement | null) => {
      viewportRef.current = node;
      scrollRef(node);
    },
    [scrollRef],
  );

  // 행 리듬 보정 - 표면·간격·뷰포트는 그대로 두고 행 높이만 미세 조절해서
  // 오버플로 시 마지막 가시 행이 항상 글자 중간에서 잘리게 함.
  // 행 경계가 뷰포트 바닥과 겹치면 다음 행이 통째로 숨어 스크롤 단서가 사라짐
  useLayoutEffect(() => {
    if (!open) return;
    const scrollEl = viewportRef.current;
    if (!scrollEl) return;

    const apply = () => {
      // 기본 규격으로 되돌린 뒤 측정해야 오버플로 판정이 흔들리지 않음
      scrollEl.style.removeProperty('--dmn-picker-row-h');
      const viewport = scrollEl.clientHeight;
      const overflowing = scrollEl.scrollHeight > viewport + 1;
      if (overflowing) {
        const pitch = DEFAULT_ROW_H + ROW_GAP;
        const fullRows = Math.round(
          (viewport - DEFAULT_ROW_H * CUT_RATIO) / pitch,
        );
        if (fullRows >= 1) {
          const rowH = (viewport - ROW_GAP * fullRows) / (fullRows + CUT_RATIO);
          if (Math.abs(rowH - DEFAULT_ROW_H) <= ROW_H_TOLERANCE) {
            scrollEl.style.setProperty(
              '--dmn-picker-row-h',
              `${rowH.toFixed(2)}px`,
            );
          }
        }
      }
      lenisInstance.current?.resize?.();
    };

    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [
    open,
    items.length,
    filterValue,
    searchQuery,
    isLoading,
    errorText,
    lenisInstance,
  ]);

  if (!open) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 — 뒤로가기: 타이틀 캡하이트급 셰브론 + 타이틀 통짜 버튼 */}
      {/* 48px 고정 — 패널 루트 헤더(PANEL_HEADER_CLASS)와 높이 동기, 전환 시 타이틀 세로 고정 */}
      <div className="h-[48px] px-[12px] flex items-center shrink-0">
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
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-fg group-hover:text-white text-label leading-none truncate transition-colors duration-fast">
            {pageTitle}
          </span>
        </button>
      </div>
      {/* 검색 — 리스트와 인접한 프라이머리 컨트롤 */}
      <div className="px-[12px] pb-[12px] shrink-0">
        <SearchField
          value={searchQuery}
          onChange={onSearchQueryChange}
          placeholder={searchPlaceholder}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onBack();
          }}
        />
      </div>
      {/* 리스트 컨테이너 — 배경보다 한 단계 밝은 필 테이블. 빈 공간도 테이블의 빈 영역으로 읽힘 */}
      <div className="mx-[12px] bg-inset rounded-surface p-[4px] flex-1 min-h-0 flex flex-col">
        <div
          ref={setViewportEl}
          className="flex-1 min-h-0 flex flex-col overflow-y-auto modal-content-scroll dmn-scroll-fade dmn-scroll-fade-shallow"
        >
          {/* flex-1로 스크롤 영역을 채워 빈 상태가 중앙에 오게 함 */}
          <div className="flex flex-col gap-[4px] flex-1">
            {/* 추가 행 - 리스트와 같이 스크롤, 위치는 placement가 결정 */}
            {addRowPlacement === 'start' && (
              <ListAddRow
                label={addLabel}
                onClick={onAdd}
                buttonRef={addButtonRef}
              />
            )}
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
              <p className="py-[14px] text-danger-fg text-body text-center">
                {errorText}
              </p>
            ) : null}
            {addRowPlacement === 'end' && (
              <ListAddRow
                label={addLabel}
                onClick={onAdd}
                buttonRef={addButtonRef}
              />
            )}
          </div>
        </div>
      </div>
      {/* 하단 필터 바 */}
      <div className="p-[12px] shrink-0">
        {filterOptions && filterValue !== undefined && onFilterChange ? (
          <Dropdown
            commitStrategy="after-paint"
            options={filterOptions}
            value={filterValue}
            onChange={onFilterChange}
            fullWidth
            size="lg"
          />
        ) : null}
      </div>
    </div>
  );
}
