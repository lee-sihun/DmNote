import React, { useCallback, useRef } from 'react';
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
  danger?: boolean;
  onCustomContentMount?: (element: HTMLElement) => void | (() => void);
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
  danger = false,
  onCustomContentMount,
  onConfirm,
  onCancel,
}: AlertProps) => {
  const { t } = useTranslation();

  const { scrollContainerRef: scrollRef } = useLenis();
  const customContentCleanupRef = useRef<(() => void) | null>(null);
  const setCustomContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      customContentCleanupRef.current?.();
      customContentCleanupRef.current = null;
      scrollRef(node);

      if (!node || !onCustomContentMount) return;
      const pluginContent = node.querySelector<HTMLElement>(
        '[data-plugin-dialog-content]',
      );
      if (!pluginContent) {
        console.warn('[Dialog API] Plugin dialog content was not mounted');
        return;
      }

      const cleanup = onCustomContentMount(pluginContent);
      customContentCleanupRef.current =
        typeof cleanup === 'function' ? cleanup : null;
    },
    [onCustomContentMount, scrollRef],
  );

  const isConfirm = type === 'confirm';
  const isCustom = type === 'custom';

  if (!isOpen) return null;

  const confirmLabel = confirmText || t('common.confirm');
  const cancelLabel = cancelText || t('common.cancel');
  const shouldShowCancel = isConfirm || (isCustom && showCancel);

  return (
    <Modal
      onClick={onCancel}
      ariaLabel={isCustom ? t('common.dialog') : message}
    >
      <div
        className="flex flex-col min-w-[264px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 p-[14px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 메시지 텍스트 or Custom HTML */}
        {isCustom ? (
          <div
            key={message}
            ref={setCustomContentRef}
            className="max-h-[244px] overflow-y-auto modal-content-scroll dmn-scroll-fade text-center text-fg"
            dangerouslySetInnerHTML={{ __html: message }}
          />
        ) : (
          <div className="max-w-[236px] self-center text-center text-fg text-label px-[8px] py-[8px]">
            {message}
          </div>
        )}

        {/* 버튼들 */}
        <div
          className={`flex ${
            !shouldShowCancel ? 'justify-center' : ''
          } gap-[8px] mt-[12px]`}
        >
          <button
            onClick={onConfirm}
            className={`${shouldShowCancel ? 'flex-[2]' : 'w-full'} h-[30px] ${
              danger
                ? 'bg-danger-muted hover:bg-danger-muted-hover active:bg-danger-muted-active text-danger-fg'
                : 'bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active text-accent-fg'
            } rounded-surface text-label transition-colors duration-fast`}
          >
            {confirmLabel}
          </button>
          {shouldShowCancel && (
            <button
              onClick={onCancel}
              className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
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
