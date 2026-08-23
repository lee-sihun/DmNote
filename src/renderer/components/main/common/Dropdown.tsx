import React, {
  useState,
  useRef,
  useId,
  useCallback,
  useEffect,
  useLayoutEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { usePopupPresence } from '@hooks/ui/usePopupPresence';
import { isTopmostPopupLayer, registerPopupLayer } from '../Modal/popupLayer';
import { useOptimisticValueCommit } from '@hooks/useOptimisticValueCommit';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import { clampToViewport } from '@utils/ui/popupGeometry';
import { usePanelHost } from '@contexts/PanelHostContext';
import { isNodeLike } from '@utils/dom/isElementNode';
import { CANVAS_POPUP_CHROME_CLASS } from '../Modal/popupChrome';

interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  commitStrategy?: CommitStrategy;
  placeholder?: string;
  disabled?: boolean;
  /** true일 경우 드롭다운이 부모 컨테이너의 전체 너비를 차지함 */
  fullWidth?: boolean;
  /** 아이콘 트리거 모드: 설정 시 버튼이 아이콘으로 표시됨 */
  iconTrigger?: React.ReactNode;
  /** 메뉴 수평 정렬 (기본: left) — right는 트리거가 우측 가장자리에 붙은 자리용 */
  align?: 'left' | 'right';
  /** 트리거/메뉴 너비 고정용 Tailwind 클래스 (예: 'w-[160px]'). 길면 말줄임(...) 처리됨 */
  widthClass?: string;
  /** 트리거 크기 — sm: 24px 크롬(기본), lg: 30px 크롬(패널 페이지) */
  size?: 'sm' | 'lg';
}

// 확정 픽셀 좌표 — 전부 레이아웃 속성이라 transform 합성 지연과 무관.
// right/bottom 정렬은 해당 모서리 좌표로 고정해 내용 크기가 변해도 유지
interface MenuPosition {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  // 등퇴장 원점을 실제 펼침 방향에 맞추기 위한 배치 결과
  placement: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
}

