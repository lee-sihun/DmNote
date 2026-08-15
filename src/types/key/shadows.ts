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
  | { leaf: 'color'; value: string }
  | { leaf: 'offsetX'; value: number }
  | { leaf: 'offsetY'; value: number }
  | { leaf: 'blur'; value: number };

export type ElementShadowSemanticPatch =
  | { property: 'shadow'; value: ElementShadowValuePatch }
  | { property: 'activeShadow'; value: ElementShadowValuePatch }
  | { property: 'shadowEnabled'; value: boolean };

// 피커 다이얼이 만드는 단일 키 partial을 leaf wire로 변환
export const elementShadowLeafFromPartial = (
  partial: Partial<
    Pick<ElementShadowSpec, 'color' | 'offsetX' | 'offsetY' | 'blur'>
  >,
): ElementShadowValuePatch | null => {
  const keys = Object.keys(partial);
  if (keys.length !== 1) return null;
  if (partial.color !== undefined)
    return { leaf: 'color', value: partial.color };
  if (partial.offsetX !== undefined) {
    return { leaf: 'offsetX', value: partial.offsetX };
  }
  if (partial.offsetY !== undefined) {
    return { leaf: 'offsetY', value: partial.offsetY };
  }
  if (partial.blur !== undefined) return { leaf: 'blur', value: partial.blur };
  return null;
};

export const applyElementShadowLeaf = (
  spec: ElementShadowSpec,
  patch: ElementShadowValuePatch,
): ElementShadowSpec => {
  switch (patch.leaf) {
    case 'color':
      return { ...spec, color: patch.value };
    case 'offsetX':
      return { ...spec, offsetX: patch.value };
    case 'offsetY':
      return { ...spec, offsetY: patch.value };
    case 'blur':
      return { ...spec, blur: patch.value };
    default: {
      const exhaustive: never = patch;
      return exhaustive;
    }
  }
};

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
  if (patch.property === 'shadowEnabled') {
    return {
      shadow: { ...resolve(false), enabled: patch.value },
      ...(elementType === 'stat'
        ? {}
        : {
            activeShadow: {
              ...resolve(true),
              enabled: patch.value,
            },
          }),
    };
  }
  if (patch.property === 'activeShadow') {
    return { activeShadow: applyElementShadowLeaf(resolve(true), patch.value) };
  }
  return { shadow: applyElementShadowLeaf(resolve(false), patch.value) };
};
