/* eslint-disable react-hooks/refs */
import React, { useState, useRef, useId, useContext } from 'react';
import {
  useFloating,
  offset,
  flip,
  shift,
  arrow,
  autoUpdate,
} from '@floating-ui/react';
import { TooltipGroupContext } from './TooltipGroupContext';

interface FloatingTooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number; // hover 시 툴팁 표시 전 대기 시간 (ms)
  disabled?: boolean; // true일 때 툴팁 미표시
}

const FloatingTooltip = ({
  content,
  children,
  placement = 'top',
  delay = 500,
  disabled = false,
}: FloatingTooltipProps) => {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const group = useContext(TooltipGroupContext);

  const { x, y, refs, strategy, middlewareData } = useFloating({
    placement,
    middleware: [offset(8), flip(), shift(), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });

  // 포인터(마우스/터치) 클릭 시 focus 이벤트도 함께 발생.
  // 포인터 상호작용으로 툴팁을 닫은 후 focus 핸들러로 재오픈 방지.
  // 포인터 상호작용에 의한 focus 이벤트를 무시하기 위한 ref.
  const ignoreFocusRef = useRef(false);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
  };
  const handleClose = () => setOpen(false);

  // 열기 시 애니메이션 여부 추적 (그룹 내 첫 번째)
  const shouldAnimateOpenRef = useRef<boolean>(false);

  // hover 딜레이 타이머 ref
  const openTimerRef = useRef<number | null>(null);

  const startOpenTimer = () => {
    if (disabled) return;
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    const effectiveDelay = group?.getEffectiveDelay(delay) ?? delay;
    // 이번 열기의 애니메이션 여부 결정
    shouldAnimateOpenRef.current = !!group?.shouldAnimate?.();

    const finalizeOpen = () => {
      if (shouldAnimateOpenRef.current) {
        group?.consumeAnimation?.();
      }
      handleOpen();
    };

    if (effectiveDelay <= 0) {
      finalizeOpen();
      return;
    }
    openTimerRef.current = window.setTimeout(() => {
      finalizeOpen();
      openTimerRef.current = null;
    }, effectiveDelay) as unknown as number;
  };

  const cancelOpenTimer = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    // 대기 중 애니메이션 플래그 초기화
    shouldAnimateOpenRef.current = false;
  };

  const handlePointerDown = () => {
    // 대기 중 열기 타이머 취소, 다음 focus 무시 플래그 설정, 툴팁 닫기
    cancelOpenTimer();
    ignoreFocusRef.current = true;
    setOpen(false);
  };

  const handleFocus = () => {
    if (ignoreFocusRef.current) {
      // 포인터 상호작용에 의한 focus 소비 후 플래그 초기화
      ignoreFocusRef.current = false;
      return;
    }
    handleOpen();
  };

  // unmount 시 타이머 정리
  React.useEffect(() => {
    return () => {
      cancelOpenTimer();
    };
  }, []);

  const arrowX = middlewareData.arrow?.x ?? 0;
  const arrowY = middlewareData.arrow?.y ?? 0;

  const arrowStyle: React.CSSProperties = {};
  // placement에 "top-start" 등 변형 포함 가능, startsWith로 확인
  if (placement.startsWith('top')) {
    arrowStyle.left = `${arrowX}px`;
    arrowStyle.bottom = '-4px';
  } else if (placement.startsWith('bottom')) {
    arrowStyle.left = `${arrowX}px`;
    arrowStyle.top = '-4px';
  } else if (placement.startsWith('left')) {
    arrowStyle.top = `${arrowY}px`;
    arrowStyle.right = '-4px';
  } else {
    arrowStyle.top = `${arrowY}px`;
    arrowStyle.left = '-4px';
  }

  return (
    <>
      <div
        ref={refs.setReference}
        onMouseEnter={startOpenTimer}
        onMouseLeave={() => {
          cancelOpenTimer();
          handleClose();
        }}
        onPointerDown={handlePointerDown}
        onFocus={handleFocus}
        onBlur={handleClose}
        aria-describedby={open ? id : undefined}
        className="inline-flex"
      >
        {children}
      </div>
      {open && !disabled && (
        <div
          id={id}
          ref={refs.setFloating}
          role="tooltip"
          style={{
            position: strategy,
            top: y ?? 0,
            left: x ?? 0,
            zIndex: 90,
          }}
          className={
            shouldAnimateOpenRef.current ? 'tooltip-fade-in' : undefined
          }
        >
          <div className="bg-elevated text-fg text-caption px-[8px] py-[4px] rounded-md shadow-elevation-2 whitespace-nowrap">
            {content}
          </div>
          <div
            ref={arrowRef}
            style={arrowStyle}
            className="w-[8px] h-[8px] rotate-45 bg-elevated absolute pointer-events-none"
          />
        </div>
      )}
    </>
  );
};

export default FloatingTooltip;
