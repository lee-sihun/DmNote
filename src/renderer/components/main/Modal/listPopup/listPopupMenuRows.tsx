/* eslint-disable react-refresh/only-export-components */
import React, {
  useContext,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { FloatingPopupMotionContext } from '../floatingPopup/floatingPopupMotion';
import { isTopmostPopupLayer, registerPopupLayer } from '../popupLayer';
import { usePanelHost } from '@contexts/PanelHostContext';
import { clampToViewport, POPUP_EDGE_PADDING } from '@utils/ui/popupGeometry';
import { useViewportSize } from '@hooks/ui/useViewportSize';
import { getListScrollMetrics } from './listScrollMetrics';
import { useLenis } from '@hooks/useLenis';
import { CANVAS_POPUP_CHROME_CLASS } from '../popupChrome';

export type ListMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  isPlugin?: boolean;
  /** 토글 항목의 체크 상태 */
  checked?: boolean;
  /** 서브메뉴 항목 */
  children?: ListItem[];
};

/** 성격이 다른 묶음을 가르는 선. 포커스도 키보드 순회도 받지 않는다.
 *  항목 전용 필드를 undefined로 열어둬 목록을 훑는 쪽이 매번 좁히지 않아도 되게 한다 */
export type ListSeparator = {
  id: string;
  separator: true;
  label?: undefined;
  disabled?: undefined;
  isPlugin?: undefined;
  checked?: undefined;
  children?: undefined;
};

export type ListItem = ListMenuItem | ListSeparator;

export const isSeparator = (item: ListItem): item is ListSeparator =>
  'separator' in item;
const DOCUMENT_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// 표면 패딩 5px = 행 갭 4px + inset 링 1px 보정 (링이 패딩 최외곽 1px 위에 그려짐)
const POPUP_CHROME_INSET = 5;
const SUBMENU_SURFACE_GAP = 5;
const SUBMENU_ANCHOR_GAP = POPUP_CHROME_INSET + SUBMENU_SURFACE_GAP;

export const getAdjacentFocusTarget = (
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

export const handleMenuNavigation = (
  event: React.KeyboardEvent<HTMLElement>,
) => {
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
  instant,
  registerSurface,
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
  /** 형제 서브메뉴에서 곧바로 넘어온 열림 - 진입 모션을 재생하지 않는다 */
  instant: boolean;
  /** 부모 행이 위치를 읽어 커서 의도를 판정한다 */
  registerSurface?: (node: HTMLDivElement | null) => void;
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
  const siblingActiveRef = useRef<SiblingActive>(emptySiblingActive());
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
    const normalLeft = anchorRect.right + SUBMENU_ANCHOR_GAP;
    const flippedLeft = anchorRect.left - SUBMENU_ANCHOR_GAP - width;

    // 오른쪽이 좁을 때만 뒤집되, 왼쪽에도 자리가 있어야 의미가 있다
    const flipToLeft =
      normalLeft + width > ownerWindow.innerWidth - padding &&
      flippedLeft >= padding;

    const top = clampToViewport(
      anchorRect.top - POPUP_CHROME_INSET,
      height,
      ownerWindow.innerHeight,
    );
    // 양쪽 다 좁으면 오른쪽 경계에 맞춰 안쪽으로 당긴다
    const left = clampToViewport(normalLeft, width, ownerWindow.innerWidth);

    // 측정→배치 패턴: 페인트 전 위치 확정이 목적이라 동기 setState가 의도임
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos(
      flipToLeft
        ? {
            right:
              ownerWindow.innerWidth - anchorRect.left + SUBMENU_ANCHOR_GAP,
            top,
          }
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
    items.filter(isSeparator).length,
  );
  const hasCheckColumn = items.some(
    (it) => !isSeparator(it) && typeof it.checked === 'boolean',
  );

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
        registerSurface?.(node);
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
      className={`fixed z-[var(--z-chrome-submenu)] ${CANVAS_POPUP_CHROME_CLASS} rounded-surface p-[5px] flex flex-col${
        instant ? '' : ' tooltip-fade-in'
      }`}
      style={{
        left: pos?.left,
        right: pos?.right,
        top: pos?.top ?? 0,
        visibility: pos ? undefined : 'hidden',
        ...(maxHeight ? { maxHeight } : {}),
      }}
    >
      {/* 스크롤러를 크롬 박스 안쪽으로 한 겹 내린다 - 마스크가 표면과 그림자까지
          갉아먹지 않게. role=none으로 menu와 menuitem의 관계는 그대로 통과시킨다 */}
      <div
        ref={needsScroll ? subLenisRef : undefined}
        role="none"
        onMouseMove={(event) => trackPointer(siblingActiveRef, event)}
        className={`flex flex-col gap-[4px]${
          needsScroll ? ' listpopup-scroll dmn-scroll-fade' : ''
        }`}
        style={
          maxHeight ? { overflowY: 'auto', overflowX: 'hidden' } : undefined
        }
      >
        {items.map((it) =>
          isSeparator(it) ? (
            <SeparatorRow key={it.id} />
          ) : (
            <MenuItemRow
              key={it.id}
              item={it}
              onSelect={onSelect}
              onCloseAll={onCloseAll}
              onMenuTab={onMenuTab}
              siblingActiveRef={siblingActiveRef}
              hasCheckColumn={hasCheckColumn}
            />
          ),
        )}
      </div>
    </div>,
    ownerDocument.body,
  );
};

