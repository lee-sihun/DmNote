import type { KeyPosition } from './keys';

export type FontColorPropertyPatchV1 =
  | { fontColor: string; activeFontColor?: never }
  | { fontColor?: never; activeFontColor: string };

export const isFontColorPropertyPatchV1 = (
  value: unknown,
): value is FontColorPropertyPatchV1 => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 1 &&
    ((keys[0] === 'fontColor' && typeof record.fontColor === 'string') ||
      (keys[0] === 'activeFontColor' &&
        typeof record.activeFontColor === 'string'))
  );
};

export const projectFontColorPatch = (
  position: KeyPosition,
  elementType: 'key' | 'stat' | 'graph' | 'knob',
  patch: FontColorPropertyPatchV1,
): Partial<KeyPosition> => {
  if ('activeFontColor' in patch) {
    return { activeFontColor: patch.activeFontColor };
  }
  const shouldPreserveActive =
    (elementType === 'key' || elementType === 'knob') &&
    !position.activeFontColor?.trim() &&
    Boolean(position.fontColor?.trim());
  return {
    fontColor: patch.fontColor,
    ...(shouldPreserveActive ? { activeFontColor: position.fontColor } : {}),
  };
};
