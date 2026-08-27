import { usePressAction } from '@hooks/usePressAction';
import React, { useCallback, useRef } from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';

interface AlertProps {
  isOpen: boolean;
  message: string;
  type?: 'alert' | 'confirm' | 'custom';
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  danger?: boolean;
  onCustomContentMount?: (element: HTMLElement) => void | (() => void);
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

const Alert = ({
  isOpen,
  message: openMessage,
  type: openType = 'alert', // "alert", "confirm", or "custom"
  confirmText: openConfirmText,
  cancelText: openCancelText,
  showCancel: openShowCancel,
  danger: openDanger = false,
  onCustomContentMount,
  onConfirm,
  onCancel,
}: AlertProps) => {
  const { t } = useTranslation();

  // 호출부가 닫으면서 메시지를 비우므로 퇴장 구간에는 마지막 열림 값을 보여준다
  const { message, type, confirmText, cancelText, showCancel, danger } =
    useRetainedWhileOpen(isOpen, {
      message: openMessage,
      type: openType,
      confirmText: openConfirmText,
      cancelText: openCancelText,
      showCancel: openShowCancel,
      danger: openDanger,
    });

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
  const { run: confirm, pending: confirmPending } = useSingleFlightAction(
    async () => onConfirm?.(),
  );

  // custom dialog의 입력 blur·IME flush와 click 경합 방어 (일반 알림에도 무해)
  const confirmPress = usePressAction(() => {
    void confirm().catch((error) =>
      console.error('Dialog confirm action failed', error),
    );
  });
  const cancelPress = usePressAction(() => {
    if (!confirmPending) onCancel?.();
  });

  // 퇴장 모션이 도는 동안 DOM을 유지한다
  const { mounted, state: motionState } = useModalPresence(isOpen);

  if (!mounted) return null;

  const confirmLabel = confirmText || t('common.confirm');
  const cancelLabel = cancelText || t('common.cancel');
  const shouldShowCancel = isConfirm || (isCustom && showCancel);

  return (
    <Modal
      motionState={motionState}
      onClick={confirmPending ? undefined : onCancel}
      ariaLabel={isCustom ? t('common.dialog') : message}
      contentMountStrategy="after-paint"
    >
      {/* Modal 가용 영역 90px과 위아래 안전 여백 12px 반영
          부모 높이가 auto라 백분율 대신 뷰포트 기준 확정 높이 사용 */}
      <div
        className="flex w-fit min-w-[264px] max-w-[calc(100vw-48px)] flex-col max-h-[calc(100vh-90px-24px)] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 p-[14px]"
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
          <div className="max-w-[412px] min-h-0 self-center overflow-y-auto modal-content-scroll dmn-scroll-fade whitespace-pre-line break-words break-keep text-center text-fg text-label px-[8px] py-[8px]">
            {message}
          </div>
        )}

        {/* 버튼들 */}
        <div
          className={`flex shrink-0 ${
            !shouldShowCancel ? 'justify-center' : ''
          } gap-[8px] mt-[12px]`}
        >
          <button
            {...confirmPress}
            disabled={confirmPending}
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
              {...cancelPress}
              disabled={confirmPending}
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
