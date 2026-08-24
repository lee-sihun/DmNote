import type { FontStyleToggleProps } from './types';

type FontStyleProperty =
  | 'fontBold'
  | 'fontItalic'
  | 'fontUnderline'
  | 'fontStrikethrough';

export const createFontStyleToggleHandlers = (
  onChange: (property: FontStyleProperty, value: number | boolean) => void,
): Pick<
  FontStyleToggleProps,
  | 'onBoldChange'
  | 'onItalicChange'
  | 'onUnderlineChange'
  | 'onStrikethroughChange'
> => ({
  onBoldChange: (value) => onChange('fontBold', value),
  onItalicChange: (value) => onChange('fontItalic', value),
  onUnderlineChange: (value) => onChange('fontUnderline', value),
  onStrikethroughChange: (value) => onChange('fontStrikethrough', value),
});
