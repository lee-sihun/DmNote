import React, { createContext, useMemo, useRef } from "react";

export type TooltipGroupContextType = {
  getEffectiveDelay: (baseDelay: number) => number;
  shouldAnimate: () => boolean;
  consumeAnimation: () => void;
};

export const TooltipGroupContext =
  createContext<TooltipGroupContextType | null>(null);

/**
 * TooltipGroup: Wrap a cluster of tooltip triggers so that
 * - The first hover within the group waits `delay` ms
 * - Moving between triggers within the group uses the remaining delay (often 0)
 * - Leaving the group resets the delay requirement
 */
export const TooltipGroup: React.FC<{
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, className, style }) => {
  // Timestamp when the pointer first entered the group; null means not inside
  const enteredAtRef = useRef<number | null>(null);
  // Whether first tooltip animation has been consumed within this enter
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

  const ctxValue = useMemo<TooltipGroupContextType>(
    () => ({
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
    }),
    []
  );

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
