import React, { useRef } from 'react';
import { TooltipGroupContext } from './TooltipGroupContext';
import type { TooltipGroupContextType } from './TooltipGroupContext';

/**
 * TooltipGroup: 툴팁 트리거 그룹 래핑
 * - 그룹 내 첫 hover 시 `delay`ms 대기
 * - 그룹 내 트리거 간 이동 시 잔여 딜레이 사용 (보통 0)
 * - 그룹 이탈 시 딜레이 초기화
 */
export const TooltipGroup: React.FC<{
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, className, style }) => {
  // 그룹 최초 진입 시각; null이면 그룹 외부
  const enteredAtRef = useRef<number | null>(null);
  // 현재 진입에서 첫 툴팁 애니메이션 소비 여부
  const firstAnimationConsumedRef = useRef<boolean>(false);

  const onMouseEnter: React.MouseEventHandler<HTMLDivElement> = () => {
    if (enteredAtRef.current == null) {
      enteredAtRef.current = Date.now();
      firstAnimationConsumedRef.current = false;
    }
  };

  const onMouseLeave: React.MouseEventHandler<HTMLDivElement> = () => {
    enteredAtRef.current = null;
    firstAnimationConsumedRef.current = false;
  };

  const ctxValue: TooltipGroupContextType = {
    getEffectiveDelay(baseDelay: number) {
      const enteredAt = enteredAtRef.current;
      if (enteredAt == null) return baseDelay;
      const elapsed = Date.now() - enteredAt;
      const remaining = Math.max(0, baseDelay - elapsed);
      return remaining;
    },
    shouldAnimate() {
      return !firstAnimationConsumedRef.current;
    },
    consumeAnimation() {
      firstAnimationConsumedRef.current = true;
    },
  };

  return (
    <TooltipGroupContext.Provider value={ctxValue}>
      <div
        className={className}
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </div>
    </TooltipGroupContext.Provider>
  );
};