const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  onChange,
  commitStrategy = 'sync',
  placeholder = '선택',
  disabled = false,
  fullWidth = false,
  iconTrigger,
  align = 'left',
  widthClass = '',
  size = 'sm',
}) => {
  // 분리 패널 창 안에서는 그 창 기준으로 배치·포털·바깥 클릭 처리
  const { window: ownerWindow, document: ownerDocument } = usePanelHost();
  const [open, setOpen] = useState(false);
  // 트리거 실측 — 열리는 순간 캡처, 메뉴 좌표 계산의 기준
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // null이면 아직 미실측 — 히든 렌더 후 layout effect에서 확정
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const { value: visualValue, select: commitSelection } =
    useOptimisticValueCommit({
      canonicalValue: value,
      onCommit: onChange,
      strategy: commitStrategy,
    });

  // 좌표가 확정되기 전에는 감춘 채 실측하므로, 그 프레임에 등장 모션이
  // 소비되지 않게 ready를 늦춘다
  const { mounted, state: motionState } = usePopupPresence(open, {
    ready: Boolean(menuPos),
    motionRef: menuRef,
  });

  const selectedIndex = options.findIndex(
    (option) => option.value === visualValue,
  );

  const openMenu = useCallback(
    (preferredIndex?: number) => {
      const button = buttonRef.current;
      if (!button || disabled || options.length === 0) return;
      setAnchor(button.getBoundingClientRect());
      // 닫히는 중 재오픈은 이전 좌표를 이어받는다. 같은 트리거라 위치가 같고,
      // null로 되돌리면 감춰진 프레임이 한 번 껴서 튄다.
      // 스크롤·리사이즈는 메뉴를 닫으므로 그사이 앵커가 움직일 일은 없다
      if (!mounted) setMenuPos(null);
      const fallbackIndex = selectedIndex >= 0 ? selectedIndex : 0;
      setActiveIndex(
        Math.min(
          Math.max(preferredIndex ?? fallbackIndex, 0),
          options.length - 1,
        ),
      );
      setOpen(true);
    },
    [disabled, mounted, options.length, selectedIndex],
  );

  // 메뉴는 body로 포털 — 패널/모달의 backdrop-filter·mask 아래에서는
  // 중첩 backdrop-blur가 무력화되므로 backdrop root 밖에서 그린다
  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    openMenu();
  };

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  const selectOption = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      if (commitStrategy === 'sync') {
        commitSelection(option.value);
        closeAndFocusTrigger();
        return;
      }
      closeAndFocusTrigger();
      commitSelection(option.value);
    },
    [closeAndFocusTrigger, commitSelection, commitStrategy, options],
  );

  const moveActiveOption = useCallback(
    (nextIndex: number) => {
      if (options.length === 0) return;
      const normalized = (nextIndex + options.length) % options.length;
      setActiveIndex(normalized);
    },
    [options.length],
  );

  // 실측 기반 확정 배치 — 히든 렌더한 메뉴의 레이아웃 크기(offsetWidth/Height,
  // transform 무관)를 재서 최종 픽셀 좌표를 한 번에 확정하고 표시.
  // 보이는 첫 프레임이 곧 확정 위치라 중간 위치가 비칠 수 없고,
  // translate 같은 합성 단계 이동이 없어 WKWebView 레이어 지연에도 안전
  const place = useCallback(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const margin = 8;
    const gap = 4;
    // 하단 상주 크롬(미니 메뉴 바) 회피 여백
    const bottomPadding = 60;

    // right 정렬은 right 좌표로 고정 — 열린 뒤 내용 폭이 변해도 우측 모서리 유지
    let horizontal: Omit<MenuPosition, 'placement'>;
    let alignment: 'start' | 'end';
    if (!fullWidth && align === 'right') {
      horizontal = {
        right: clampToViewport(
          ownerWindow.innerWidth - anchor.right,
          menuWidth,
          ownerWindow.innerWidth,
          margin,
        ),
      };
      alignment = 'end';
    } else {
      horizontal = {
        left: clampToViewport(
          anchor.left,
          menuWidth,
          ownerWindow.innerWidth,
          margin,
        ),
      };
      alignment = 'start';
    }

    // 버튼 아래 공간이 부족하면 위로 펼치기 — 위로 열릴 땐 bottom 좌표로
    // 고정해 내용 높이가 변해도 위쪽으로 자라게 유지
    const openUpward =
      anchor.bottom + gap + menuHeight >
      ownerWindow.innerHeight - bottomPadding;
    let vertical: Omit<MenuPosition, 'placement'>;
    if (openUpward) {
      vertical = {
        bottom: clampToViewport(
          ownerWindow.innerHeight - anchor.top + gap,
          menuHeight,
          ownerWindow.innerHeight,
          margin,
        ),
      };
    } else {
      vertical = {
        top: clampToViewport(
          anchor.bottom + gap,
          menuHeight,
          ownerWindow.innerHeight,
          margin,
        ),
      };
    }

    const next: MenuPosition = {
      ...horizontal,
      ...vertical,
      placement: `${openUpward ? 'top' : 'bottom'}-${alignment}`,
    };
    setMenuPos((prev) =>
      prev &&
      prev.left === next.left &&
      prev.right === next.right &&
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.placement === next.placement
        ? prev
        : next,
    );
  }, [anchor, fullWidth, align, ownerWindow]);

  useLayoutEffect(() => {
    if (!open || !mounted || menuPos) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    place();
  }, [open, mounted, menuPos, place]);

  // 열린 뒤 옵션이 사라지면 빈 포털을 남기지 않고 트리거로 복귀
  useLayoutEffect(() => {
    if (!open || options.length > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    closeAndFocusTrigger();
  }, [closeAndFocusTrigger, open, options.length]);

  useLayoutEffect(() => {
    if (!open || !menuPos || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, menuPos, open]);

  // 닫힘 모션이 도는 동안에도 DOM은 남지만 레이어 소유권은 즉시 놓는다.
  // 아니면 닫히는 메뉴가 150ms 동안 Escape를 계속 먹는다
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !mounted || !menu) return;
    return registerPopupLayer(menu);
  }, [anchor, mounted, open]);

  // 열린 동안 내용 크기 변화(비동기 옵션 로드 등) 시 클램프·플립 재계산
  useEffect(() => {
    if (!open || !mounted) return;
    const menu = menuRef.current;
    if (!menu) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(menu);
    return () => observer.disconnect();
  }, [mounted, open, place]);

  // 열린 채로 비활성화되면 닫는다 — 트리거만 죽고 포털 메뉴가 살아남는 것 방지
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (disabled) setOpen(false);
  }, [disabled]);

  // Escape 소유 — 최상위 포털 레이어이므로 소비 후 자신만 닫기
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!isTopmostPopupLayer(menuRef.current)) return;
      event.preventDefault();
      closeAndFocusTrigger();
    };
    ownerDocument.addEventListener('keydown', handleKey);
    return () => ownerDocument.removeEventListener('keydown', handleKey);
  }, [closeAndFocusTrigger, open, ownerDocument]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const preferredIndex =
      selectedIndex >= 0
        ? selectedIndex
        : event.key === 'ArrowUp'
        ? options.length - 1
        : 0;
    if (open) {
      moveActiveOption(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else {
      openMenu(preferredIndex);
    }
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActiveOption(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActiveOption(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectOption(index);
        break;
      case 'Tab': {
        event.preventDefault();
        const selector =
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const modalScope = buttonRef.current?.closest<HTMLElement>(
          '[data-dmn-modal-backdrop="true"]',
        );
        const popupScope = buttonRef.current?.closest<HTMLElement>(
          '[data-dmn-popup-layer="true"]',
        );
        const focusScope: ParentNode = popupScope ?? modalScope ?? document;
        const tabStops = Array.from(
          focusScope.querySelectorAll<HTMLElement>(selector),
        ).filter(
          (element) =>
            !menuRef.current?.contains(element) &&
            !element.closest('[hidden], [aria-hidden="true"]'),
        );
        const triggerIndex = buttonRef.current
          ? tabStops.indexOf(buttonRef.current)
          : -1;
        const nextIndex = event.shiftKey ? triggerIndex - 1 : triggerIndex + 1;
        const wrappedIndex = event.shiftKey ? tabStops.length - 1 : 0;
        setOpen(false);
        (
          tabStops[nextIndex] ??
          (popupScope || modalScope
            ? tabStops[wrappedIndex]
            : buttonRef.current)
        )?.focus();
        break;
      }
    }
  };

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // 트리거가 스크롤/리사이즈로 움직이면 좌표가 어긋나므로 닫는다
    // (메뉴 내부 스크롤은 제외)
    const handleScroll = (event: Event) => {
      if (isNodeLike(event.target) && menuRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };

    ownerDocument.addEventListener('mousedown', handleClickOutside);
    ownerWindow.addEventListener('scroll', handleScroll, true);
    ownerWindow.addEventListener('resize', handleScroll);
    return () => {
      ownerDocument.removeEventListener('mousedown', handleClickOutside);
      ownerWindow.removeEventListener('scroll', handleScroll, true);
      ownerWindow.removeEventListener('resize', handleScroll);
    };
  }, [open, ownerDocument, ownerWindow]);

  const selected = options.find((opt) => opt.value === visualValue);

  const menu =
    mounted && anchor
      ? createPortal(
          <div
            ref={menuRef}
            data-dmn-popup-submenu="true"
            data-dmn-popup-layer="true"
            data-dmn-motion-state={motionState}
            data-dmn-placement={menuPos?.placement}
            // 닫히는 중엔 시각 잔상만 남으므로 포커스·스크린리더 대상에서 뺀다
            inert={motionState === 'closing'}
            role="listbox"
            id={menuId}
            className={`dmn-motion fixed flex flex-col p-[4px] gap-[4px] ${CANVAS_POPUP_CHROME_CLASS} rounded-surface z-[var(--z-chrome-submenu)] overflow-x-hidden overflow-y-auto max-h-[200px] ${widthClass}`}
            style={{
              // 실측 전에는 원점에서 히든 렌더 — 자연 크기 그대로 측정
              left: menuPos ? menuPos.left : 0,
              right: menuPos?.right,
              top: menuPos ? menuPos.top : 0,
              bottom: menuPos?.bottom,
              // 뷰포트보다 넓은 라벨(플러그인 select) 클램프 불능 방지
              maxWidth: 'calc(100vw - 16px)',
              width: fullWidth ? anchor.width : undefined,
              visibility: menuPos ? undefined : 'hidden',
            }}
          >
            {options.length === 0 ? (
              <div className="px-[8px] py-[6px] text-body text-fg-faint">
                옵션 없음
              </div>
            ) : (
              options.map((opt, index) => (
                <button
                  key={opt.value}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={visualValue === opt.value}
                  tabIndex={-1}
                  className={`text-left w-full h-[23px] px-[8px] rounded-md text-body transition-colors duration-fast flex items-center ${
                    visualValue === opt.value
                      ? 'bg-fill-hover text-fg pointer-events-none'
                      : 'text-fg-muted hover:bg-fill hover:text-fg'
                  }`}
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  onClick={() => selectOption(index)}
                >
                  <span className="truncate">{opt.label}</span>
                </button>
              ))
            )}
          </div>,
          ownerDocument.body,
        )
      : null;

  return (
    <div
      ref={ref}
      className={`relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {iconTrigger ? (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={`flex items-center justify-center w-[23px] h-[23px] rounded-md cursor-pointer bg-fill hover:bg-fill-hover transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          }`}
          onClick={toggleOpen}
          onKeyDown={handleTriggerKeyDown}
          disabled={disabled}
        >
          {iconTrigger}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={`flex box-border items-center justify-between ${
            size === 'lg'
              ? 'h-[30px] px-[10px] rounded-surface'
              : 'h-[23px] px-[8px] rounded-md'
          } bg-fill hover:bg-fill-hover text-fg text-body transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          } ${fullWidth ? 'w-full' : ''} ${widthClass}`}
          onClick={toggleOpen}
          onKeyDown={handleTriggerKeyDown}
          disabled={disabled}
        >
          <span className={`truncate ${!selected ? 'text-fg-muted' : ''}`}>
            {selected ? selected.label : placeholder}
          </span>
          {/* viewBox 14를 8px로 렌더 - 스트로크 2.1이 화면상 1.2 */}
          <svg
            width="8"
            height="5"
            viewBox="0 0 14 8"
            fill="none"
            className={`ml-[5px] shrink-0 text-fg-muted transition-transform duration-base ease-out-expo ${
              open ? 'rotate-180' : 'rotate-0'
            }`}
          >
            <path
              d="M1 1L7 7L13 1"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {menu}
    </div>
  );
};

export default Dropdown;
