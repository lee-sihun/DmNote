import type {
  DMNoteAPI,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

declare global {
  interface Window {
    api: DMNoteAPI;
    __dmn_isKeyListening?: boolean;
    __dmn_window_type?: 'main' | 'overlay';
    __dmn_current_plugin_id?: string;
    __dmn_current_locale?: string;
    __dmn_showAlert?: (message: string, confirmText?: string) => void;
    __dmn_showConfirm?: (
      message: string,
      onConfirm: () => void,
      onCancel?: () => void,
      confirmText?: string,
    ) => void;
    __dmn_showCustomDialog?: (
      html: string,
      options?: {
        onConfirm?: () => void;
        onCancel?: () => void;
        confirmText?: string;
        cancelText?: string;
        showCancel?: boolean;
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
    __dmn_element_restorers?: Map<
      string,
      (el: PluginDisplayElementInternal) => PluginDisplayElementInternal
    >;
    __dmn_plugin_messages?: Record<
      string,
      Record<string, Record<string, string>>
    >;
    __dmn_plugin_window_proxy?: Window;
    __dmn_custom_js_cleanup?: () => void;
    [key: `__dmn_handler_${string}`]:
      | ((...args: unknown[]) => void | Promise<void>)
      | undefined;
  }

  // dmn 전역 변수 (window. 없이 바로 접근 가능)
  const dmn: DMNoteAPI;
}

export {};
