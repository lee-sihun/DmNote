/**
 * 플러그인 UI 컴포넌트 유틸리티
 * 플러그인에서 사용할 수 있는 UI 컴포넌트 HTML 생성 함수들
 */

import { registerComponentHandler } from './pluginUtils';
import { FORM_ROW_CLASS, FORM_LABEL_CLASS } from '@utils/cardRecipes';
import { CANVAS_POPUP_CHROME_CLASS } from '@components/main/Modal/popupChrome';

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

  // 앱 버튼 관례와 동기 — primary=액센트 CTA, danger=muted 레드, secondary=회색 필
  const baseClass =
    'transition-colors duration-fast rounded-surface text-label';

  const variantClass = {
    primary:
      'bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active text-accent-fg',
    danger:
      'bg-danger-muted hover:bg-danger-muted-hover active:bg-danger-muted-active text-danger-fg',
    secondary: 'bg-fill hover:bg-fill-hover active:bg-fill-active text-fg',
  }[variant];

  const sizeClass = {
    small: 'h-[23px] px-[12px]',
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

  // 메인 UI Checkbox와 동일한 크기·토큰 (30x18, 액센트/line-strong 트랙, 14px 흰 노브)
  const bgClass = checked ? 'bg-accent' : 'bg-line-strong';
  const knobClass = checked ? 'left-[14px]' : 'left-[2px]';

  // 핸들러 처리: 함수면 등록, 문자열이면 레거시 방식
  let onChangeAttr = '';
  if (onChange) {
    if (typeof onChange === 'function') {
      const pluginId = getCurrentPluginId();
      // 토글 후 input에서 버블링되는 change 이벤트로 checked 전달 —
      // click 위임은 target이 label이라 checked를 읽을 수 없음
      const wrappedHandler = (e: Event) => {
        const target = e.target as HTMLInputElement;
        onChange(target.checked);
      };
      const handlerId = registerComponentHandler(pluginId, wrappedHandler);
      onChangeAttr = `data-plugin-handler-change="${handlerId}"`;
    } else {
      // 레거시 문자열 핸들러는 click 이벤트 계약 유지
      onChangeAttr = `data-plugin-handler="${onChange}"`;
    }
  }

  const labelIdAttr = id ? `id="${id}"` : '';
  const inputIdAttr = id ? `id="${id}-input"` : ''; // input에도 id 추가

  // 내부 input[type=checkbox] 추가 (실제 상태 유지)
  return `<label ${labelIdAttr} class="relative inline-block w-[30px] h-[18px] rounded-full cursor-pointer transition-colors duration-base ease-out-expo ${bgClass}" data-checkbox-toggle ${onChangeAttr}>
    <input type="checkbox" ${inputIdAttr} ${
    checked ? 'checked' : ''
  } class="absolute opacity-0 w-0 h-0" />
    <div class="absolute w-[14px] h-[14px] rounded-full top-[2px] bg-white shadow-elevation-1 transition-all duration-base ease-out-expo ${knobClass}"></div>
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

  return `<input ${idAttr} type="${type}" value="${escapedValue}" placeholder="${placeholder}" class="text-center h-[23px] bg-inset rounded-md text-body tabular-nums text-fg outline-none focus:shadow-focus-ring" style="width: ${width}px" ${minAttr} ${maxAttr} ${stepAttr} ${onBlurAttr} ${
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
    <button type="button" class="text-left w-full h-[23px] px-[8px] rounded-md text-body transition-colors duration-fast flex items-center ${
      selected === opt.value
        ? 'bg-fill-hover text-fg pointer-events-none'
        : 'text-fg-muted hover:bg-fill hover:text-fg'
    }" data-value="${opt.value}">
      <span class="truncate">${opt.label}</span>
    </button>
  `,
    )
    .join('');

  return `<div class="relative plugin-dropdown" ${idAttr} ${onChangeAttr} data-selected="${
    selected || ''
  }">
    <button type="button" class="flex items-center justify-between h-[23px] px-[8px] bg-fill hover:bg-fill-hover rounded-md text-fg text-body transition-colors duration-fast outline-none ${
      disabled ? 'opacity-40 pointer-events-none' : ''
    }" data-dropdown-toggle>
      <span class="truncate">${displayText}</span>
      <svg width="8" height="5" viewBox="0 0 14 8" fill="none" class="ml-[5px] shrink-0 text-fg-muted transition-transform duration-200">
        <path d="M1 1L7 7L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="hidden absolute left-0 top-[27px] flex-col p-[4px] gap-[4px] ${CANVAS_POPUP_CHROME_CLASS} rounded-surface z-20 overflow-x-hidden overflow-y-auto tooltip-fade-in" data-dropdown-menu>
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

  // Display Element 전용 캔버스 표면 (다이얼로그 내부 사용 금지 — 문서 계약)
  // 오버레이는 투명 배경이라 글래스 대신 불투명 surface, 반경은 팝업 계층
  return `<div class="bg-surface rounded-popup shadow-elevation-2 p-[12px] flex flex-col gap-[12px] text-left" ${widthStyle}>
    ${title ? `<div class="text-title text-fg">${title}</div>` : ''}
    ${content}
  </div>`;
}

/**
 * 폼 행 (라벨 + 컴포넌트) HTML 생성
 */
export function createFormRow(label: string, component: string): string {
  return `<div class="${FORM_ROW_CLASS}">
    <p class="${FORM_LABEL_CLASS}">${label}</p>
    ${component}
  </div>`;
}
