import React from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';

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

  const { scrollContainerRef: scrollRef } = useLenis();

  const isConfirm = type === 'confirm';
  const isCustom = type === 'custom';

  if (!isOpen) return null;

  const confirmLabel = confirmText || t('common.confirm');
  const cancelLabel = cancelText || t('common.cancel');
  const shouldShowCancel = isConfirm || (isCustom && showCancel);

  return (
    <Modal onClick={onCancel}>
      <div
        className="flex flex-col bg-glass-heavy backdrop-blur-[32px] rounded-modal shadow-elevation-3 p-[20px] pr-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 메시지 텍스트 or Custom HTML */}
        {isCustom ? (
          <div
            ref={scrollRef}
            className="max-h-[244px] overflow-y-auto modal-content-scroll dmn-scroll-fade pr-[14px] text-center text-fg"
            dangerouslySetInnerHTML={{ __html: message }}
          />
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
            } h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-lg text-accent-fg text-label transition-colors duration-fast`}
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
