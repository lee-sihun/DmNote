import React, { useState, useRef, useEffect } from 'react';
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
  /** 텍스트 정렬 방향 */
  textAlign?: 'left' | 'center';
  /** 최대 표시 항목 수 (초과 시 스크롤) */
  maxVisibleItems?: number;
}

/** 서브메뉴 컴포넌트 (호버 시 표시) */
const SubMenu = ({
  items,
  onSelect,
  onCloseAll,
  textAlign = 'left',
  maxVisibleItems,
  anchorRect,
}: {
  items: ListItem[];
  onSelect?: (id: string) => void;
  onCloseAll?: () => void;
  textAlign?: 'left' | 'center';
  maxVisibleItems?: number;
  anchorRect: DOMRect | null;
}) => {
  const subMenuRef = useRef<HTMLDivElement>(null);
  const siblingActiveRef = useRef<{
    id: string | null;
    close: (() => void) | null;
  }>({ id: null, close: null });
  const pos = (() => {
    if (!anchorRect) return null;

    const padding = 5;
    const normalLeft = anchorRect.right + 2;
    let top = anchorRect.top;

    // 서브메뉴의 대략적인 높이 추정
    const separatorCount = items.filter((i) => i.type === 'separator').length;
    const itemCount = items.length - separatorCount;
    const estimatedHeight = itemCount * 24 + separatorCount * 9 + 10;
    const estimatedWidth = 160;

    // 오른쪽 경계 체크 → 공간 부족 시 왼쪽에 표시 (right 기준 정렬)
    const flipToLeft =
      normalLeft + estimatedWidth > window.innerWidth - padding;

    // 아래쪽 경계 체크
    if (top + estimatedHeight > window.innerHeight - padding) {
      top = window.innerHeight - estimatedHeight - padding;
    }
    if (top < padding) top = padding;

    if (flipToLeft) {
      return { right: window.innerWidth - anchorRect.left + 2, top } as {
        left?: number;
        right?: number;
        top: number;
      };
    }
    return { left: normalLeft, top } as {
      left?: number;
      right?: number;
      top: number;
    };
  })();

  const itemHeight = 24;
  const separatorCount = items.filter((i) => i.type === 'separator').length;
  const normalItemCount = items.length - separatorCount;
  const effectiveMax = maxVisibleItems ?? normalItemCount;
  const needsScroll = normalItemCount > effectiveMax;
  const maxHeight = needsScroll
    ? effectiveMax * itemHeight + separatorCount * 9 + 10
    : undefined;

  const { scrollContainerRef: subLenisRef } = useLenis({
    duration: 0.5,
    wheelMultiplier: 0.7,
  });

  if (!pos) return null;

  return (
    <div
      ref={(node) => {
        (subMenuRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
        if (needsScroll) subLenisRef(node);
      }}
      className={`fixed z-[10001] bg-elevated border border-line shadow-elevation-2 rounded-lg p-[5px] flex flex-col gap-[1px] tooltip-fade-in${
        needsScroll ? ' listpopup-scroll' : ''
      }`}
      style={{
        left: pos.left,
        right: pos.right,
        top: pos.top,
        ...(maxHeight
          ? { maxHeight, overflowY: 'auto', overflowX: 'hidden' }
          : {}),
      }}
    >
      {items.map((it) => (
        <MenuItemRow
          key={it.id}
          item={it}
          textAlign={textAlign}
          onSelect={onSelect}
          onCloseAll={onCloseAll}
          siblingActiveRef={siblingActiveRef}
        />
      ))}
    </div>
  );
};

/** 개별 메뉴 항목 행 */
const MenuItemRow = ({
  item,
  textAlign,
  onSelect,
  onCloseAll,
  siblingActiveRef,
}: {
  item: ListItem;
  textAlign: 'left' | 'center';
  onSelect?: (id: string) => void;
  onCloseAll?: () => void;
  /** 형제 항목 중 활성 서브메뉴를 추적하는 ref (즉시 전환용) */
  siblingActiveRef?: React.RefObject<{
    id: string | null;
    close: (() => void) | null;
  }>;
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

  // 구분선 (부모 p-[5px] 패딩을 무시하고 전체 폭 사용)
  if (item.type === 'separator') {
    return (
      <div className="-mx-[5px] py-[3px]">
        <div className="h-[1px] bg-line" />
      </div>
    );
  }

  const isLeft = textAlign === 'left';
  const hasCheck = typeof item.checked === 'boolean';
  const isBasicCenterItem = !isLeft && !hasCheck && !hasChildren;

  const handleSelect = () => {
    if (item.disabled || hasChildren) return;
    onSelect?.(item.id);
    onCloseAll?.();
  };

  if (isBasicCenterItem) {
    return (
      <button
        type="button"
        disabled={item.disabled}
        onClick={handleSelect}
        className={`w-full min-w-[108px] h-[24px] px-[24px] rounded-[6px] flex items-center justify-center transition-colors duration-fast ${
          item.disabled
            ? 'opacity-70'
            : 'hover:bg-surface-hover active:bg-surface-active cursor-pointer'
        }`}
      >
        <span
          className={`text-body whitespace-nowrap ${
            item.disabled ? 'text-fg-disabled' : 'text-fg'
          }`}
        >
          {item.label}
        </span>
      </button>
    );
  }

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
        className={`w-full min-w-[120px] h-[24px] px-[6px] rounded-[6px] flex items-center gap-[4px] transition-colors duration-fast ${
          item.disabled
            ? 'opacity-70'
            : 'hover:bg-surface-hover active:bg-surface-active cursor-pointer'
        }`}
      >
        {/* 좌측 체크 영역 (고정 너비) */}
        <span className="w-[16px] flex-shrink-0 flex items-center justify-center">
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

        {/* 라벨 텍스트 */}
        <span
          className={`flex-1 text-body whitespace-nowrap ${
            isLeft ? 'text-left' : 'text-center'
          } ${item.disabled ? 'text-fg-disabled' : 'text-fg'}`}
        >
          {item.label}
        </span>

        {/* 우측 서브메뉴 화살표 영역 (고정 너비) */}
        <span className="w-[16px] flex-shrink-0 flex items-center justify-center">
          {hasChildren && (
            <svg
              width="7"
              height="12"
              viewBox="0 0 7 12"
              fill="none"
              className="text-fg-muted"
            >
              <path
                d="M1 1L5.5 6L1 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </button>

      {/* 서브메뉴 */}
      {hasChildren && subMenuOpen && (
        <SubMenu
          items={item.children!}
          onSelect={onSelect}
          onCloseAll={onCloseAll}
          textAlign={textAlign}
          maxVisibleItems={item.maxVisibleChildren}
          anchorRect={rowRect}
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
  textAlign = 'center',
  maxVisibleItems,
}: ListPopupProps) => {
  const defaultClassName =
    'z-30 bg-elevated border border-line shadow-elevation-2 rounded-lg p-[5px] flex flex-col gap-[1px]';
  const effectiveClassName = `${defaultClassName} ${className}`.trim();

  // 스크롤 필요 여부 계산
  const itemHeight = 24;
  const separatorCount = items.filter((i) => i.type === 'separator').length;
  const normalItemCount = items.length - separatorCount;
  const needsScroll =
    maxVisibleItems != null && normalItemCount > maxVisibleItems;
  const maxHeight = needsScroll
    ? maxVisibleItems * itemHeight + separatorCount * 9 + 10
    : undefined;

  const siblingActiveRef = useRef<{
    id: string | null;
    close: (() => void) | null;
  }>({ id: null, close: null });

  const { scrollContainerRef: lenisRef } = useLenis({
    duration: 0.5,
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
        className={`flex flex-col gap-[1px]${
          needsScroll ? ' listpopup-scroll' : ''
        }`}
      >
        {items.map((it) => (
          <MenuItemRow
            key={it.id}
            item={it}
            textAlign={textAlign}
            onSelect={onSelect}
            onCloseAll={onClose}
            siblingActiveRef={siblingActiveRef}
          />
        ))}
      </div>
    </FloatingPopup>
  );
};

export default ListPopup;
