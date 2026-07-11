import React, {
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { useLenis } from '@hooks/useLenis';
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
  /** 스크린리더용 다이얼로그 이름 */
  ariaLabel?: string;
}

const ManagerModalLayout = ({
  isOpen,
  onClose,
  tabs,
  children,
  footer,
  extra,
  contentDeps = [],
  ariaLabel,
}: ManagerModalLayoutProps) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const isFirstRender = useRef(true);

  const { scrollContainerRef: scrollRef } = useLenis();

  useLayoutEffect(() => {
    if (!isOpen) {
      isFirstRender.current = true;
      return;
    }

    setIsScrollable(false);

    const contentEl = contentRef.current;
    if (!contentEl) return;

    const updateHeight = () => {
      const contentHeight = contentEl.scrollHeight;
      setContainerHeight(Math.min(contentHeight, MAX_SCROLL_HEIGHT));
      setIsScrollable(contentHeight > MAX_SCROLL_HEIGHT);
    };

    // 콘텐츠 크기 변경 감지 (높이 애니메이션용)
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(contentEl);
    updateHeight();

    const rafId = requestAnimationFrame(() => {
      isFirstRender.current = false;
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ...contentDeps]);

  if (!isOpen) return null;

  return (
    <Modal onClick={onClose} ariaLabel={ariaLabel}>
      <div
        className="flex flex-col min-w-[264px] bg-glass-heavy backdrop-blur-[32px] rounded-modal shadow-elevation-3 p-[14px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 탭 영역 */}
        {tabs && <div className="mb-[12px]">{tabs}</div>}

        {/* 스크롤 영역 */}
        <div
          ref={scrollRef}
          className="modal-content-scroll dmn-scroll-fade"
          style={{
            height: containerHeight !== null ? `${containerHeight}px` : 'auto',
            maxHeight: `${MAX_SCROLL_HEIGHT}px`,
            overflowY: isScrollable ? 'auto' : 'hidden',
            transition: isFirstRender.current
              ? 'none'
              : 'height 100ms ease-in-out',
            willChange: 'scroll-position',
          }}
        >
          <div ref={contentRef} className="flex flex-col gap-[12px] py-[5px]">
            {children}
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="flex items-center gap-[8px] mt-[12px]">{footer}</div>

        {/* 추가 콘텐츠 (로딩/에러 등) */}
        {extra}
      </div>
    </Modal>
  );
};

export default ManagerModalLayout;
