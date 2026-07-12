import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import FloatingPopup from './FloatingPopup';
import { useLenis } from '@hooks/useLenis';

export type ListItem = {
  id: string;
  label: string;
  disabled?: boolean;
  /** 구분선 항목 */
  type?: 'item' | 'separator';
  /** 토글 항목의 체크 상태 */
  checked?: boolean;
  /** 서브메뉴 항목 */
  children?: ListItem[];
  /** 서브메뉴 최대 표시 항목 수 (초과 시 스크롤) */
  maxVisibleChildren?: number;
};

interface ListPopupProps {
  open: boolean;
  referenceRef?: React.RefObject<HTMLElement>;
  position?: { x: number; y: number };
  onClose?: () => void;
  items: ListItem[];
  onSelect?: (id: string) => void;
  className?: string;
  offsetX?: number;
  offsetY?: number;
  /** 최대 표시 항목 수 (초과 시 스크롤) */
  maxVisibleItems?: number;
}

/** 서브메뉴 컴포넌트 (호버 시 표시) */
const SubMenu = ({
  items,
  onSelect,
  onCloseAll,
  maxVisibleItems,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}: {
  items: ListItem[];
  onSelect?: (id: string) => void;
  onCloseAll?: () => void;
  maxVisibleItems?: number;
  anchorRect: DOMRect | null;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onRequestClose?: () => void;
}) => {
  const subMenuRef = useRef<HTMLDivElement>(null);
  const siblingActiveRef = useRef<{
    id: string | null;
    close: (() => void) | null;
  }>({ id: null, close: null });
  // 실측 기반 배치 — 히든 렌더 후 페인트 전에 측정·확정 (추정치 없음)
  const [pos, setPos] = useState<{
    left?: number;
    right?: number;
    top: number;
  } | null>(null);

  // Escape 소유 — 열린 동안 최상위 레이어이므로 소비 후 자신만 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onRequestClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onRequestClose]);

  useLayoutEffect(() => {
    const el = subMenuRef.current;
    if (!anchorRect || !el) return;

    const padding = 5;
    const { offsetWidth: width, offsetHeight: height } = el;
    const normalLeft = anchorRect.right + 2;
    let top = anchorRect.top;

    // 오른쪽 경계 체크 → 공간 부족 시 왼쪽에 표시 (right 기준 정렬)
    const flipToLeft = normalLeft + width > window.innerWidth - padding;

    // 아래쪽 경계 체크
    if (top + height > window.innerHeight - padding) {
      top = window.innerHeight - height - padding;
    }
    if (top < padding) top = padding;

    // 측정→배치 패턴: 페인트 전 위치 확정이 목적이라 동기 setState가 의도임
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos(
      flipToLeft
        ? { right: window.innerWidth - anchorRect.left + 2, top }
        : { left: normalLeft, top },
    );
  }, [anchorRect, items.length]);

  const itemHeight = 26;
  const itemGap = 4;
  const separatorCount = items.filter((i) => i.type === 'separator').length;
  const normalItemCount = items.length - separatorCount;
  const effectiveMax = maxVisibleItems ?? normalItemCount;
  const needsScroll = normalItemCount > effectiveMax;
  const maxHeight = needsScroll
    ? effectiveMax * (itemHeight + itemGap) + separatorCount * (1 + itemGap) + 6
    : undefined;
  const hasCheckColumn = items.some((it) => typeof it.checked === 'boolean');

  const { scrollContainerRef: subLenisRef } = useLenis({
    wheelMultiplier: 0.7,
  });

  if (!anchorRect) return null;

  // body 포털 필수 — 부모 팝업의 backdrop-filter가 fixed의 containing block이 되어
  // 뷰포트 좌표가 어긋나는 것 방지. 호버 유지는 onMouseEnter/Leave 콜백으로 연결
  return createPortal(
    <div
      ref={(node) => {
        (subMenuRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
        if (needsScroll) subLenisRef(node);
      }}
      data-dmn-popup-submenu="true"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`fixed z-[60] bg-glass backdrop-glass-popup shadow-elevation-2 rounded-surface p-[4px] flex flex-col gap-[4px] tooltip-fade-in${
        needsScroll ? ' listpopup-scroll' : ''
      }`}
      style={{
        left: pos?.left,
        right: pos?.right,
        top: pos?.top ?? 0,
        visibility: pos ? undefined : 'hidden',
        ...(maxHeight
          ? { maxHeight, overflowY: 'auto', overflowX: 'hidden' }
          : {}),
      }}
    >
      {items.map((it) => (
        <MenuItemRow
          key={it.id}
          item={it}
          onSelect={onSelect}
          onCloseAll={onCloseAll}
          siblingActiveRef={siblingActiveRef}
          hasCheckColumn={hasCheckColumn}
        />
      ))}
    </div>,
    document.body,
  );
};

