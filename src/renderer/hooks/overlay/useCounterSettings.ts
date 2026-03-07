import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/key/keys';
import type { KeyCounterSettings } from '@src/types/key/keys';

export {
  computeOutsideStyle,
  OUTSIDE_OFFSET,
} from '@utils/counter/counterPositioning';

/**
 * Normalizes a raw counter config into a full `KeyCounterSettings` object.
 * Returns the default settings when the input is falsy.
 */
export function useCounterSettings(
  counter: unknown | undefined,
): KeyCounterSettings {
  if (counter) {
    return normalizeCounterSettings(counter);
  }
  return createDefaultCounterSettings();
}
