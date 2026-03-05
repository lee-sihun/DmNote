import React, { useState, useEffect } from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/I18nContext';
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

export default function Alert({
  isOpen,
  message,
  type = 'alert', // "alert", "confirm", or "custom"
  confirmText,
  cancelText,
  showCancel,
  onConfirm,
  onCancel,
}: AlertProps) {
  if (!isOpen) return null;

  const { t } = useTranslation();
  const confirmLabel = confirmText || t('common.confirm');
  const cancelLabel = cancelText || t('common.cancel');

  const isConfirm = type === 'confirm';
  const isCustom = type === 'custom';
  const shouldShowCancel = isConfirm || (isCustom && showCancel);

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

  useEffect(() => {
    if (isCustom && wrapperElement) {
      // DOM이 렌더링된 후 스크롤 상태 확인
      const timer = setTimeout(() => updateScrollState(wrapperElement), 0);
      return () => clearTimeout(timer);
    }
  }, [isCustom, message, wrapperElement, updateScrollState]);

  const hasOverflow =
    !!wrapperElement &&
    wrapperElement.scrollHeight > wrapperElement.clientHeight + 1;

  return (
    <Modal onClick={onCancel}>
      <div
        className="flex flex-col bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px] pr-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 메시지 텍스트 or Custom HTML */}
        {isCustom ? (
          <div className="relative">
            {/* 상단 그림자 */}
            <div
              className={`absolute top-0 left-0 right-[14px] h-[10px] bg-gradient-to-b from-[#1A191E] to-transparent pointer-events-none z-10 transition-opacity duration-150 ${
                scrollState.hasTopShadow ? 'opacity-100' : 'opacity-0'
              }`}
            />

            <div
              ref={scrollRef}
              className="max-h-[244px] overflow-y-auto modal-content-scroll pr-[14px] text-center text-[#FFFFFF]"
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
              className={`absolute bottom-0 left-0 right-[14px] h-[10px] bg-gradient-to-t from-[#1A191E] to-transparent pointer-events-none z-10 transition-opacity duration-150 ${
                scrollState.hasBottomShadow ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
        ) : (
          <div className="max-w-[235.5px] text-center text-[#FFFFFF] text-style-3 !leading-[20px] pr-[14px]">
            {message}
          </div>
        )}

        {/* 버튼들 */}
        <div
          className={`flex ${
            !shouldShowCancel ? 'justify-center' : ''
          } gap-[10.5px] mt-[19px] pr-[14px]`}
        >
          <button
            onClick={onConfirm}
            className={`w-${
              shouldShowCancel ? '[150px]' : 'full'
            } h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3`}
          >
            {confirmLabel}
          </button>
          {shouldShowCancel && (
            <button
              onClick={onCancel}
              className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
