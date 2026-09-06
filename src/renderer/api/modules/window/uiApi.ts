import { usePluginMenuStore } from '@stores/plugin/usePluginMenuStore';
import {
  createButton,
  createCheckbox,
  createInput,
  createDropdown,
  createPanel,
  createFormRow,
} from '@utils/plugin/components/pluginComponents';
import { attachPluginDialogInteractions } from '@utils/plugin/interactions/pluginDialogInteractions';
import { displayElementApi } from '../../pluginDisplayElements';

import type {
  ButtonOptions,
  CheckboxOptions,
  InputOptions,
  DropdownOptions,
  PanelOptions,
  PluginMenuItem,
  KeyMenuContext,
  GridMenuContext,
} from '@src/types/plugin/api';

// 메뉴 항목은 소유 플러그인 id로 정리된다. 호스트 window.api를 비동기 콜백에서
// 부르면 컨텍스트 id가 없어 'unknown' 소유로 등록되고 리로드마다 고아가 쌓이므로
// 등록 자체를 거부한다 (dmn.*은 컨텍스트 래핑이 id를 유지해 여기에 걸리지 않는다)
const canRegisterMenuItem = (): boolean => {
  if (window.__dmn_window_type !== 'main') {
    console.warn('[UI API] contextMenu is only available in main window');
    return false;
  }
  if (!window.__dmn_current_plugin_id) {
    console.warn(
      '[UI API] contextMenu registration outside plugin context is ignored - call it through dmn.ui or from a dmn.* callback',
    );
    return false;
  }
  return true;
};

export const uiApi = {
  contextMenu: {
    addKeyMenuItem: (item: PluginMenuItem<KeyMenuContext>) => {
      if (!canRegisterMenuItem()) return '';
      return usePluginMenuStore.getState().addKeyMenuItem(item);
    },

    addGridMenuItem: (item: PluginMenuItem<GridMenuContext>) => {
      if (!canRegisterMenuItem()) return '';
      return usePluginMenuStore.getState().addGridMenuItem(item);
    },

    removeMenuItem: (fullId: string) => {
      if (window.__dmn_window_type !== 'main') {
        console.warn('[UI API] contextMenu is only available in main window');
        return;
      }

      usePluginMenuStore.getState().removeMenuItem(fullId);
    },

    updateMenuItem: (
      fullId: string,
      updates: Partial<PluginMenuItem<unknown>>,
    ) => {
      if (window.__dmn_window_type !== 'main') {
        console.warn('[UI API] contextMenu is only available in main window');
        return;
      }

      usePluginMenuStore.getState().updateMenuItem(fullId, updates);
    },

    clearMyMenuItems: () => {
      if (window.__dmn_window_type !== 'main') {
        console.warn('[UI API] contextMenu is only available in main window');
        return;
      }

      const pluginId = window.__dmn_current_plugin_id;
      if (!pluginId) {
        console.warn('[UI API] clearMyMenuItems called outside plugin context');
        return;
      }

      usePluginMenuStore.getState().clearByPluginId(pluginId);
    },
  },
  displayElement: displayElementApi,

  dialog: {
    alert: (message: string, options?: { confirmText?: string }) => {
      return new Promise<void>((resolve) => {
        const showAlert = window.__dmn_showAlert;
        if (typeof showAlert !== 'function') {
          console.warn('[Dialog API] showAlert function not available');
          resolve();
          return;
        }
        // 확인 클릭 또는 배경 클릭으로 닫힐 때 resolve
        showAlert(message, options?.confirmText, () => resolve());
      });
    },

    confirm: (
      message: string,
      options?: {
        confirmText?: string;
        cancelText?: string;
        danger?: boolean;
      },
    ) => {
      return new Promise<boolean>((resolve) => {
        const showConfirm = window.__dmn_showConfirm;
        if (typeof showConfirm !== 'function') {
          console.warn('[Dialog API] showConfirm function not available');
          resolve(false);
          return;
        }
        showConfirm(message, () => resolve(true), {
          onCancel: () => resolve(false),
          confirmText: options?.confirmText,
          cancelText: options?.cancelText,
          danger: options?.danger,
        });
      });
    },

    custom: (
      html: string,
      options?: {
        confirmText?: string;
        cancelText?: string;
        showCancel?: boolean;
      },
    ) => {
      return new Promise<boolean>((resolve) => {
        const showCustomDialog = window.__dmn_showCustomDialog;
        if (typeof showCustomDialog !== 'function') {
          console.warn('[Dialog API] showCustomDialog function not available');
          resolve(false);
          return;
        }

        const pluginId = window.__dmn_current_plugin_id;

        const wrappedHtml = `<div data-plugin-dialog-content data-plugin-id="${
          pluginId || ''
        }">${html}</div>`;

        showCustomDialog(wrappedHtml, {
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
          confirmText: options?.confirmText,
          cancelText: options?.cancelText,
          showCancel: options?.showCancel,
          onContentMount: attachPluginDialogInteractions,
        });
      });
    },
  },

  components: {
    button: (text: string, options?: ButtonOptions) =>
      createButton(text, options),
    checkbox: (options?: CheckboxOptions) => createCheckbox(options),
    input: (options?: InputOptions) => createInput(options),
    dropdown: (options: DropdownOptions) => createDropdown(options),
    panel: (content: string, options?: PanelOptions) =>
      createPanel(content, options),
    formRow: (label: string, component: string) =>
      createFormRow(label, component),
  },

  pickColor: (options: {
    initialColor: string;
    onColorChange: (color: string) => void;
    position?: { x: number; y: number };
    id?: string;
    referenceElement?: HTMLElement;
    onClose?: () => void;
    onColorChangeComplete?: (color: string) => void;
  }) => {
    const showColorPicker = window.__dmn_showColorPicker;
    if (typeof showColorPicker === 'function') {
      showColorPicker(options);
    } else {
      console.warn('[UI API] pickColor function not available');
    }
  },
};
