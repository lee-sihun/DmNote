import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';

export type CounterAnimationKeyVisual = Partial<
  Omit<KeyElementPosition, 'dx' | 'dy' | 'width'>
> & {
  width?: number;
  displayName?: string;
  isStat?: boolean;
};

export const computeCounterAnimationPreviewKeyStyles = ({
  keyVisual,
  active,
  width,
  height,
}: {
  keyVisual?: CounterAnimationKeyVisual;
  active: boolean;
  width: number;
  height: number;
}) =>
  computeKeyElementStyles({
    position: {
      ...keyVisual,
      dx: 0,
      dy: 0,
      width,
      height,
    },
    active,
    label: keyVisual?.displayName || 'A',
  });
