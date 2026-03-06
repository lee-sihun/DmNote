import { createContext } from 'react';

export type TooltipGroupContextType = {
  getEffectiveDelay: (baseDelay: number) => number;
  shouldAnimate: () => boolean;
  consumeAnimation: () => void;
};

export const TooltipGroupContext =
  createContext<TooltipGroupContextType | null>(null);
