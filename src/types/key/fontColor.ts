import type { KeyPosition } from './keys';

export type FontColorPropertyPatchV1 =
  | { property: 'fontColor'; value: string }
  | { property: 'activeFontColor'; value: string };

export const isFontColorPropertyPatchV1 = (
  value: unknown,
): value is FontColorPropertyPatchV1 => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    'property' in record &&
    'value' in record &&
    (record.property === 'fontColor' ||
      record.property === 'activeFontColor') &&
    typeof record.value === 'string'
  );
};

export const projectFontColorPatch = (
  position: KeyPosition,
  elementType: 'key' | 'stat' | 'graph' | 'knob',
  patch: FontColorPropertyPatchV1,
): Partial<KeyPosition> => {
  if (patch.property === 'activeFontColor') {
    return { activeFontColor: patch.value };
  }
  const shouldPreserveActive =
    (elementType === 'key' || elementType === 'knob') &&
    !position.activeFontColor?.trim() &&
    Boolean(position.fontColor?.trim());
  return {
    fontColor: patch.value,
    ...(shouldPreserveActive ? { activeFontColor: position.fontColor } : {}),
  };
};
