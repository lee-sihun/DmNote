import { useEffect, useRef, useState } from 'react';
import {
  closeCustomDialogOwnedSurface,
  replaceCustomDialogCallbacks,
  type CustomDialogCallbacks,
} from './customDialogCallbacks';

type Translate = (key: string) => string;

interface AlertState {
  isOpen: boolean;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger: boolean;
  type: 'alert' | 'confirm' | 'custom';
}

interface CustomDialogState {
  isOpen: boolean;
  html: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  onContentMount?: (element: HTMLElement) => void | (() => void);
}

interface ColorPickerState {
  isOpen: boolean;
  color: string;
  position?: { x: number; y: number };
  id?: string;
  referenceElement?: HTMLElement;
  onChange?: (color: string) => void;
  onComplete?: (color: string) => void;
}

interface ColorPickerOptions {
  initialColor: string;
  onColorChange: (color: string) => void;
  position?: { x: number; y: number };
  id?: string;
  referenceElement?: HTMLElement;
  onClose?: () => void;
  onColorChangeComplete?: (color: string) => void;
}

interface UseMainDialogRuntimeOptions {
  t: Translate;
}

export interface MainDialogRuntime {
  alertState: AlertState;
  customDialogState: CustomDialogState;
  colorPickerState: ColorPickerState;
  showAlert: (
    message: string,
    confirmText?: string,
    onDismiss?: () => void,
  ) => void;
  showConfirm: (
    message: string,
    onConfirm: () => void,
    options?: {
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    },
  ) => void;
  handleAlertConfirm: () => void;
  handleAlertCancel: () => void;
  showCustomDialog: (
    html: string,
    options?: {
      onConfirm?: () => void;
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      showCancel?: boolean;
      onContentMount?: (element: HTMLElement) => void | (() => void);
    },
  ) => void;
  handleCustomDialogConfirm: () => void;
  handleCustomDialogCancel: () => void;
  openColorPickerWithOptions: (options: ColorPickerOptions) => void;
  closeColorPicker: () => void;
  handleGlobalColorChange: (newColor: string) => void;
  handleGlobalColorChangeComplete: (newColor: string) => void;
  confirmCallbackRef: React.RefObject<(() => void) | null>;
  cancelCallbackRef: React.RefObject<(() => void) | null>;
  customDialogCallbackRef: React.RefObject<CustomDialogCallbacks>;
}

