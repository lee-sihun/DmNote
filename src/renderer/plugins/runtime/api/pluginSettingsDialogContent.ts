import {
  SECTION_WRAPPER_CLASS,
  SECTION_LABEL_CLASS,
  SECTION_CARD_CLASS,
  FORM_ROW_CLASS,
  FORM_LABEL_CLASS,
} from '@utils/cardRecipes';
import type {
  DMNoteAPI,
  PluginSettingSchema,
  PluginSettingValue,
} from '@src/types/plugin/api';
import { handlerRegistry } from '../handlers';
import {
  coerceSettingValue,
  normalizeSettingsSections,
  type SettingsNormalizationErrorKind,
} from '../settingsSections';
import { createPluginDialogHandlerScope } from './pluginDialogHandlers';

type Translate = (
  key?: string,
  params?: Record<string, string | number>,
  fallback?: string,
) => string;

type SettingChangeHandler = (newValue: unknown) => unknown;

interface CreatePluginSettingsDialogContentOptions {
  pluginId: string;
  api: DMNoteAPI;
  settingsDefinition: Record<string, PluginSettingSchema> | undefined;
  settings: Record<string, unknown>;
  modalScope: string;
  translate: Translate;
  createColorPickerId: (key: string) => string;
  onNormalizationError: (
    key: string,
    error: unknown,
    kind: SettingsNormalizationErrorKind,
  ) => void;
  onSettingValueChange: (
    key: string,
    value: PluginSettingValue,
    updateVisibility: () => void,
  ) => unknown;
  wrapSettingChange?: (handler: SettingChangeHandler) => SettingChangeHandler;
}

interface PluginSettingsDialogContent {
  htmlContent: string;
  confirmText: string;
  cancelText: string;
  dispose: () => void;
}