/** 개별 메뉴 항목 행 */
const MenuItemRow = ({
  item,
  onSelect,
  onCloseAll,
  siblingActiveRef,
  hasCheckColumn = false,
}: {
  item: ListItem;
  onSelect?: (id: string) => void;
  onCloseAll?: () => void;
  /** 형제 항목 중 활성 서브메뉴를 추적하는 ref (즉시 전환용) */
  siblingActiveRef?: React.RefObject<{
    id: string | null;
    close: (() => void) | null;
  }>;
  /** 목록에 체크 가능한 항목이 있을 때만 좌측 체크 컬럼 렌더 */
  hasCheckColumn?: boolean;
}) => {
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rowRect, setRowRect] = useState<DOMRect | null>(null);

  const hasChildren = item.children && item.children.length > 0;

  const handleMouseEnter = () => {
    if (!hasChildren) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const active = siblingActiveRef?.current;
    const hasActiveSibling = active?.id != null;
    const delay = hasActiveSibling ? 0 : 150;

    // 다른 형제의 서브메뉴가 열려있으면 즉시 닫기
    if (hasActiveSibling && active?.id !== item.id && active?.close) {
      active.close();
    }

    hoverTimerRef.current = setTimeout(() => {
      if (rowRef.current) {
        setRowRect(rowRef.current.getBoundingClientRect());
      }
      setSubMenuOpen(true);
      if (siblingActiveRef) {
        siblingActiveRef.current = {
          id: item.id,
          close: () => setSubMenuOpen(false),
        };
      }
    }, delay);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setSubMenuOpen(false);
      if (siblingActiveRef?.current.id === item.id) {
        siblingActiveRef.current = { id: null, close: null };
      }
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // 구분선 (부모 p-[4px] 패딩을 무시하고 전체 폭 사용)
  if (item.type === 'separator') {
    return (
      <div className="-mx-[4px]">
        <div className="h-[1px] bg-line" />
      </div>
    );
  }

  const hasCheck = typeof item.checked === 'boolean';

  const handleSelect = () => {
    if (item.disabled || hasChildren) return;
    onSelect?.(item.id);
    onCloseAll?.();
  };

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={rowRef}
        type="button"
        disabled={item.disabled}
        onClick={handleSelect}
        className={`w-full min-w-[96px] h-[26px] px-[8px] rounded-md flex items-center gap-[6px] transition-colors duration-fast ${
          item.disabled
            ? 'opacity-70'
            : 'hover:bg-surface-hover active:bg-surface-active cursor-pointer'
        }`}
      >
        {/* 좌측 체크 영역 — 체크 가능한 목록에서만 렌더 */}
        {hasCheckColumn && (
          <span className="w-[14px] flex-shrink-0 flex items-center justify-center">
            {hasCheck && item.checked && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className="text-fg"
              >
                <path
                  d="M2 6.5L4.5 9L10 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        )}

        {/* 라벨 텍스트 */}
        <span
          className={`flex-1 text-body whitespace-nowrap text-left ${
            item.disabled ? 'text-fg-disabled' : 'text-fg'
          }`}
        >
          {item.label}
        </span>

        {/* 우측 서브메뉴 화살표 — 라벨보다 작은 보조 글리프, 크롬 아이콘 톤, 패딩에 직접 정렬 */}
        {hasChildren && (
          <svg
            width="5"
            height="10"
            viewBox="0 0 5 10"
            fill="none"
            className="flex-shrink-0 text-white/45"
          >
            <path
              d="M1 1.5L4 5L1 8.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* 서브메뉴 */}
      {hasChildren && subMenuOpen && (
        <SubMenu
          items={item.children!}
          onSelect={onSelect}
          onCloseAll={onCloseAll}
          maxVisibleItems={item.maxVisibleChildren}
          anchorRect={rowRect}
          onMouseEnter={() => {
            // 포털로 DOM 중첩이 끊기므로 서브메뉴 진입 시 닫힘 타이머 취소
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          }}
          onMouseLeave={handleMouseLeave}
          onRequestClose={() => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            setSubMenuOpen(false);
            if (siblingActiveRef?.current.id === item.id) {
              siblingActiveRef.current = { id: null, close: null };
            }
          }}
        />
      )}
    </div>
  );
};

const ListPopup = ({
  open,
  referenceRef,
  position,
  onClose,
  items,
  onSelect,
  className = '',
  offsetX = 0,
  offsetY = 0,
  maxVisibleItems,
}: ListPopupProps) => {
  // 일시적 팝업은 상주 크롬(z-30, 패널·미니맵)보다 항상 위
  const defaultClassName =
    'z-40 bg-glass backdrop-glass-popup shadow-elevation-2 rounded-surface p-[4px] flex flex-col gap-[4px]';
  const effectiveClassName = `${defaultClassName} ${className}`.trim();

  // 스크롤 필요 여부 계산 (아이템 26 + 갭 4 리듬)
  const itemHeight = 26;
  const itemGap = 4;
  const separatorCount = items.filter((i) => i.type === 'separator').length;
  const normalItemCount = items.length - separatorCount;
  const needsScroll =
    maxVisibleItems != null && normalItemCount > maxVisibleItems;
  const maxHeight = needsScroll
    ? maxVisibleItems * (itemHeight + itemGap) +
      separatorCount * (1 + itemGap) +
      6
    : undefined;
  const hasCheckColumn = items.some((it) => typeof it.checked === 'boolean');

  const siblingActiveRef = useRef<{
    id: string | null;
    close: (() => void) | null;
  }>({ id: null, close: null });

  const { scrollContainerRef: lenisRef } = useLenis({
    wheelMultiplier: 0.7,
  });

  return (
    <FloatingPopup
      open={open}
      referenceRef={referenceRef}
      placement="top"
      offset={25}
      offsetX={offsetX}
      offsetY={offsetY}
      fixedX={position?.x}
      fixedY={position?.y}
      onClose={onClose}
      className={effectiveClassName}
    >
      <div
        ref={needsScroll ? lenisRef : undefined}
        style={
          maxHeight
            ? { maxHeight, overflowY: 'auto', overflowX: 'hidden' }
            : undefined
        }
        className={`flex flex-col gap-[4px]${
          needsScroll ? ' listpopup-scroll' : ''
        }`}
      >
        {items.map((it) => (
          <MenuItemRow
            key={it.id}
            item={it}
            onSelect={onSelect}
            onCloseAll={onClose}
            siblingActiveRef={siblingActiveRef}
            hasCheckColumn={hasCheckColumn}
          />
        ))}
      </div>
    </FloatingPopup>
  );
};

export default ListPopup;
