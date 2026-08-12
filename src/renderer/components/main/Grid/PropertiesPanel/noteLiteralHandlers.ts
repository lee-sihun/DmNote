import type { KeyPosition } from '@src/types/key/keys';

export type NoteAlignmentValue = 'left' | 'center' | 'right';
export type NoteBorderSideValue = 'all' | 'vertical' | 'horizontal';

interface NoteLiteralValues {
  noteEffectEnabled: boolean;
  noteAutoYCorrection: boolean;
  noteGlowEnabled: boolean;
}

export const createNoteLiteralHandlers = (
  values: NoteLiteralValues,
  onChange: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void,
) => ({
  toggleEffect: () => onChange('noteEffectEnabled', !values.noteEffectEnabled),
  toggleAutoYCorrection: () =>
    onChange('noteAutoYCorrection', !values.noteAutoYCorrection),
  toggleGlow: () => onChange('noteGlowEnabled', !values.noteGlowEnabled),
  setAlignment: (value: NoteAlignmentValue) => onChange('noteAlignment', value),
  setBorderSide: (value: NoteBorderSideValue) =>
    onChange('noteBorderSide', value),
});
