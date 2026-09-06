/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TextInputProps } from '../types';
import { registerEditorDraftForLifecycle } from '@src/renderer/editor/runtime/lifecycle/lifecycleEditorDraft';
import { useAfterPaintValueCommit } from '@hooks/useAfterPaintValueCommit';

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  commitStrategy = 'after-paint',
  onBlur,
  onPreview,
  onCancel,
  placeholder,
  width = '90px',
  isMixed = false,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  // Escape로 blur된 경우 확정 없이 원복
  const escapedRef = useRef(false);
  const previewedRef = useRef(false);
  // 이번 편집에서 값을 내보냈는지. 되돌릴 게 없으면 취소가 호출부를 건드리면 안 된다
  const emittedRef = useRef(false);
  const committedValueRef = useRef(value);
  const committedMixedRef = useRef(isMixed);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionActiveRef = useRef(false);
  const unregisterLifecycleRef = useRef<(() => void) | null>(null);
  const finalizeRef = useRef<(finalValue: string) => void>(() => undefined);
  const liveCommit = onPreview ?? onChange;
  const { scheduleCommit, flushPendingCommit, cancelPendingCommit } =
    useAfterPaintValueCommit<string>({
      onCommit: liveCommit,
      strategy: commitStrategy,
      frameHostRef: inputRef,
    });

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value);
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    if (onPreview) previewedRef.current = true;
    emittedRef.current = true;
    scheduleCommit(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter는 blur를 통해 확정, Escape는 확정 없이 원복
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      // 되돌릴 게 있을 때만 이 필드가 Escape를 소비한다.
      // 팝업과 모달은 defaultPrevented로 한 겹씩 닫으므로, 손대지 않은 필드가 삼키면
      // 첫 Escape에 창이 안 닫힌다
      if (emittedRef.current) e.preventDefault();
      escapedRef.current = true;
      e.currentTarget.blur();
    }
  };

  const clearLifecycleRegistration = () => {
    unregisterLifecycleRef.current?.();
    unregisterLifecycleRef.current = null;
  };

  const finalize = (finalValue: string) => {
    if (!sessionActiveRef.current) return;
    sessionActiveRef.current = false;
    clearLifecycleRegistration();
    setIsFocused(false);
    if (escapedRef.current) {
      escapedRef.current = false;
      cancelPendingCommit();
      previewedRef.current = false;
      setLocalValue(committedValueRef.current);
      // 취소는 값을 내보낸 것과 같은 채널로 되돌린다. onPreview가 없는 입력은
      // 타이핑이 onChange로 이미 저장까지 갔으므로 되돌릴 길이 그것뿐이다.
      // Mixed는 되돌릴 값이 하나가 아니라 대표값을 쓰면 요소별 값이 사라진다
      // 취소 의미이므로 commit 성격의 onBlur는 호출하지 않음
      if (onCancel) {
        onCancel();
      } else if (emittedRef.current && !committedMixedRef.current && !isMixed) {
        (onPreview ?? onChange)(committedValueRef.current);
      }
      emittedRef.current = false;
      return;
    }
    // 확정은 입력 컴포넌트의 최종값 기준 (부모 store 재조회 금지)
    if (onPreview && previewedRef.current) {
      cancelPendingCommit();
      onChange(finalValue);
    } else {
      flushPendingCommit();
    }
    previewedRef.current = false;
    emittedRef.current = false;
    onBlur?.(finalValue);
  };

  useLayoutEffect(() => {
    finalizeRef.current = finalize;
  });

  useEffect(
    () => () => {
      sessionActiveRef.current = false;
      clearLifecycleRegistration();
    },
    [],
  );

  const handleFocus = () => {
    setIsFocused(true);
    escapedRef.current = false;
    previewedRef.current = false;
    emittedRef.current = false;
    committedValueRef.current = value;
    committedMixedRef.current = isMixed;
    sessionActiveRef.current = true;
    clearLifecycleRegistration();
    unregisterLifecycleRef.current = registerEditorDraftForLifecycle(() => {
      finalizeRef.current(inputRef.current?.value ?? value);
    });
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    finalize(event.currentTarget.value);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={localValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={`text-center h-[23px] p-[6px] bg-inset rounded-md ${
        isFocused ? 'shadow-focus-ring' : ''
      } text-body tabular-nums ${
        isMixed
          ? 'text-fg placeholder:text-fg-faint placeholder:italic'
          : 'text-fg'
      }`}
      style={{ width }}
    />
  );
};
