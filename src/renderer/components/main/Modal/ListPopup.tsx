import React, {
  useContext,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import FloatingPopup from './FloatingPopup';
import { FloatingPopupMotionContext } from './floatingPopupMotion';
import { isTopmostPopupLayer, registerPopupLayer } from './popupLayer';
import { usePanelHost } from '@contexts/PanelHostContext';
import { clampToViewport, POPUP_EDGE_PADDING } from '@utils/ui/popupGeometry';
import { useViewportSize } from '@hooks/ui/useViewportSize';
import { getListScrollMetrics } from './listScrollMetrics';
import { useLenis } from '@hooks/useLenis';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import { CANVAS_POPUP_CHROME_CLASS } from './popupChrome';

export type ListItem = {
  id: string;
  label: string;
  disabled?: boolean;
  /** 토글 항목의 체크 상태 */
  checked?: boolean;
  /** 서브메뉴 항목 */
  children?: ListItem[];
};

interface ListPopupProps {
  open: boolean;
  ariaLabel: string;
  referenceRef?: React.RefObject<HTMLElement>;
  position?: { x: number; y: number };
  onClose: () => void;
  items: ListItem[];
  onSelect?: (id: string) => void;
  className?: string;
  offsetX?: number;
  offsetY?: number;
  contentMountStrategy?: CommitStrategy;
  /** 앵커 기준 배치 방향 (referenceRef를 쓸 때만 의미) */
  placement?: string;
  /** 트리거 폭 정렬용 최소 폭 */
  minWidth?: number;
  /** 앵커와의 간격 */
  offset?: number;
  /** 스크롤·contain 조상 안에서 열릴 때 필요 */
  portalToBody?: boolean;
}

const DOCUMENT_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getAdjacentFocusTarget = (
  origin: HTMLElement | null,
  reverse: boolean,
) => {
  const modalScope = origin?.closest<HTMLElement>(
    '[data-dmn-modal-backdrop="true"]',
  );
  const focusScope: ParentNode =
    modalScope ?? origin?.ownerDocument ?? document;
  const focusable = Array.from(
    focusScope.querySelectorAll<HTMLElement>(DOCUMENT_FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.closest(
        '[hidden], [aria-hidden="true"], [data-dmn-popup-layer="true"]',
      ) && element.getAttribute('aria-disabled') !== 'true',
  );
  const originIndex = origin ? focusable.indexOf(origin) : -1;
  if (originIndex < 0) {
    return reverse ? focusable[focusable.length - 1] : focusable[0];
  }
  const adjacent = focusable[originIndex + (reverse ? -1 : 1)];
  if (adjacent || !modalScope) return adjacent ?? origin;
  return reverse ? focusable[focusable.length - 1] : focusable[0];
};

const getMenuItems = (menu: HTMLElement) =>
  Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      '[role^="menuitem"]:not(:disabled)',
    ),
  );

const handleMenuNavigation = (event: React.KeyboardEvent<HTMLElement>) => {
  if (event.defaultPrevented) return;
  const items = getMenuItems(event.currentTarget);
  if (items.length === 0) return;

  const activeIndex = items.indexOf(
    event.currentTarget.ownerDocument.activeElement as HTMLButtonElement,
  );
  let nextIndex: number | null = null;
  if (event.key === 'ArrowDown') {
    nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
  } else if (event.key === 'ArrowUp') {
    nextIndex =
      activeIndex < 0
        ? items.length - 1
        : (activeIndex - 1 + items.length) % items.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  }

  if (nextIndex == null) return;
  event.preventDefault();
  items[nextIndex].focus();
};

