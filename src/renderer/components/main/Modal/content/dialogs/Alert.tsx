import React, { useState, useEffect } from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';
import { getScrollShadowState } from '@utils/grid/scrollShadow';

interface AlertProps {
  isOpen: boolean;
  message: string;
  type?: 'alert' | 'confirm' | 'custom';
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const Alert = ({
  isOpen,
  message,
  type = 'alert', // "alert", "confirm", or "custom"
  confirmText,
  cancelText,
  showCancel,
  onConfirm,
  onCancel,
}: AlertProps) => {
  const { t } = useTranslation();

  const [scrollState, setScrollState] = useState<{
    hasTopShadow: boolean;
    hasBottomShadow: boolean;
  }>({
    hasTopShadow: false,
    hasBottomShadow: false,
  });

  // 스크롤 상태 업데이트 함수
  const updateScrollState = (el: HTMLElement | null) => {
    if (!el) return;
    const nextState = getScrollShadowState(el);
    setScrollState((prev) =>
      prev.hasTopShadow === nextState.hasTopShadow &&
      prev.hasBottomShadow === nextState.hasBottomShadow
        ? prev
        : nextState,
    );
  };

  // Lenis smooth scroll 적용 (onScroll 콜백으로 그림자 업데이트)
  const {
    scrollContainerRef: scrollRef,
    wrapperElement,
    scrollbarWidth,
  } = useLenis({
    onScroll: () => updateScrollState(wrapperElement),
  });

  const isConfirm = type === 'confirm';
  const isCustom = type === 'custom';

  useEffect(() => {
    if (isCustom && wrapperElement) {
      // DOM이 렌더링된 후 스크롤 상태 확인
      const timer = setTimeout(() => updateScrollState(wrapperElement), 0);
      return () => clearTimeout(timer);
    }
  }, [isCustom, message, wrapperElement]);

  if (!isOpen) return null;

  const confirmLabel = confirmText || t('common.confirm');
  const cancelLabel = cancelText || t('common.cancel');
  const shouldShowCancel = isConfirm || (isCustom && showCancel);

  const hasOverflow =
    !!wrapperElement &&
    wrapperElement.scrollHeight > wrapperElement.clientHeight + 1;

  return (
    <Modal onClick={onCancel}>
      <div
        className="flex flex-col bg-glass-heavy backdrop-blur-[32px] rounded-[14px] shadow-elevation-3 p-[20px] pr-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 메시지 텍스트 or Custom HTML */}
        {isCustom ? (
          <div className="relative">
            {/* 상단 그림자 */}
            <div
              className={`absolute top-0 left-0 right-[14px] h-[10px] bg-gradient-to-b from-glass-heavy to-transparent pointer-events-none z-10 transition-opacity duration-fast ${
                scrollState.hasTopShadow ? 'opacity-100' : 'opacity-0'
              }`}
            />

            <div
              ref={scrollRef}
              className="max-h-[244px] overflow-y-auto modal-content-scroll pr-[14px] text-center text-fg"
              style={{
                width:
                  hasOverflow && scrollbarWidth > 0
                    ? `calc(100% + ${scrollbarWidth}px)`
                    : undefined,
                transform:
                  hasOverflow && scrollbarWidth > 0
                    ? `translateX(-${scrollbarWidth}px)`
                    : undefined,
                paddingLeft:
                  hasOverflow && scrollbarWidth > 0
                    ? `${scrollbarWidth}px`
                    : undefined,
              }}
              dangerouslySetInnerHTML={{ __html: message }}
            />

            {/* 하단 그림자 */}
            <div
              className={`absolute bottom-0 left-0 right-[14px] h-[10px] bg-gradient-to-t from-glass-heavy to-transparent pointer-events-none z-10 transition-opacity duration-fast ${
                scrollState.hasBottomShadow ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
        ) : (
          <div className="max-w-[236px] text-center text-fg text-label pr-[14px]">
            {message}
          </div>
        )}

        {/* 버튼들 */}
        <div
          className={`flex ${
            !shouldShowCancel ? 'justify-center' : ''
          } gap-[8px] mt-[20px] pr-[14px]`}
        >
          <button
            onClick={onConfirm}
            className={`${
              shouldShowCancel ? 'w-[150px]' : 'w-full'
            } h-[30px] bg-accent hover:bg-accent-hover active:bg-accent-active rounded-lg text-accent-fg text-label transition-colors duration-fast`}
          >
            {confirmLabel}
          </button>
          {shouldShowCancel && (
            <button
              onClick={onCancel}
              className="w-[75px] h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-lg text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default Alert;