export const createPluginSettingsDialogContent = async ({
  pluginId,
  api,
  settingsDefinition,
  settings,
  modalScope,
  translate,
  createColorPickerId,
  onNormalizationError,
  onSettingValueChange,
  wrapSettingChange = (handler) => handler,
}: CreatePluginSettingsDialogContentOptions): Promise<PluginSettingsDialogContent> => {
  const getNormalizedSections = () =>
    normalizeSettingsSections(
      settingsDefinition,
      settings,
      onNormalizationError,
    );
  const findModalElement = (attribute: string, value: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
      (element) => element.getAttribute(attribute) === value,
    );
  const updateVisibility = () => {
    const sections = getNormalizedSections();
    sections.forEach((section, sectionIndex) => {
      const sectionElement = findModalElement(
        'data-settings-section',
        `${modalScope}-${sectionIndex}`,
      );
      if (sectionElement) {
        sectionElement.style.display = section.renderVisible ? '' : 'none';
      }
      section.entries.forEach((entry, entryIndex) => {
        const entryElement = findModalElement(
          'data-settings-entry',
          `${modalScope}-${sectionIndex}-${entryIndex}`,
        );
        if (entryElement) {
          entryElement.style.display = entry.renderVisible ? '' : 'none';
        }
      });
    });
    const emptyElement = findModalElement('data-settings-empty', modalScope);
    if (emptyElement) {
      emptyElement.style.display = sections.some(
        (section) => section.renderVisible,
      )
        ? 'none'
        : '';
    }
  };

  const modalHandlers = createPluginDialogHandlerScope();
  try {
    const normalizedSections = getNormalizedSections();
    // 패널(renderPluginSettingsForm)과 동일한 섹션 카드 구조·토큰 - section이
    // 없어도 암시적 카드 하나로 렌더 (모달-패널 외형 통합, 2026-07-12 결정)
    let htmlContent = '<div class="flex flex-col gap-[12px] w-full text-left">';

    for (const [sectionIndex, section] of normalizedSections.entries()) {
      htmlContent += `<div data-settings-section="${modalScope}-${sectionIndex}" style="${
        section.renderVisible ? '' : 'display:none'
      }" class="${SECTION_WRAPPER_CLASS}">`;
      if (section.label) {
        const sectionLabel = translate(section.label, undefined, section.label);
        htmlContent += `<p class="${SECTION_LABEL_CLASS}">${sectionLabel}</p>`;
      }
      htmlContent += `<div class="${SECTION_CARD_CLASS}">`;
      for (const [entryIndex, entry] of section.entries.entries()) {
        const { key, schema } = entry;
        const entryAttributes = `data-settings-entry="${modalScope}-${sectionIndex}-${entryIndex}" style="${
          entry.renderVisible ? '' : 'display:none'
        }"`;
        const value =
          settings[key] !== undefined ? settings[key] : schema.default;
        let componentHtml = '';
        const labelText = translate(schema.label, undefined, schema.label);
        const placeholderText =
          typeof schema.placeholder === 'string'
            ? translate(schema.placeholder, undefined, schema.placeholder)
            : schema.placeholder;

        const handleChange = wrapSettingChange((newValue) => {
          // DOM 문자열을 스키마 타입으로 복원, 복원 불가면 커밋 스킵
          const coerced = coerceSettingValue(schema, newValue);
          if (coerced === null) return;
          return onSettingValueChange(key, coerced, updateVisibility);
        });

        if (schema.type === 'boolean') {
          componentHtml = modalHandlers.capture(() =>
            api.ui.components.checkbox({
              checked: !!value,
              onChange: handleChange as unknown as (
                checked: boolean,
              ) => void | Promise<void>,
            }),
          );
        } else if (schema.type === 'color') {
          const handleColorClick = (event: Event) => {
            const target = (event.target as HTMLElement).closest('button');
            if (!target) return;

            const pickerId = createColorPickerId(key);

            if (
              window.__dmn_showColorPicker &&
              window.__dmn_getColorPickerState
            ) {
              const state = window.__dmn_getColorPickerState();
              if (state?.isOpen && state.id === pickerId) {
                window.__dmn_showColorPicker({
                  initialColor: state.color,
                  id: pickerId,
                });
                return;
              }
            }

            target.classList.add('shadow-focus-ring');

            api.ui.pickColor({
              initialColor: String(settings[key] ?? ''),
              id: pickerId,
              referenceElement: target as HTMLElement,
              onColorChange: (newColor) => {
                // 스와치(버튼 자체) 미리보기 업데이트
                target.style.setProperty('--dmn-color-swatch-color', newColor);
              },
              onColorChangeComplete: (newColor) => {
                handleChange(newColor);
              },
              onClose: () => {
                target.classList.remove('shadow-focus-ring');
              },
            });
          };

          const handlerId = modalHandlers.trackRegistryHandler(
            handlerRegistry.register(pluginId, handleColorClick),
          );

          // 패널 ColorInput과 동일한 스와치 단독 버튼
          componentHtml = `
              <button type="button"
                class="dmn-color-swatch-button w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
                style="--dmn-color-swatch-color: ${value}"
                data-plugin-handler="${handlerId}"
              >
                <span class="dmn-color-swatch-surface">
                  <span class="dmn-color-swatch-color"></span>
                  <span class="dmn-color-swatch-ring"></span>
                </span>
              </button>
            `;
        } else if (schema.type === 'string' || schema.type === 'number') {
          const strVal = String(value);
          let inputWidth: number;

          if (schema.type === 'number') {
            inputWidth = 60;
          } else {
            if (strVal.length <= 4) inputWidth = 60;
            else if (strVal.length <= 10) inputWidth = 100;
            else inputWidth = 200;
          }

          componentHtml = modalHandlers.capture(() =>
            api.ui.components.input({
              type:
                schema.type === 'string' ? 'text' : (schema.type as 'number'),
              value: value as string | number,
              onChange: handleChange as unknown as (
                value: string,
              ) => void | Promise<void>,
              min: schema.min,
              max: schema.max,
              step: schema.step,
              placeholder: placeholderText,
              width: inputWidth,
            }),
          );
        } else if (schema.type === 'select') {
          const translatedOptions = (schema.options || []).map(
            (option: { label: string; value: string }) => ({
              ...option,
              label: translate(option.label, undefined, option.label),
            }),
          );
          componentHtml = modalHandlers.capture(() =>
            api.ui.components.dropdown({
              options: translatedOptions,
              selected: value as string,
              onChange: handleChange as unknown as (
                value: string,
              ) => void | Promise<void>,
            }),
          );
        }

        htmlContent += `
            <div ${entryAttributes} class="${FORM_ROW_CLASS}">
              <p class="${FORM_LABEL_CLASS}">${labelText}</p>
              ${componentHtml}
            </div>
          `;
      }
      htmlContent += '</div></div>';
    }

    const noSettingsText = await api.settings
      .get()
      .then((settingsState) => {
        const locale = settingsState.language || 'ko';
        return locale === 'en'
          ? 'No settings available.'
          : '설정할 항목이 없습니다.';
      })
      .catch(() => '설정할 항목이 없습니다.');
    htmlContent += `<div data-settings-empty="${modalScope}" style="${
      normalizedSections.some((section) => section.renderVisible)
        ? 'display:none'
        : ''
    }" class="text-fg-faint text-body text-center">${noSettingsText}</div>`;

    htmlContent += '</div>';

    const [confirmText, cancelText] = await api.settings
      .get()
      .then((settingsState) => {
        const locale = settingsState.language || 'ko';
        return locale === 'en' ? ['Apply', 'Cancel'] : ['저장', '취소'];
      })
      .catch(() => ['저장', '취소']);

    return {
      htmlContent,
      confirmText,
      cancelText,
      dispose: modalHandlers.dispose,
    };
  } catch (error) {
    modalHandlers.dispose();
    throw error;
  }
};
