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

export type ElementShadowValuePatch =
  | { color: string }
  | { offsetX: number }
  | { offsetY: number }
  | { blur: number };

export type ElementShadowSemanticPatch =
  | { shadow: ElementShadowValuePatch }
  | { activeShadow: ElementShadowValuePatch }
  | { shadowEnabled: boolean };

interface ElementShadowPosition {
  inactiveImage?: string;
  activeImage?: string;
  idleTransparent?: boolean;
  activeTransparent?: boolean;
  borderWidth?: number;
  shadow?: ElementShadowSpec;
  activeShadow?: ElementShadowSpec;
}

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

export const resolveElementShadowForPosition = ({
  position,
  active,
  elementType,
  defaultShadow,
  defaultActiveShadow,
}: {
  position: ElementShadowPosition;
  active: boolean;
  elementType: 'key' | 'stat' | 'knob';
  defaultShadow: ElementShadowSpec;
  defaultActiveShadow: ElementShadowSpec;
}): ElementShadowSpec => {
  const hasImage = Boolean(
    active
      ? position.activeImage?.trim() || position.inactiveImage?.trim()
      : position.inactiveImage?.trim(),
  );
  const suppressDefault =
    hasImage ||
    (elementType === 'knob' &&
      ((active
        ? position.activeTransparent === true
        : position.idleTransparent === true) ||
        (position.borderWidth ?? 0) > 0));
  return resolveElementShadow({
    active,
    shadow: position.shadow,
    activeShadow: position.activeShadow,
    defaultShadow,
    defaultActiveShadow,
    suppressDefault,
  });
};

export const projectElementShadowPatch = ({
  position,
  elementType,
  patch,
  defaultShadow,
  defaultActiveShadow,
}: {
  position: ElementShadowPosition;
  elementType: 'key' | 'stat' | 'knob';
  patch: ElementShadowSemanticPatch;
  defaultShadow: ElementShadowSpec;
  defaultActiveShadow: ElementShadowSpec;
}): Pick<ElementShadowPosition, 'shadow' | 'activeShadow'> => {
  const resolve = (active: boolean) =>
    resolveElementShadowForPosition({
      position,
      active,
      elementType,
      defaultShadow,
      defaultActiveShadow,
    });
  if ('shadowEnabled' in patch) {
    return {
      shadow: { ...resolve(false), enabled: patch.shadowEnabled },
      ...(elementType === 'stat'
        ? {}
        : {
            activeShadow: {
              ...resolve(true),
              enabled: patch.shadowEnabled,
            },
          }),
    };
  }
  if ('activeShadow' in patch) {
    return { activeShadow: { ...resolve(true), ...patch.activeShadow } };
  }
  return { shadow: { ...resolve(false), ...patch.shadow } };
};
