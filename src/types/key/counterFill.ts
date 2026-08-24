import type { KeyPosition } from './keys';
import {
  isStrictGradientSpec,
  toCompactRgba,
  type GradientSpec,
} from '../color';

export type CounterFillDescriptorV1 =
  | { color: string; gradient?: never }
  | { color: string; gradient: GradientSpec };

export type CounterFillPropertyPatchV1 =
  | { property: 'counterFillIdle'; value: CounterFillDescriptorV1 }
  | { property: 'counterFillActive'; value: CounterFillDescriptorV1 };

// stroke는 legacy string(단색 확정)과 descriptor를 모두 받는다 (api-contract v2 §4)
export type CounterStrokePatchValueV1 = string | CounterFillDescriptorV1;

export type CounterStrokePropertyPatchV1 =
  | { property: 'counterStrokeIdle'; value: CounterStrokePatchValueV1 }
  | { property: 'counterStrokeActive'; value: CounterStrokePatchValueV1 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);

export const isCounterFillDescriptorV1 = (
  value: unknown,
): value is CounterFillDescriptorV1 => {
  if (!isRecord(value) || typeof value.color !== 'string') return false;
  if (exactKeys(value, ['color'])) return true;
  return (
    exactKeys(value, ['color', 'gradient']) &&
    isStrictGradientSpec(value.gradient) &&
    toCompactRgba(value.gradient.stops[0]?.color ?? '#ffffff') === value.color
  );
};

export const isCounterFillPropertyPatchV1 = (
  value: unknown,
): value is CounterFillPropertyPatchV1 => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !('property' in value) ||
    !('value' in value)
  ) {
    return false;
  }
  return (
    (value.property === 'counterFillIdle' ||
      value.property === 'counterFillActive') &&
    isCounterFillDescriptorV1(value.value)
  );
};

export const projectCounterFillPatch = (
  position: KeyPosition,
  patch: CounterFillPropertyPatchV1,
): Partial<KeyPosition> => {
  const active = patch.property === 'counterFillActive';
  const descriptor = patch.value;
  const counter = position.counter;
  return {
    counter: {
      ...counter,
      fill: {
        ...counter.fill,
        [active ? 'active' : 'idle']: descriptor.color,
      },
      [active ? 'fillActiveGradient' : 'fillIdleGradient']:
        'gradient' in descriptor
          ? structuredClone(descriptor.gradient)
          : undefined,
    },
  };
};

export const isCounterStrokePatchValueV1 = (
  value: unknown,
): value is CounterStrokePatchValueV1 =>
  typeof value === 'string' || isCounterFillDescriptorV1(value);

export const isCounterStrokePropertyPatchV1 = (
  value: unknown,
): value is CounterStrokePropertyPatchV1 => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !('property' in value) ||
    !('value' in value)
  ) {
    return false;
  }
  return (
    (value.property === 'counterStrokeIdle' ||
      value.property === 'counterStrokeActive') &&
    isCounterStrokePatchValueV1(value.value)
  );
};

export const projectCounterStrokePatch = (
  position: KeyPosition,
  patch: CounterStrokePropertyPatchV1,
): Partial<KeyPosition> => {
  const active = patch.property === 'counterStrokeActive';
  const descriptor = patch.value;
  const counter = position.counter;
  // legacy string = 단색 확정(형제 필드 제거)
  const color = typeof descriptor === 'string' ? descriptor : descriptor.color;
  const gradient =
    typeof descriptor !== 'string' && 'gradient' in descriptor
      ? structuredClone(descriptor.gradient)
      : undefined;
  return {
    counter: {
      ...counter,
      stroke: {
        ...counter.stroke,
        [active ? 'active' : 'idle']: color,
      },
      [active ? 'strokeActiveGradient' : 'strokeIdleGradient']: gradient,
    },
  };
};