/** 서브메뉴 컴포넌트 (호버 시 표시) */
const SubMenu = ({
  ariaLabel,
  items,
  onSelect,
  onCloseAll,
  onMenuTab,
  anchorRect,
  parentItemRef,
  focusFirst,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}: {
  ariaLabel: string;
  items: ListItem[];
  onSelect?: (id: string) => void;
  onCloseAll: () => void;
  onMenuTab: (event: KeyboardEvent) => void;
  anchorRect: DOMRect | null;
  parentItemRef: React.RefObject<HTMLButtonElement | null>;
  focusFirst: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onRequestClose: () => void;
}) => {
  const { window: ownerWindow, document: ownerDocument } = usePanelHost();
  const subMenuRef = useRef<HTMLDivElement>(null);
  const parentMotionState = useContext(FloatingPopupMotionContext);
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

  // 부모가 닫히는 동안 서브메뉴는 렌더를 멈추므로 등록도 함께 풀어야 한다.
  // parentMotionState를 의존성에서 빼면 해제 없이 스택에 남아 Escape 순서가 뒤집힌다
  useLayoutEffect(() => {
    const element = subMenuRef.current;
    if (!element || parentMotionState === 'closing') return;
    return registerPopupLayer(element);
  }, [anchorRect, parentMotionState]);

  // 최상위 서브메뉴만 키보드 종료를 소유
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isTopmostPopupLayer(subMenuRef.current))
        return;
      if (e.key === 'Tab') {
        onMenuTab(e);
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      flushSync(onRequestClose);
      parentItemRef.current?.focus();
    };
    ownerDocument.addEventListener('keydown', onKey);
    return () => ownerDocument.removeEventListener('keydown', onKey);
  }, [onMenuTab, onRequestClose, parentItemRef, ownerDocument]);

  useLayoutEffect(() => {
    const el = subMenuRef.current;
    if (!anchorRect || !el) return;

    const padding = POPUP_EDGE_PADDING;
    const { offsetWidth: width, offsetHeight: height } = el;
    const normalLeft = anchorRect.right + 2;
    const flippedLeft = anchorRect.left - 2 - width;

    // 오른쪽이 좁을 때만 뒤집되, 왼쪽에도 자리가 있어야 의미가 있다
    const flipToLeft =
      normalLeft + width > ownerWindow.innerWidth - padding &&
      flippedLeft >= padding;

    const top = clampToViewport(
      anchorRect.top,
      height,
      ownerWindow.innerHeight,
    );
    // 양쪽 다 좁으면 오른쪽 경계에 맞춰 안쪽으로 당긴다
    const left = clampToViewport(normalLeft, width, ownerWindow.innerWidth);

    // 측정→배치 패턴: 페인트 전 위치 확정이 목적이라 동기 setState가 의도임
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos(
      flipToLeft
        ? { right: ownerWindow.innerWidth - anchorRect.left + 2, top }
        : { left, top },
    );
  }, [anchorRect, items.length, ownerWindow]);

  useLayoutEffect(() => {
    if (!focusFirst || !pos) return;
    const firstItem = subMenuRef.current
      ? getMenuItems(subMenuRef.current)[0]
      : null;
    firstItem?.focus();
  }, [focusFirst, pos]);

  const { height: viewportHeight } = useViewportSize();
  const { needsScroll, maxHeight } = getListScrollMetrics(
    items.length,
    viewportHeight,
  );
  const hasCheckColumn = items.some((it) => typeof it.checked === 'boolean');

  const { scrollContainerRef: subLenisRef } = useLenis({
    wheelMultiplier: 0.7,
  });

  // 부모가 닫히기 시작하면 서브메뉴는 잔상 없이 즉시 걷는다. 남겨두면 body 포털이라
  // 부모 페이드와 무관하게 선명히 떠 있고 Escape 소유권도 계속 물고 있다
  if (!anchorRect || parentMotionState === 'closing') return null;

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
      data-dmn-popup-layer="true"
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          flushSync(onRequestClose);
          parentItemRef.current?.focus();
          return;
        }
        handleMenuNavigation(event);
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`fixed z-[60] ${CANVAS_POPUP_CHROME_CLASS} rounded-surface p-[4px] flex flex-col gap-[4px] tooltip-fade-in${
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
          onMenuTab={onMenuTab}
          siblingActiveRef={siblingActiveRef}
          hasCheckColumn={hasCheckColumn}
        />
      ))}
    </div>,
    ownerDocument.body,
  );
};

/** 개별 메뉴 항목 행 */
const MenuItemRow = ({
  item,
  onSelect,
  onCloseAll,
  onMenuTab,
  siblingActiveRef,
  hasCheckColumn = false,
}: {
  item: ListItem;
  onSelect?: (id: string) => void;
  onCloseAll: () => void;
  onMenuTab: (event: KeyboardEvent) => void;
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
  const [focusSubMenuOnOpen, setFocusSubMenuOnOpen] = useState(false);

  const hasChildren = item.children && item.children.length > 0;

  const showSubMenu = (focusFirst: boolean) => {
    if (!hasChildren || !rowRef.current) return;
    setRowRect(rowRef.current.getBoundingClientRect());
    setFocusSubMenuOnOpen(focusFirst);
    setSubMenuOpen(true);
    if (siblingActiveRef) {
      siblingActiveRef.current = {
        id: item.id,
        close: () => setSubMenuOpen(false),
      };
    }
  };

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

    hoverTimerRef.current = setTimeout(() => showSubMenu(false), delay);
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

  const hasCheck = typeof item.checked === 'boolean';

  const handleSelect = () => {
    if (item.disabled) return;
    if (hasChildren) {
      showSubMenu(false);
      return;
    }
    onSelect?.(item.id);
    onCloseAll();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!hasChildren || !['ArrowRight', 'Enter', ' '].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showSubMenu(true);
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
        role={hasCheck ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={hasCheck ? item.checked : undefined}
        aria-disabled={item.disabled || undefined}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        aria-expanded={hasChildren ? subMenuOpen : undefined}
        tabIndex={-1}
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
        className={`w-full min-w-[96px] h-[26px] px-[8px] rounded-md flex items-center gap-[6px] transition-colors duration-fast ${
          item.disabled
            ? 'opacity-70'
            : 'hover:bg-fill active:bg-fill-active cursor-pointer'
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
            className="flex-shrink-0 text-fg-faint"
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
          ariaLabel={item.label}
          items={item.children!}
          onSelect={onSelect}
          onCloseAll={onCloseAll}
          onMenuTab={onMenuTab}
          anchorRect={rowRect}
          parentItemRef={rowRef}
          focusFirst={focusSubMenuOnOpen}
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
  ariaLabel,
  referenceRef,
  position,
  onClose,
  items,
  onSelect,
  className = '',
  offsetX = 0,
  offsetY = 0,
  contentMountStrategy = 'after-paint',
  placement = 'top',
  minWidth,
  offset = 25,
  portalToBody = false,
}: ListPopupProps) => {
  const openerRef = useRef<HTMLElement | null>(null);

  const handleMenuTab = (event: KeyboardEvent) => {
    event.preventDefault();
    const origin = referenceRef?.current ?? openerRef.current;
    const target = getAdjacentFocusTarget(origin, event.shiftKey);
    flushSync(onClose);
    if (target?.isConnected) {
      target.focus();
    } else if (origin?.isConnected) {
      origin.focus();
    }
  };

  // 일시적 팝업은 상주 크롬(z-30, 패널·미니맵)보다 항상 위
  // z는 호출부가 덮을 수 있어야 한다. 기본값을 클래스로 박으면 두 클래스가
  // 같은 특이도로 충돌해 CSS 생성 순서에 따라 결과가 달라진다
  const defaultClassName = `dmn-motion ${CANVAS_POPUP_CHROME_CLASS} rounded-surface p-[4px] flex flex-col gap-[4px]`;
  const zClassName = /(^|\s)z-/.test(className) ? '' : 'z-40';
  const effectiveClassName =
    `${defaultClassName} ${zClassName} ${className}`.trim();

  const { height: viewportHeight } = useViewportSize();
  const { needsScroll, maxHeight } = getListScrollMetrics(
    items.length,
    viewportHeight,
  );
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
      role="menu"
      ariaLabel={ariaLabel}
      onMenuTab={handleMenuTab}
      focusOriginRef={openerRef}
      referenceRef={referenceRef}
      placement={placement}
      minWidth={minWidth}
      portalToBody={portalToBody}
      offset={offset}
      offsetX={offsetX}
      offsetY={offsetY}
      fixedX={position?.x}
      fixedY={position?.y}
      onClose={onClose}
      onKeyDown={handleMenuNavigation}
      className={effectiveClassName}
      contentMountStrategy={contentMountStrategy}
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
            onMenuTab={handleMenuTab}
            siblingActiveRef={siblingActiveRef}
            hasCheckColumn={hasCheckColumn}
          />
        ))}
      </div>
    </FloatingPopup>
  );
};

export default ListPopup;
