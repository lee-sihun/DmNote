/**
 * 플러그인 UI 컴포넌트 유틸리티
 * 플러그인에서 사용할 수 있는 UI 컴포넌트 HTML 생성 함수들
 */

import { registerComponentHandler } from './pluginUtils';

/**
 * 현재 실행 중인 플러그인 ID를 가져옵니다.
 */
function getCurrentPluginId(): string {
  return window.__dmn_current_plugin_id || 'unknown';
}

export interface ButtonOptions {
  variant?: 'primary' | 'danger' | 'secondary';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: string | (() => void | Promise<void>);
  id?: string;
}

export interface CheckboxOptions {
  checked?: boolean;
  onChange?: string | ((checked: boolean) => void | Promise<void>);
  id?: string;
}

export interface InputOptions {
  type?: 'text' | 'number' | 'color';
  placeholder?: string;
  value?: string | number;
  disabled?: boolean;
  onInput?: string | ((value: string) => void | Promise<void>);
  onChange?: string | ((value: string) => void | Promise<void>);
  id?: string;
  width?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface DropdownOption {
  label: string;
  value: string;
}

export interface DropdownOptions {
  options: DropdownOption[];
  selected?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: string | ((value: string) => void | Promise<void>);
  id?: string;
}

export interface PanelOptions {
  title?: string;
  width?: number;
}

/**
 * 버튼 HTML 생성
 */
export function createButton(
  text: string,
  options: ButtonOptions = {},
): string {
  const {
    variant = 'primary',
    size = 'medium',
    disabled = false,
    fullWidth = false,
    onClick,
    id = '',
  } = options;

  const baseClass = 'transition-colors rounded-[7px] text-style-3';

  const variantClass = {
    primary:
      'bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] text-[#DCDEE7]',
    danger:
      'bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] text-[#E6DBDB]',
    secondary:
      'bg-[#2A2A31] border-[1px] border-[#3A3944] text-[#DBDEE8] hover:bg-[#34343c]',
  }[variant];

  const sizeClass = {
    small: 'h-[24px] px-[12px]',
    medium: 'h-[30px] px-[16px]',
    large: 'h-[36px] px-[20px]',
  }[size];

  const widthClass = fullWidth
    ? 'w-full'
    : variant === 'danger'
    ? 'w-[75px]'
    : 'w-[150px]';

  const disabledClass = disabled
    ? 'opacity-50 cursor-not-allowed pointer-events-none'
    : '';

  // 핸들러 처리: 함수면 등록, 문자열이면 레거시 방식
  let onClickAttr = '';
  if (onClick) {
    if (typeof onClick === 'function') {
      const pluginId = getCurrentPluginId();
      const handlerId = registerComponentHandler(pluginId, onClick);
      onClickAttr = `data-plugin-handler="${handlerId}"`;
    } else {
      onClickAttr = `data-plugin-handler="${onClick}"`;
    }
  }

  const idAttr = id ? `id="${id}"` : '';

  return `<button type="button" class="${baseClass} ${variantClass} ${sizeClass} ${widthClass} ${disabledClass}" ${onClickAttr} ${idAttr} ${
    disabled ? 'disabled' : ''
  }>${text}</button>`;
}

/**
 * 체크박스 (토글) HTML 생성
 */
export function createCheckbox(options: CheckboxOptions = {}): string {
  const { checked = false, onChange, id = '' } = options;

  const bgClass = checked ? 'bg-[#493C1D]' : 'bg-[#3B4049]';
  const knobClass = checked
    ? 'left-[13px] bg-[#FFB400]'
    : 'left-[2px] bg-[#989BA6]';

  // 핸들러 처리: 함수면 등록, 문자열이면 레거시 방식
  let onChangeAttr = '';
  if (onChange) {
    if (typeof onChange === 'function') {
      const pluginId = getCurrentPluginId();
      // 체크박스는 checked 상태를 전달
      const wrappedHandler = (e: Event) => {
        const target = e.target as HTMLInputElement;
        onChange(target.checked);
      };
      const handlerId = registerComponentHandler(pluginId, wrappedHandler);
      onChangeAttr = `data-plugin-handler="${handlerId}"`;
    } else {
      onChangeAttr = `data-plugin-handler="${onChange}"`;
    }
  }

  const labelIdAttr = id ? `id="${id}"` : '';
  const inputIdAttr = id ? `id="${id}-input"` : ''; // input에도 id 추가

  // 내부 input[type=checkbox] 추가 (실제 상태 유지)
  return `<label ${labelIdAttr} class="relative inline-block w-[27px] h-[16px] rounded-[75px] cursor-pointer transition-colors duration-75 ${bgClass}" data-checkbox-toggle ${onChangeAttr}>
    <input type="checkbox" ${inputIdAttr} ${
    checked ? 'checked' : ''
  } class="absolute opacity-0 w-0 h-0" />
    <div class="absolute w-[12px] h-[12px] rounded-[75px] top-[2px] transition-all duration-75 ease-in-out ${knobClass}"></div>
  </label>`;
}

/**
 * 인풋 필드 HTML 생성
 */
export function createInput(options: InputOptions = {}): string {
  const {
    type = 'text',
    placeholder = '',
    value = '',
    disabled = false,
    onInput,
    onChange,
    id = '',
    width = 200,
    min,
    max,
    step,
  } = options;

  // onInput 핸들러 처리
  let onInputAttr = '';
  if (onInput) {
    if (typeof onInput === 'function') {
      const pluginId = getCurrentPluginId();
      const wrappedHandler = (e: Event) => {
        const target = e.target as HTMLInputElement;
        onInput(target.value);
      };
      const handlerId = registerComponentHandler(pluginId, wrappedHandler);
      onInputAttr = `data-plugin-handler-input="${handlerId}"`;
    } else {
      onInputAttr = `data-plugin-handler-input="${onInput}"`;
    }
  }

  // onChange 핸들러 처리
  let onChangeAttr = '';
  if (onChange) {
    if (typeof onChange === 'function') {
      const pluginId = getCurrentPluginId();
      const wrappedHandler = (e: Event) => {
        const target = e.target as HTMLInputElement;
        onChange(target.value);
      };
      const handlerId = registerComponentHandler(pluginId, wrappedHandler);
      onChangeAttr = `data-plugin-handler-change="${handlerId}"`;
    } else {
      onChangeAttr = `data-plugin-handler-change="${onChange}"`;
    }
  }

  const idAttr = id ? `id="${id}"` : '';
  const minAttr = min !== undefined ? `min="${min}"` : '';
  const maxAttr = max !== undefined ? `max="${max}"` : '';
  const stepAttr = step !== undefined ? `step="${step}"` : '';

  // onBlur 핸들러: type="number"이고 min/max가 설정된 경우 자동 정규화
  const onBlurAttr =
    type === 'number' && (min !== undefined || max !== undefined)
      ? `data-plugin-input-blur="true" data-plugin-input-min="${
          min ?? ''
        }" data-plugin-input-max="${max ?? ''}"`
      : '';

  // value를 안전하게 처리 (undefined, null, 객체 등 방지)
  const safeValue = value === undefined || value === null ? '' : String(value);
  // HTML 속성에서 안전하게 사용하기 위해 특수문자 이스케이프
  const escapedValue = safeValue
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<input ${idAttr} type="${type}" value="${escapedValue}" placeholder="${placeholder}" class="text-center px-[8px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8] outline-none" style="width: ${width}px" ${minAttr} ${maxAttr} ${stepAttr} ${onBlurAttr} ${
    disabled ? 'disabled' : ''
  } ${onInputAttr} ${onChangeAttr} />`;
}

/**
 * 드롭다운 HTML 생성
 */
export function createDropdown(options: DropdownOptions): string {
  const {
    options: items,
    selected = '',
    placeholder = '선택',
    disabled = false,
    onChange,
    id = '',
  } = options;

  const selectedItem = items.find((opt) => opt.value === selected);
  const displayText = selectedItem ? selectedItem.label : placeholder;

  const idAttr = id ? `id="${id}"` : '';

  // 핸들러 처리: 함수면 등록, 문자열이면 레거시 방식
  let onChangeAttr = '';
  if (onChange) {
    if (typeof onChange === 'function') {
      const pluginId = getCurrentPluginId();
      // 드롭다운은 선택된 value를 전달
      const wrappedHandler = (e: Event) => {
        const target = e.target as HTMLElement;
        const value = target.getAttribute('data-selected') || '';
        onChange(value);
      };
      const handlerId = registerComponentHandler(pluginId, wrappedHandler);
      onChangeAttr = `data-plugin-handler-change="${handlerId}"`;
    } else {
      onChangeAttr = `data-plugin-handler-change="${onChange}"`;
    }
  }

  const itemsHtml = items
    .map(
      (opt) => `
    <button type="button" class="text-left w-full h-[24px] px-[8px] rounded-md text-body transition-colors duration-fast flex items-center ${
      selected === opt.value
        ? 'bg-surface-active text-fg pointer-events-none'
        : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
    }" data-value="${opt.value}">
      <span class="truncate">${opt.label}</span>
    </button>
  `,
    )
    .join('');

  return `<div class="relative plugin-dropdown" ${idAttr} ${onChangeAttr} data-selected="${
    selected || ''
  }">
    <button type="button" class="flex items-center justify-between h-[24px] px-[8px] bg-fill hover:bg-fill-hover rounded-md text-fg text-body transition-colors duration-fast outline-none ${
      disabled ? 'opacity-40 pointer-events-none' : ''
    }" data-dropdown-toggle>
      <span class="truncate">${displayText}</span>
      <svg width="8" height="5" viewBox="0 0 14 8" fill="none" class="ml-[5px] shrink-0 text-fg-muted transition-transform duration-200">
        <path d="M1 1L7 7L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="hidden absolute left-0 top-[28px] flex-col p-[4px] gap-[4px] bg-glass backdrop-blur-[24px] rounded-surface shadow-elevation-2 z-20 overflow-x-hidden overflow-y-auto tooltip-fade-in" data-dropdown-menu>
      ${itemsHtml}
    </div>
  </div>`;
}

/**
 * 패널 컨테이너 HTML 생성
 */
export function createPanel(
  content: string,
  options: PanelOptions = {},
): string {
  const { title = '', width } = options;
  const widthStyle = width ? `style="width: ${width}px"` : '';

  return `<div class="bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px] flex flex-col gap-[16px]" ${widthStyle}>
    ${title ? `<div class="text-style-3 text-[#FFFFFF]">${title}</div>` : ''}
    ${content}
  </div>`;
}

/**
 * 폼 행 (라벨 + 컴포넌트) HTML 생성
 */
export function createFormRow(label: string, component: string): string {
  return `<div class="flex justify-between w-full items-center">
    <p class="text-white text-style-2">${label}</p>
    ${component}
  </div>`;
}
