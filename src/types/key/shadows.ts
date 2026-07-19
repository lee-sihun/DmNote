import { z } from 'zod';

export const ELEMENT_SHADOW_CONSTRAINTS = {
  offset: { min: -100, max: 100 },
  blur: { min: 0, max: 100 },
} as const;

export const elementShadowSpecSchema = z.object({
  enabled: z.boolean(),
  color: z.string().min(1),
  offsetX: z
    .number()
    .finite()
    .min(ELEMENT_SHADOW_CONSTRAINTS.offset.min)
    .max(ELEMENT_SHADOW_CONSTRAINTS.offset.max),
  offsetY: z
    .number()
    .finite()
    .min(ELEMENT_SHADOW_CONSTRAINTS.offset.min)
    .max(ELEMENT_SHADOW_CONSTRAINTS.offset.max),
  blur: z
    .number()
    .finite()
    .min(ELEMENT_SHADOW_CONSTRAINTS.blur.min)
    .max(ELEMENT_SHADOW_CONSTRAINTS.blur.max),
});

export type ElementShadowSpec = z.infer<typeof elementShadowSpecSchema>;

export const elementShadowToCss = (shadow: ElementShadowSpec): string => {
  if (!shadow.enabled) return 'none';
  return `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`;
};

interface ResolveElementShadowOptions {
  active: boolean;
  shadow?: ElementShadowSpec;
  activeShadow?: ElementShadowSpec;
  defaultShadow: ElementShadowSpec;
  defaultActiveShadow: ElementShadowSpec;
  suppressDefault?: boolean;
}

export const resolveElementShadow = ({
  active,
  shadow,
  activeShadow,
  defaultShadow,
  defaultActiveShadow,
  suppressDefault = false,
}: ResolveElementShadowOptions): ElementShadowSpec => {
  const stored = active ? activeShadow : shadow;
  if (stored) return stored;
  if (suppressDefault) {
    // 억제 상태도 상태별 기본 스펙 기준 — 피커 초기 표시값이 상태와 일치
    return {
      ...(active ? defaultActiveShadow : defaultShadow),
      enabled: false,
    };
  }
  return active ? defaultActiveShadow : defaultShadow;
};
