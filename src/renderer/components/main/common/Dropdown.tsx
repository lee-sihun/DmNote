import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from 'react';
import { createPortal } from 'react-dom';

interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
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
}

const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = '선택',
  disabled = false,
  fullWidth = false,
  iconTrigger,
  align = 'left',
  widthClass = '',
  size = 'sm',
}) => {
  const [open, setOpen] = useState(false);
  // 트리거 실측 — 열리는 순간 캡처, 메뉴 좌표 계산의 기준
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // null이면 아직 미실측 — 히든 렌더 후 layout effect에서 확정
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 메뉴는 body로 포털 — 패널/모달의 backdrop-filter·mask 아래에서는
  // 중첩 backdrop-blur가 무력화되므로 backdrop root 밖에서 그린다
  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      // 좌표 계산은 실측 후 layout effect에서 — 여기선 앵커만 캡처
      setAnchor(buttonRef.current.getBoundingClientRect());
      setMenuPos(null);
    }
    setOpen((prev) => !prev);
  };

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
    let horizontal: MenuPosition;
    if (!fullWidth && align === 'right') {
      let right = window.innerWidth - anchor.right;
      right = Math.min(right, window.innerWidth - margin - menuWidth);
      right = Math.max(right, margin);
      horizontal = { right };
    } else {
      let left = anchor.left;
      left = Math.min(left, window.innerWidth - margin - menuWidth);
      left = Math.max(left, margin);
      horizontal = { left };
    }

    // 버튼 아래 공간이 부족하면 위로 펼치기 — 위로 열릴 땐 bottom 좌표로
    // 고정해 내용 높이가 변해도 위쪽으로 자라게 유지
    const openUpward =
      anchor.bottom + gap + menuHeight > window.innerHeight - bottomPadding;
    let vertical: MenuPosition;
    if (openUpward) {
      let bottom = window.innerHeight - anchor.top + gap;
      bottom = Math.min(bottom, window.innerHeight - margin - menuHeight);
      bottom = Math.max(bottom, margin);
      vertical = { bottom };
    } else {
      let top = anchor.bottom + gap;
      top = Math.min(top, window.innerHeight - margin - menuHeight);
      top = Math.max(top, margin);
      vertical = { top };
    }

    const next = { ...horizontal, ...vertical };
    setMenuPos((prev) =>
      prev &&
      prev.left === next.left &&
      prev.right === next.right &&
      prev.top === next.top &&
      prev.bottom === next.bottom
        ? prev
        : next,
    );
  }, [anchor, fullWidth, align]);

  useLayoutEffect(() => {
    if (!open || menuPos) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    place();
  }, [open, menuPos, place]);

  // 열린 동안 내용 크기 변화(비동기 옵션 로드 등) 시 클램프·플립 재계산
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(menu);
    return () => observer.disconnect();
  }, [open, place]);

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
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

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
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  const selected = options.find((opt) => opt.value === value);

  const menu =
    open && anchor
      ? createPortal(
          <div
            ref={menuRef}
            data-dmn-popup-submenu="true"
            className={`fixed flex flex-col p-[4px] gap-[4px] bg-glass backdrop-blur-[24px] rounded-surface shadow-elevation-2 z-[60] overflow-x-hidden overflow-y-auto max-h-[200px] tooltip-fade-in ${widthClass}`}
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
              options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`text-left w-full h-[23px] px-[8px] rounded-md text-body transition-colors duration-fast flex items-center ${
                    value === opt.value
                      ? 'bg-surface-active text-fg pointer-events-none'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                  }`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{opt.label}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
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
          className={`flex items-center justify-center w-[23px] h-[23px] rounded-md cursor-pointer bg-fill hover:bg-fill-hover transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          }`}
          onClick={toggleOpen}
          disabled={disabled}
        >
          {iconTrigger}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className={`flex box-border items-center justify-between ${
            size === 'lg'
              ? 'h-[30px] px-[10px] rounded-surface'
              : 'h-[23px] px-[8px] rounded-md'
          } bg-fill hover:bg-fill-hover text-fg text-body transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          } ${fullWidth ? 'w-full' : ''} ${widthClass}`}
          onClick={toggleOpen}
          disabled={disabled}
        >
          <span className={`truncate ${!selected ? 'text-fg-muted' : ''}`}>
            {selected ? selected.label : placeholder}
          </span>
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
              strokeWidth="2"
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
