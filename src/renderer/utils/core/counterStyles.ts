import type React from 'react';

interface CounterTypographyOptions {
  fontSize?: number;
  fontFamily?: string | null;
  fontWeight?: number;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  lineHeight?: React.CSSProperties['lineHeight'];
  useInlineStyles?: boolean;
}

export const getCounterTypographyStyle = ({
  fontSize,
  fontFamily,
  fontWeight,
  fontItalic,
  fontUnderline,
  fontStrikethrough,
  lineHeight = 'normal',
  useInlineStyles = false,
}: CounterTypographyOptions): React.CSSProperties => {
  const decorations: string[] = [];
  if (fontUnderline) decorations.push('underline');
  if (fontStrikethrough) decorations.push('line-through');

  const resolvedFontSize = `${Number.isFinite(fontSize) ? fontSize : 16}px`;
  const resolvedFontFamily = fontFamily
    ? `"${fontFamily}", "Pretendard Variable", sans-serif`
    : 'inherit';
  const resolvedFontWeight = Number.isFinite(fontWeight) ? fontWeight : 400;
  const resolvedFontStyle = fontItalic ? 'italic' : 'normal';
  const resolvedTextDecoration =
    decorations.length > 0 ? decorations.join(' ') : 'none';

  if (useInlineStyles) {
    return {
      fontSize: resolvedFontSize,
      fontFamily: resolvedFontFamily,
      fontWeight: resolvedFontWeight,
      fontStyle: resolvedFontStyle,
      textDecoration: resolvedTextDecoration,
      textAlign: 'center',
      lineHeight,
      // 카운터 굵기 폴백 변수 - inline 모드에서도 공급
      '--dmn-counter-font-weight-default': String(resolvedFontWeight),
    } as React.CSSProperties;
  }

  return {
    '--dmn-counter-font-size-default': resolvedFontSize,
    '--dmn-counter-font-family-default': resolvedFontFamily,
    '--dmn-counter-font-weight-default': String(resolvedFontWeight),
    '--dmn-counter-font-style-default': resolvedFontStyle,
    '--dmn-counter-text-decoration-default': resolvedTextDecoration,
    '--dmn-counter-text-align-default': 'center',
    '--dmn-counter-line-height-default': String(lineHeight),
  } as React.CSSProperties;
};
