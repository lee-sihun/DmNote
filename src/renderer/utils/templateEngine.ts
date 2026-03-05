import { createElement } from 'react';
import htm from 'htm';

export const html = htm.bind(createElement);

export function styleMap(
  styles: Record<string, string | number | undefined | null>,
): Record<string, string | number | undefined | null> {
  const result: Record<string, string | number | undefined | null> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (value != null && value !== '') {
      result[key] = value;
    }
  }
  return result;
}

export function css(
  strings: TemplateStringsArray,
  ...values: (string | number | undefined | null)[]
): string {
  return strings.reduce((acc, str, i) => {
    const value = values[i];
    return acc + str + (value != null ? value : '');
  }, '');
}

// uhtml 호환성을 위한 더미 함수
export const render = (target: HTMLElement, template: any) => {
  // React/Preact render logic should be handled in the component, not here.
  // But for migration, if some code calls render(), we might need to warn or handle it.
  // In PluginElement.tsx, we will remove usage of this render function.
  console.warn('templateEngine.render is deprecated. Use React rendering.');
};

export const svg = html; // htm handles svg tags naturally
