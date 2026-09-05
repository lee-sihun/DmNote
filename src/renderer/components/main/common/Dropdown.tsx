import React from 'react';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import { useDropdownRuntime, type DropdownOption } from './useDropdownRuntime';

interface DropdownProps {
  options: DropdownOption[];
  /** 단일 모드 선택 값 (다중 모드에서는 미사용) */
  value?: string;
  onChange: (value: string) => void;
  commitStrategy?: CommitStrategy;
  placeholder?: string;
  disabled?: boolean;
  /** true일 경우 드롭다운이 부모 컨테이너의 전체 너비를 차지함 */
  fullWidth?: boolean;
  /** 아이콘 트리거 모드: 설정 시 버튼이 아이콘으로 표시됨 */
  iconTrigger?: React.ReactNode;
  /** 메뉴 수평 정렬 (기본: left) — right는 트리거가 우측 가장자리에 붙은 자리용 */
  align?: 'left' | 'right';
  /** 트리거/메뉴 너비 고정용 Tailwind 클래스 (예: 'w-[160px]'). 길면 말줄임(...) 처리됨 */
  widthClass?: string;
  /** 아이콘 트리거의 접근 가능한 이름 - 아이콘만 있는 버튼은 용도·현재 값이 안 읽힌다 */
  ariaLabel?: string;
  /** 트리거 크기 - sm: 23px 크롬(기본), lg: 30px 크롬(패널 페이지) */
  size?: 'sm' | 'lg';
  /** 다중 선택 모드: 항목 클릭이 메뉴를 닫지 않는 토글이 되고 onChange가 토글된 값을 받음 */
  multiple?: boolean;
  /** 다중 모드의 선택 값 목록, 체크 표시와 트리거 요약의 기준 */
  values?: string[];
  /** 현재 값이 충돌 상태 - 트리거 요약을 danger 톤으로 표시 */
  danger?: boolean;
  /** danger 상태에서 요약 대신 표시할 짧은 라벨 (긴 요약·번역 잘림 방지) */
  dangerLabel?: string;
  /** 트리거 툴팁 (충돌 사유 등) */
  title?: string;
}

const Dropdown: React.FC<DropdownProps> = ({
  options,
  value = '',
  onChange,
  commitStrategy = 'sync',
  placeholder = '선택',
  disabled = false,
  fullWidth = false,
  iconTrigger,
  align = 'left',
  widthClass = '',
  size = 'sm',
  ariaLabel,
  multiple = false,
  values,
  danger = false,
  dangerLabel,
  title,
}) => {
  const {
    buttonRef,
    handleTriggerKeyDown,
    menu,
    menuId,
    open,
    ref,
    toggleOpen,
    triggerText,
  } = useDropdownRuntime({
    options,
    value,
    onChange,
    commitStrategy,
    disabled,
    fullWidth,
    align,
    widthClass,
    multiple,
    values,
  });
  return (
    <div
      ref={ref}
      className={`relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {iconTrigger ? (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={ariaLabel}
          className={`flex items-center justify-center w-[23px] h-[23px] rounded-md cursor-pointer bg-fill hover:bg-fill-hover transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          }`}
          onClick={toggleOpen}
          onKeyDown={handleTriggerKeyDown}
          disabled={disabled}
        >
          {iconTrigger}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          title={title}
          className={`flex box-border items-center justify-between ${
            size === 'lg'
              ? 'h-[30px] px-[10px] rounded-surface'
              : 'h-[23px] px-[8px] rounded-md'
          } bg-fill hover:bg-fill-hover text-fg text-body transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          } ${fullWidth ? 'w-full' : ''} ${widthClass}`}
          onClick={toggleOpen}
          onKeyDown={handleTriggerKeyDown}
          disabled={disabled}
        >
          <span
            className={`truncate ${
              triggerText === null ? 'text-fg-muted' : ''
            } ${danger ? 'text-danger-fg' : ''}`}
          >
            {danger && dangerLabel ? dangerLabel : triggerText ?? placeholder}
          </span>
          {/* viewBox 14를 8px로 렌더 - 스트로크 2.1이 화면상 1.2 */}
          <svg
            width="8"
            height="5"
            viewBox="0 0 14 8"
            fill="none"
            className={`ml-[5px] shrink-0 text-fg-muted transition-transform duration-base ease-out-expo ${
              open ? 'rotate-180' : 'rotate-0'
            }`}
          >
            <path
              d="M1 1L7 7L13 1"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {menu}
    </div>
  );
};

export default Dropdown;