// 부모 항목에서 서브메뉴로 갈 때 커서는 대각선을 그리며 중간 형제 항목을 스친다.
// 닫고 다시 여는 대신, 서브메뉴로 향하는 동안에는 형제 전환을 아예 막는다 -
// 닫힘 이벤트가 없으면 표면이 사라질 일도 없다
export interface SiblingActive {
  id: string | null;
  close: (() => void) | null;
  /** 열려 있는 서브메뉴 표면의 현재 사각형 */
  getRect: (() => DOMRect | null) | null;
  /** 예약된 닫힘을 인계 시점 뒤로 미룬다 */
  holdOpen: (() => void) | null;
  /** 직전과 현재 커서 위치 - 진행 방향 판정용 */
  from: { x: number; y: number } | null;
  to: { x: number; y: number } | null;
}

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 200;
// 길목에 머물 때 형제가 넘겨받기까지. 이 값이 곧 서브메뉴까지 갈 수 있는 예산이라
// 짧게 잡으면 느린 대각선 이동을 형제가 가로챈다
const INTENT_GRACE_MS = 300;
// 길목으로 판정되면 기존 표면의 닫힘을 인계 뒤로 미룬다. 인계가 먼저 끝나야
// 닫기와 열기가 한 번의 갱신으로 묶여 표면이 끊기지 않는다
const INTENT_HOLD_MS = INTENT_GRACE_MS + 100;
const INTENT_PADDING_PX = 12;

export const emptySiblingActive = (): SiblingActive => ({
  id: null,
  close: null,
  getRect: null,
  holdOpen: null,
  from: null,
  to: null,
});

/** 이 행이 쥐고 있던 활성 표시를 놓는다. 커서 자취는 팝업 세션 것이라 남긴다 */
const releaseSibling = (
  ref: React.RefObject<SiblingActive> | undefined,
  id: string,
) => {
  if (ref?.current.id !== id) return;
  ref.current = {
    ...ref.current,
    id: null,
    close: null,
    getRect: null,
    holdOpen: null,
  };
};

/** 표면 위 커서 자취를 공유 ref에 남긴다 - 형제 전환 판정의 입력 */
export const trackPointer = (
  ref: React.RefObject<SiblingActive>,
  event: React.MouseEvent,
) => {
  const next = { x: event.clientX, y: event.clientY };
  const previous = ref.current.to;
  if (previous && previous.x === next.x && previous.y === next.y) return;
  ref.current.from = previous;
  ref.current.to = next;
};

