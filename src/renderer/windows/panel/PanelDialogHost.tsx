import { useEffect, useRef, useState } from 'react';

import CustomAlert from '@components/main/Modal/content/dialogs/Alert';
import { useTranslation } from '@contexts/useTranslation';

interface DialogState {
  isOpen: boolean;
  message: string;
  type: 'alert' | 'confirm';
  confirmText?: string;
  cancelText?: string;
  danger: boolean;
}

const CLOSED: DialogState = {
  isOpen: false,
  message: '',
  type: 'alert',
  confirmText: undefined,
  cancelText: undefined,
  danger: false,
};

// 패널 창 전용 다이얼로그 호스트
// uiApi.dialog(alert/confirm)가 의존하는 __dmn_showAlert/__dmn_showConfirm을 설치해
// 편집 충돌 해소 같은 확인 흐름이 패널에서도 동작하게 함
const PanelDialogHost = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<DialogState>(CLOSED);
  const confirmCallbackRef = useRef<(() => void) | null>(null);
  const cancelCallbackRef = useRef<(() => void) | null>(null);

  // 새 요청이 기존 다이얼로그를 대체할 때 이전 콜백을 settle해 Promise 유실 방지
  const settlePending = () => {
    const cancel = cancelCallbackRef.current;
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
    cancel?.();
  };

  useEffect(() => {
    window.__dmn_showAlert = (message, confirmText, onDismiss) => {
      settlePending();
      confirmCallbackRef.current = onDismiss ?? null;
      cancelCallbackRef.current = onDismiss ?? null;
      setState({
        isOpen: true,
        message,
        type: 'alert',
        confirmText: confirmText || t('common.confirm'),
        cancelText: undefined,
        danger: false,
      });
    };
    window.__dmn_showConfirm = (message, onConfirm, options) => {
      settlePending();
      confirmCallbackRef.current = onConfirm;
      cancelCallbackRef.current = options?.onCancel ?? null;
      setState({
        isOpen: true,
        message,
        type: 'confirm',
        confirmText: options?.confirmText || t('common.confirm'),
        cancelText: options?.cancelText,
        danger: options?.danger ?? false,
      });
    };
    return () => {
      delete window.__dmn_showAlert;
      delete window.__dmn_showConfirm;
    };
  });

  const close = () => setState(CLOSED);

  const handleConfirm = () => {
    const confirm = confirmCallbackRef.current;
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
    close();
    confirm?.();
  };

  const handleCancel = () => {
    const cancel = cancelCallbackRef.current;
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
    close();
    cancel?.();
  };

  return (
    <CustomAlert
      isOpen={state.isOpen}
      message={state.message}
      type={state.type}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      danger={state.danger}
      showCancel={undefined}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
};

export default PanelDialogHost;
