import { usePluginMenuStore } from '@stores/plugin/usePluginMenuStore';
import {
  createButton,
  createCheckbox,
  createInput,
  createDropdown,
  createPanel,
  createFormRow,
} from '@utils/plugin/pluginComponents';
import { setupPluginDropdownInteractions } from '@utils/plugin/pluginDropdownManager';
import { displayElementApi } from '../pluginDisplayElements';

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

export const uiApi = {
  contextMenu: {
    addKeyMenuItem: (item: PluginMenuItem<KeyMenuContext>) => {
      if (window.__dmn_window_type !== 'main') {
        console.warn('[UI API] contextMenu is only available in main window');
        return '';
      }

      return usePluginMenuStore.getState().addKeyMenuItem(item);
    },

    addGridMenuItem: (item: PluginMenuItem<GridMenuContext>) => {
      if (window.__dmn_window_type !== 'main') {
        console.warn('[UI API] contextMenu is only available in main window');
        return '';
      }

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
        showAlert(message, options?.confirmText);
        setTimeout(resolve, 0);
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
        showConfirm(
          message,
          () => resolve(true),
          () => resolve(false),
          options?.confirmText,
        );
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
        });

        setTimeout(() => {
          const dialogContent = document.querySelector(
            '[data-plugin-dialog-content]',
          );
          if (!dialogContent) return;

          dialogContent.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement;
            const checkbox = target.closest('[data-checkbox-toggle]');
            if (checkbox) {
              const input = checkbox.querySelector(
                'input[type=checkbox]',
              ) as HTMLInputElement;
              const knob = checkbox.querySelector('div') as HTMLElement;

              if (input) {
                input.checked = !input.checked;

                if (input.checked) {
                  checkbox.classList.remove('bg-[#3B4049]');
                  checkbox.classList.add('bg-[#493C1D]');
                  knob.classList.remove('left-[2px]', 'bg-[#989BA6]');
                  knob.classList.add('left-[13px]', 'bg-[#FFB400]');
                } else {
                  checkbox.classList.remove('bg-[#493C1D]');
                  checkbox.classList.add('bg-[#3B4049]');
                  knob.classList.remove('left-[13px]', 'bg-[#FFB400]');
                  knob.classList.add('left-[2px]', 'bg-[#989BA6]');
                }

                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          });

          setupPluginDropdownInteractions(dialogContent as HTMLElement);

          const handleInputBlur = (e: Event) => {
            const targetEl = e.target as HTMLInputElement;
            if (
              targetEl.tagName === 'INPUT' &&
              targetEl.type === 'number' &&
              targetEl.hasAttribute('data-plugin-input-blur')
            ) {
              const minStr = targetEl.getAttribute('data-plugin-input-min');
              const maxStr = targetEl.getAttribute('data-plugin-input-max');
              const currentValue = targetEl.value;

              if (currentValue === '' || isNaN(parseFloat(currentValue))) {
                const defaultValue = minStr ? parseFloat(minStr) : 0;
                targetEl.value = String(defaultValue);
                targetEl.dispatchEvent(new Event('change', { bubbles: true }));
                return;
              }

              const numValue = parseFloat(currentValue);
              let clampedValue = numValue;

              if (minStr && numValue < parseFloat(minStr)) {
                clampedValue = parseFloat(minStr);
              }
              if (maxStr && numValue > parseFloat(maxStr)) {
                clampedValue = parseFloat(maxStr);
              }

              if (clampedValue !== numValue) {
                targetEl.value = String(clampedValue);
                targetEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          };

          const handleEvent = (e: Event) => {
            const target = e.target as HTMLElement;
            const handlerAttr =
              e.type === 'click'
                ? 'data-plugin-handler'
                : e.type === 'input'
                ? 'data-plugin-handler-input'
                : e.type === 'change'
                ? 'data-plugin-handler-change'
                : null;

            if (!handlerAttr) return;

            let element: HTMLElement | null = target;
            let handlerName: string | null = null;

            while (element && element !== dialogContent) {
              handlerName = element.getAttribute(handlerAttr);
              if (handlerName) break;
              element = element.parentElement;
            }

            if (!handlerName) return;

            const handler = (window as unknown as Record<string, unknown>)[
              handlerName
            ];
            if (typeof handler === 'function') {
              (handler as (e: Event) => void)(e);
            }
          };

          dialogContent.addEventListener('click', handleEvent);
          dialogContent.addEventListener('change', handleEvent);
          dialogContent.addEventListener('input', handleEvent);
          dialogContent.addEventListener('blur', handleInputBlur, true);
        }, 0);
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
