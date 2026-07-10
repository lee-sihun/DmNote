import React, {
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { useLenis } from '@hooks/useLenis';
import { getScrollShadowState } from '@utils/grid/scrollShadow';
import Modal from './Modal';

const MAX_SCROLL_HEIGHT = 195;

interface ManagerModalLayoutProps {
  isOpen: boolean;
  onClose: () => void;
  /** 탭 영역 (TabSwitch 등) */
  tabs?: ReactNode;
  /** 스크롤 영역 내부 콘텐츠 */
  children: ReactNode;
  /** 하단 버튼 영역 */
  footer: ReactNode;
  /** 스크롤 영역 아래 추가 콘텐츠 (로딩/에러 메시지 등) */
  extra?: ReactNode;
  /** 콘텐츠 변경 시 높이/스크롤 재계산 트리거 의존성 */
  contentDeps?: unknown[];
}

const ManagerModalLayout = ({
  isOpen,
  onClose,
  tabs,
  children,
  footer,
  extra,
  contentDeps = [],
}: ManagerModalLayoutProps) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    hasTopShadow: false,
    hasBottomShadow: false,
  });
  const [skipShadowTransition, setSkipShadowTransition] = useState(true);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const isFirstRender = useRef(true);

  const updateScrollState = (el: HTMLElement | null) => {
    if (!el) return;
    const nextState = getScrollShadowState(el, contentRef.current);
    setScrollState((prev) =>
      prev.hasTopShadow === nextState.hasTopShadow &&
      prev.hasBottomShadow === nextState.hasBottomShadow
        ? prev
        : nextState,
    );
  };

  const { scrollContainerRef: scrollRef, wrapperElement } = useLenis({
    onScroll: () => updateScrollState(wrapperElement),
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      isFirstRender.current = true;
      return;
    }

    setSkipShadowTransition(true);
    setScrollState({ hasTopShadow: false, hasBottomShadow: false });
    setIsScrollable(false);

    const el = wrapperElement;
    const contentEl = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (contentEl) {
        const contentHeight = contentEl.scrollHeight;
        setContainerHeight(Math.min(contentHeight, MAX_SCROLL_HEIGHT));
        setIsScrollable(contentHeight > MAX_SCROLL_HEIGHT);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState(el);
      updateHeight();
    });

    if (contentEl) resizeObserver.observe(contentEl);
    resizeObserver.observe(el);

    updateScrollState(el);
    updateHeight();

    const rafId = requestAnimationFrame(() => {
      setSkipShadowTransition(false);
      isFirstRender.current = false;
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, wrapperElement, ...contentDeps]);

  if (!isOpen) return null;

  const shadowTransitionClass = skipShadowTransition
    ? ''
    : 'transition-opacity duration-150';

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col bg-elevated rounded-xl border border-line shadow-elevation-3 p-[20px] pr-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 탭 영역 */}
        {tabs && <div className="pr-[14px]">{tabs}</div>}

        {/* 스크롤 영역 */}
        <div className="relative">
          {/* 상단 그림자 */}
          <div
            className={`absolute top-0 left-0 right-[14px] h-[10px] bg-gradient-to-b from-elevated to-transparent pointer-events-none z-10 ${shadowTransitionClass} ${
              scrollState.hasTopShadow ? 'opacity-100' : 'opacity-0'
            }`}
          />

          <div
            ref={scrollRef}
            className="modal-content-scroll pr-[14px]"
            style={{
              height:
                containerHeight !== null ? `${containerHeight}px` : 'auto',
              maxHeight: `${MAX_SCROLL_HEIGHT}px`,
              overflowY: isScrollable ? 'auto' : 'hidden',
              transition: isFirstRender.current
                ? 'none'
                : 'height 100ms ease-in-out',
              willChange: 'scroll-position',
            }}
          >
            <div ref={contentRef} className="flex flex-col gap-[19px] py-[5px]">
              {children}
            </div>
          </div>

          {/* 하단 그림자 */}
          <div
            className={`absolute bottom-0 left-0 right-[14px] h-[10px] bg-gradient-to-t from-elevated to-transparent pointer-events-none z-10 ${shadowTransitionClass} ${
              scrollState.hasBottomShadow ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>

        {/* 구분선 */}
        <div className="h-px bg-line my-[20px] -ml-[20px] -mr-[6px]" />

        {/* 하단 버튼 */}
        <div className="flex items-center gap-[8px] pr-[14px]">{footer}</div>

        {/* 추가 콘텐츠 (로딩/에러 등) */}
        {extra}
      </div>
    </Modal>
  );
};

export default ManagerModalLayout;
