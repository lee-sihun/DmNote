import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefCallback,
} from "react";

const DEFAULT_DURATION_MS = 300;

export type RestartableAnimationPhase = "a" | "b";

export interface RestartableCssAnimationOptions {
  enabled?: boolean;
  durationMs?: number;
  durationCssVar?: `--${string}`;
  phaseDataAttribute?: `data-${string}`;
  activeClassName?: string;
}

export interface RestartableCssAnimationResult {
  ref: RefCallback<HTMLElement>;
  className: string;
  style: CSSProperties | undefined;
}

const createDurationStyle = (
  cssVar: `--${string}`,
  durationMs: number,
): CSSProperties => {
  return {
    [cssVar]: `${Math.max(durationMs, 1)}ms`,
  } as CSSProperties;
};

/**
 * Restarts a CSS animation whenever the tracked value changes.
 * Phase toggling(A/B) allows immediate restart while an animation is playing.
 */
export const useRestartableCssAnimation = (
  value: unknown,
  {
    enabled = true,
    durationMs = DEFAULT_DURATION_MS,
    durationCssVar = "--animation-duration",
    phaseDataAttribute = "data-animation-phase",
    activeClassName = "",
  }: RestartableCssAnimationOptions = {},
): RestartableCssAnimationResult => {
  const elementRef = useRef<HTMLElement | null>(null);
  const previousValueRef = useRef(value);
  const phaseRef = useRef<RestartableAnimationPhase>("a");

  const ref = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      elementRef.current = node;
    },
    [],
  );

  useEffect(() => {
    if (Object.is(previousValueRef.current, value)) {
      return;
    }

    previousValueRef.current = value;

    if (!enabled) {
      return;
    }

    const node = elementRef.current;
    if (!node) {
      return;
    }

    phaseRef.current = phaseRef.current === "a" ? "b" : "a";
    node.setAttribute(phaseDataAttribute, phaseRef.current);
  }, [value, enabled, phaseDataAttribute]);

  useEffect(() => {
    if (enabled) {
      return;
    }

    const node = elementRef.current;
    if (!node) {
      return;
    }

    node.removeAttribute(phaseDataAttribute);
  }, [enabled, phaseDataAttribute]);

  return useMemo(() => {
    return {
      ref,
      className: enabled ? activeClassName : "",
      style: enabled ? createDurationStyle(durationCssVar, durationMs) : undefined,
    };
  }, [ref, enabled, durationCssVar, durationMs, activeClassName]);
};