/** 커서 진행 방향의 반직선이 서브메뉴 사각형을 지나는가 (slab 판정) */
const isHeadingTo = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: DOMRect,
): boolean => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return false;

  const left = rect.left - INTENT_PADDING_PX;
  const right = rect.right + INTENT_PADDING_PX;
  const top = rect.top - INTENT_PADDING_PX;
  const bottom = rect.bottom + INTENT_PADDING_PX;

  let near = 0;
  let far = Number.POSITIVE_INFINITY;

  const slab = (origin: number, delta: number, min: number, max: number) => {
    if (delta === 0) return origin >= min && origin <= max;
    const t1 = (min - origin) / delta;
    const t2 = (max - origin) / delta;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    return true;
  };

  if (!slab(to.x, dx, left, right)) return false;
  if (!slab(to.y, dy, top, bottom)) return false;
  return near <= far;
};

/** 묶음 사이 선. 표면 가장자리(4px)에서 한 번 더 물러나 라벨 시작점보다 살짝 왼쪽에서
 *  시작한다 - 행 하이라이트를 그대로 따라가면 가장자리까지 닿아 크롬처럼 보인다.
 *  위아래 여백은 컨테이너 gap이 맡는다 */
export const SeparatorRow = () => (
  <div
    role="separator"
    aria-orientation="horizontal"
    className="mx-[4px] h-px bg-line"
  />
);

