import type { KeyPosition } from './keys';
import { toCompactRgba, type GradientSpec } from '../color';

export type CounterFillDescriptorV1 =
  | { color: string; gradient?: never }
  | { color: string; gradient: GradientSpec };

export type CounterFillPropertyPatchV1 =
  | { property: 'counterFillIdle'; value: CounterFillDescriptorV1 }
  | { property: 'counterFillActive'; value: CounterFillDescriptorV1 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);

const isStrictGradient = (value: unknown): value is GradientSpec => {
  if (!isRecord(value) || !exactKeys(value, ['angle', 'stops'])) return false;
  if (
    typeof value.angle !== 'number' ||
    !Number.isFinite(value.angle) ||
    Object.is(value.angle, -0) ||
    value.angle < 0 ||
    value.angle >= 360 ||
    !Array.isArray(value.stops) ||
    value.stops.length < 2 ||
    value.stops.length > 8
  ) {
    return false;
  }
  let previous = -Infinity;
  for (const stop of value.stops) {
    if (
      !isRecord(stop) ||
      !exactKeys(stop, ['color', 'pos']) ||
      typeof stop.color !== 'string' ||
      typeof stop.pos !== 'number' ||
      !Number.isFinite(stop.pos) ||
      Object.is(stop.pos, -0) ||
      stop.pos < 0 ||
      stop.pos > 1 ||
      stop.pos < previous
    ) {
      return false;
    }
    previous = stop.pos;
  }
  return true;
};

export const isCounterFillDescriptorV1 = (
  value: unknown,
): value is CounterFillDescriptorV1 => {
  if (!isRecord(value) || typeof value.color !== 'string') return false;
  if (exactKeys(value, ['color'])) return true;
  return (
    exactKeys(value, ['color', 'gradient']) &&
    isStrictGradient(value.gradient) &&
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