export const useMainDialogRuntime = ({
  t,
}: UseMainDialogRuntimeOptions): MainDialogRuntime => {
  const confirmCallbackRef = useRef<(() => void) | null>(null);
  const cancelCallbackRef = useRef<(() => void) | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(() => ({
    isOpen: false,
    message: '',
    confirmText: t('common.confirm'),
    cancelText: undefined,
    danger: false,
    type: 'alert',
  }));

  // Custom Dialog 상태 (HTML 콘텐츠)
  const customDialogCallbackRef = useRef<CustomDialogCallbacks>({});
  const [customDialogState, setCustomDialogState] = useState<CustomDialogState>(
    {
      isOpen: false,
      html: '',
      confirmText: undefined,
      cancelText: undefined,
      showCancel: false,
      onContentMount: undefined,
    },
  );

  // Global Color Picker 상태
  const colorPickerCloseCallbackRef = useRef<(() => void) | null>(null);
  // 콜백은 ref가 아니라 열림 상태에 함께 싣는다. 퇴장 유예 동안 다른 피커가
  // 열리면 ref는 이미 새 주인을 가리켜, 옛 피커의 마지막 커밋이 엉뚱한 대상에 꽂힌다.
  // 상태에 실으면 엘리먼트가 그 세션의 콜백을 그대로 들고 퇴장한다
  const [colorPickerState, setColorPickerState] = useState<ColorPickerState>({
    isOpen: false,
    color: '#FFFFFF',
    position: undefined,
    id: undefined,
    referenceElement: undefined,
  });

  // 새 요청이 기존 alert/confirm을 대체할 때 이전 콜백을 settle해 Promise 유실 방지
  const settlePendingDialog = () => {
    const cancel = cancelCallbackRef.current;
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
    cancel?.();
  };

  const showAlert = (
    message: string,
    confirmText?: string,
    onDismiss?: () => void,
  ) => {
    settlePendingDialog();
    // alert는 확인·배경 클릭 어느 경로로 닫혀도 동일하게 settle
    confirmCallbackRef.current = onDismiss ?? null;
    cancelCallbackRef.current = onDismiss ?? null;
    setAlertState({
      isOpen: true,
      message,
      type: 'alert',
      confirmText: confirmText || t('common.confirm'),
      cancelText: undefined,
      danger: false,
    });
  };

  const showConfirm = (
    message: string,
    onConfirm: () => void,
    options?: {
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    },
  ) => {
    settlePendingDialog();
    confirmCallbackRef.current =
      typeof onConfirm === 'function' ? onConfirm : null;
    cancelCallbackRef.current =
      typeof options?.onCancel === 'function' ? options.onCancel : null;
    setAlertState({
      isOpen: true,
      message,
      confirmText: options?.confirmText || t('common.confirm'),
      cancelText: options?.cancelText,
      danger: options?.danger ?? false,
      type: 'confirm',
    });
  };

  const closeAlert = () => {
    setAlertState({
      isOpen: false,
      message: '',
      confirmText: t('common.confirm'),
      cancelText: undefined,
      danger: false,
      type: 'alert',
    });
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
  };

  // 닫은 뒤 콜백 실행 — 콜백이 동기적으로 새 다이얼로그를 열어도 닫히지 않게
  const handleAlertConfirm = () => {
    const callback = confirmCallbackRef.current;
    closeAlert();
    callback?.();
  };

  const handleAlertCancel = () => {
    const callback = cancelCallbackRef.current;
    closeAlert();
    callback?.();
  };

  // Custom Dialog 핸들러
  const showCustomDialog = (
    html: string,
    options?: {
      onConfirm?: () => void;
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      showCancel?: boolean;
      onContentMount?: (element: HTMLElement) => void | (() => void);
    },
  ) => {
    if (colorPickerState.isOpen) {
      closeCustomDialogOwnedSurface(
        colorPickerState.referenceElement,
        closeColorPicker,
      );
    }
    replaceCustomDialogCallbacks(customDialogCallbackRef, {
      onConfirm: options?.onConfirm,
      onCancel: options?.onCancel,
    });
    setCustomDialogState({
      isOpen: true,
      html,
      confirmText: options?.confirmText,
      cancelText: options?.cancelText,
      showCancel: options?.showCancel ?? false,
      onContentMount: options?.onContentMount,
    });
  };

  const closeCustomDialog = () => {
    // 다이얼로그 내부 앵커에 붙은 전역 피커는 다이얼로그와 함께 정리
    if (colorPickerState.isOpen) {
      closeCustomDialogOwnedSurface(
        colorPickerState.referenceElement,
        closeColorPicker,
      );
    }
    setCustomDialogState({
      isOpen: false,
      html: '',
      confirmText: undefined,
      cancelText: undefined,
      showCancel: false,
      onContentMount: undefined,
    });
    customDialogCallbackRef.current = {};
  };

  const handleCustomDialogConfirm = () => {
    if (customDialogCallbackRef.current.onConfirm) {
      customDialogCallbackRef.current.onConfirm();
    }
    closeCustomDialog();
  };

  const handleCustomDialogCancel = () => {
    if (customDialogCallbackRef.current.onCancel) {
      customDialogCallbackRef.current.onCancel();
    }
    closeCustomDialog();
  };

  const openColorPickerWithOptions = (options: ColorPickerOptions) => {
    colorPickerCloseCallbackRef.current = options.onClose || null;
    setColorPickerState({
      isOpen: true,
      color: options.initialColor,
      position: options.position,
      id: options.id,
      referenceElement: options.referenceElement,
      onChange: options.onColorChange,
      onComplete: options.onColorChangeComplete,
    });
  };

  const closeColorPicker = () => {
    if (colorPickerCloseCallbackRef.current) {
      colorPickerCloseCallbackRef.current();
    }
    // 세션 콜백은 지우지 않는다. 퇴장 중 언마운트 커밋이 아직 남아 있고,
    // 그 커밋은 이 세션의 대상으로 가야 한다
    setColorPickerState((prev) => ({ ...prev, isOpen: false }));
    colorPickerCloseCallbackRef.current = null;
  };

  // 콜백을 상태에서 꺼내므로 이 클로저는 열림 세션에 묶인다.
  // 엘리먼트가 붙잡히면 클로저도 함께 붙잡혀 퇴장 구간의 마지막 커밋이 제 대상으로 간다
  const handleGlobalColorChange = (newColor: string) => {
    setColorPickerState((prev) => ({ ...prev, color: newColor }));
    colorPickerState.onChange?.(newColor);
  };

  const handleGlobalColorChangeComplete = (newColor: string) => {
    colorPickerState.onComplete?.(newColor);
  };

  return {
    alertState,
    customDialogState,
    colorPickerState,
    showAlert,
    showConfirm,
    handleAlertConfirm,
    handleAlertCancel,
    showCustomDialog,
    handleCustomDialogConfirm,
    handleCustomDialogCancel,
    openColorPickerWithOptions,
    closeColorPicker,
    handleGlobalColorChange,
    handleGlobalColorChangeComplete,
    confirmCallbackRef,
    cancelCallbackRef,
    customDialogCallbackRef,
  };
};