/** 개별 메뉴 항목 행 */
export const MenuItemRow = ({
  item,
  onSelect,
  onCloseAll,
  onMenuTab,
  siblingActiveRef,
  hasCheckColumn = false,
}: {
  item: ListMenuItem;
  onSelect?: (id: string) => void;
  onCloseAll: () => void;
  onMenuTab: (event: KeyboardEvent) => void;
  /** 형제 항목 중 활성 서브메뉴와 커서 자취를 공유하는 ref */
  siblingActiveRef?: React.RefObject<SiblingActive>;
  /** 목록에 체크 가능한 항목이 있을 때만 좌측 체크 컬럼 렌더 */
  hasCheckColumn?: boolean;
}) => {
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  // 형제에서 넘어온 열림인지 - 진입 모션 재생 여부를 가른다
  const [instantOpen, setInstantOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  // 유예 시간이 끝났을 때 아직 이 행 위에 있는지
  const hoveredRef = useRef(false);
  const subSurfaceRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rowRect, setRowRect] = useState<DOMRect | null>(null);
  const [focusSubMenuOnOpen, setFocusSubMenuOnOpen] = useState(false);

  const hasChildren = item.children && item.children.length > 0;

  const scheduleClose = (delay: number) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setSubMenuOpen(false);
      releaseSibling(siblingActiveRef, item.id);
    }, delay);
  };

  const showSubMenu = (focusFirst: boolean, instant = false) => {
    // 호버는 button이 아니라 감싼 div가 받으므로 disabled가 막아주지 않는다
    if (item.disabled || !hasChildren || !rowRef.current) return;
    setRowRect(rowRef.current.getBoundingClientRect());
    setFocusSubMenuOnOpen(focusFirst);
    setInstantOpen(instant);
    setSubMenuOpen(true);
    if (siblingActiveRef) {
      siblingActiveRef.current = {
        ...siblingActiveRef.current,
        id: item.id,
        close: () => setSubMenuOpen(false),
        getRect: () => subSurfaceRef.current?.getBoundingClientRect() ?? null,
        holdOpen: () => scheduleClose(INTENT_HOLD_MS),
      };
    }
  };

  const handleMouseEnter = (event: React.MouseEvent) => {
    hoveredRef.current = true;
    if (!hasChildren) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // 행에 막 들어온 좌표가 가장 새로운 자취다. 이걸 빼면 직전 행 안에서 찍힌
    // 두 점으로 방향을 재게 되어 실제로 가로지른 방향과 어긋난다
    if (siblingActiveRef) trackPointer(siblingActiveRef, event);
    const active = siblingActiveRef?.current;
    const hasActiveSibling = active?.id != null;
    const delay = hasActiveSibling ? 0 : HOVER_OPEN_MS;

    // 서브메뉴로 가는 길목이면 형제 전환을 미룬다. 커서가 그 자리에 머무르면
    // 유예 시간 뒤에 이 행이 넘겨받는다
    if (hasActiveSibling && active?.id !== item.id) {
      const rect = active?.getRect?.();
      const from = active?.from;
      const to = active?.to;
      if (rect && from && to && isHeadingTo(from, to, rect)) {
        // 형제 행을 지나는 동안 기존 표면이 닫히면 의도 판정이 무의미해진다
        active?.holdOpen?.();
        hoverTimerRef.current = setTimeout(() => {
          if (!hoveredRef.current) return;
          // 형제 표면이 아직 떠 있을 때만 모션을 건너뛴다. 이미 닫혔다면
          // 이어받는 게 아니라 새로 여는 것이라 페이드가 있어야 한다
          const handover = siblingActiveRef?.current.id != null;
          siblingActiveRef?.current.close?.();
          showSubMenu(false, handover);
        }, INTENT_GRACE_MS);
        return;
      }
      active?.close?.();
    }

    // 형제가 열려 있었다면 표면이 방금까지 떠 있었다 - 페이드를 다시 재생하면
    // 유리 표면이 사라졌다 돌아오는 것처럼 보인다
    hoverTimerRef.current = setTimeout(
      () => showSubMenu(false, hasActiveSibling),
      delay,
    );
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    scheduleClose(HOVER_CLOSE_MS);
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      // 열린 서브메뉴를 쥔 행이 사라지면 공유 ref에 분리된 노드의 getRect가 남아
      // 다음 호버의 형제 전환 판정이 0 사각형으로 오판한다
      releaseSibling(siblingActiveRef, item.id);
    };
  }, [item.id, siblingActiveRef]);

  // 부모 메뉴를 스크롤하면 앵커 행이 움직이는데 서브메뉴는 열 때 잰 좌표에 고정된다.
  // 프레임마다 재측정하면 글래스 표면에서 강제 레이아웃+재필터라, 스크롤 시 닫는다
  // (FloatingPopup closeOnScroll과 같은 관용구). 서브메뉴 자체 스크롤은 행을 포함하지
  // 않으므로 무시된다
  useEffect(() => {
    if (!subMenuOpen) return;
    const row = rowRef.current;
    const doc = row?.ownerDocument;
    if (!row || !doc) return;
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || !target.contains(row)) return;
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setSubMenuOpen(false);
      releaseSibling(siblingActiveRef, item.id);
    };
    doc.addEventListener('scroll', onScroll, true);
    return () => doc.removeEventListener('scroll', onScroll, true);
  }, [subMenuOpen, item.id, siblingActiveRef]);

  const hasCheck = typeof item.checked === 'boolean';
  const constrainLabel = item.isPlugin === true;

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
          constrainLabel ? 'max-w-[172px] overflow-hidden ' : ''
        }${
          item.disabled
            ? 'opacity-70'
            : 'hover:bg-fill active:bg-fill-active cursor-pointer'
        }`}
      >
        {/* 라벨 텍스트 */}
        <span
          className={`min-w-0 flex-1 text-body text-left ${
            constrainLabel ? 'truncate' : 'whitespace-nowrap'
          } ${item.disabled ? 'text-fg-disabled' : 'text-fg'}`}
        >
          {item.label}
        </span>

        {/* 우측 체크 영역 - 체크 가능한 목록에서만 렌더, 폭은 항상 확보해 행 너비 고정 */}
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
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        )}

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
              strokeWidth="1.2"
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
          instant={instantOpen}
          registerSurface={(node) => {
            subSurfaceRef.current = node;
          }}
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
            releaseSibling(siblingActiveRef, item.id);
          }}
        />
      )}
    </div>
  );
};
