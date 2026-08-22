import type { HostGlobalApi } from '@src/renderer/api/hostGlobalApi';
import type { DMNoteAPI } from '@src/types/plugin/api';

declare global {
  interface Window {
    api: HostGlobalApi;
    __dmn_isKeyListening?: boolean;
    __dmn_window_type?: 'main' | 'overlay' | 'panel';
    __dmn_runtime?: 'tauri' | 'obs';
    __dmn_current_plugin_id?: string;
    __dmn_current_locale?: string;
    __dmn_showAlert?: (
      message: string,
      confirmText?: string,
      onDismiss?: () => void,
    ) => void;
    __dmn_showConfirm?: (
      message: string,
      onConfirm: () => void,
      options?: {
        onCancel?: () => void;
        confirmText?: string;
        cancelText?: string;
        danger?: boolean;
      },
    ) => void;
    __dmn_showCustomDialog?: (
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
    __dmn_showColorPicker?: (options: {
      initialColor: string;
      onColorChange?: (color: string) => void;
      position?: { x: number; y: number };
      id?: string;
      referenceElement?: HTMLElement;
      onClose?: () => void;
      onColorChangeComplete?: (color: string) => void;
    }) => void;
    __dmn_getColorPickerState?: () => {
      isOpen: boolean;
      color: string;
      position?: { x: number; y: number };
      id?: string;
      referenceElement?: HTMLElement;
    };
    __dmn_plugin_messages?: Record<
      string,
      Record<string, Record<string, string>>
    >;
    __dmn_plugin_window_proxy?: Window;
    __dmn_custom_js_cleanup?: () => void;
    /** 래퍼가 잡은 플러그인 실행 오류 - 주입 직후 런타임이 회수 */
    __dmn_plugin_run_error?: string;
    /** 래퍼가 마지막 줄에서 세우는 완주 표시 - 평가가 끝까지 갔는지 확인용 */
    __dmn_plugin_ran?: boolean;
    [key: `__dmn_handler_${string}`]:
      | ((...args: unknown[]) => void | Promise<void>)
      | undefined;
  }

  // dmn 전역 변수 (window. 없이 바로 접근 가능)
  const dmn: DMNoteAPI;
}

export {};