export const useMainDialogRuntimeLifecycle = (
  runtime: MainDialogRuntime,
): void => {
  const {
    colorPickerState,
    showAlert,
    showConfirm,
    showCustomDialog,
    openColorPickerWithOptions,
    closeColorPicker,
    confirmCallbackRef,
    cancelCallbackRef,
    customDialogCallbackRef,
  } = runtime;

  // 언마운트 시 대기 중 다이얼로그 Promise settle (HMR·루트 교체 대비)
  useEffect(
    () => () => {
      const cancel = cancelCallbackRef.current;
      confirmCallbackRef.current = null;
      cancelCallbackRef.current = null;
      cancel?.();
      replaceCustomDialogCallbacks(customDialogCallbackRef, {});
    },
    // runtime ref 수명 고정
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Global Color Picker 핸들러
  const showColorPickerImpl = useRef<(options: ColorPickerOptions) => void>(
    () => {},
  );
  const showColorPicker = (options: ColorPickerOptions) => {
    showColorPickerImpl.current(options);
  };

  useEffect(() => {
    showColorPickerImpl.current = (options: ColorPickerOptions) => {
      // Toggle logic - 이미 열려있으면 닫기만 하고 종료
      if (
        options.id &&
        colorPickerState.isOpen &&
        colorPickerState.id === options.id
      ) {
        closeColorPicker();
        return;
      }

      // 다른 컬러 픽커가 열려있으면 먼저 닫기
      if (colorPickerState.isOpen) {
        closeColorPicker();
        // 약간의 지연 후 새 컬러 픽커 열기 (상태 갱신을 위해)
        setTimeout(() => {
          openColorPickerWithOptions(options);
        }, 0);
        return;
      }

      openColorPickerWithOptions(options);
    };
  });

  const colorPickerStateRef = useRef(colorPickerState);
  useEffect(() => {
    colorPickerStateRef.current = colorPickerState;
  }, [colorPickerState]);
  const getColorPickerState = () => colorPickerStateRef.current;

  // Dialog API를 전역으로 노출
  useEffect(() => {
    window.__dmn_showAlert = showAlert;
    window.__dmn_showConfirm = showConfirm;
    window.__dmn_showCustomDialog = showCustomDialog;
    window.__dmn_showColorPicker = showColorPicker;
    window.__dmn_getColorPickerState = getColorPickerState;

    return () => {
      delete window.__dmn_showAlert;
      delete window.__dmn_showConfirm;
      delete window.__dmn_showCustomDialog;
      delete window.__dmn_showColorPicker;
      delete window.__dmn_getColorPickerState;
    };
  });
};
