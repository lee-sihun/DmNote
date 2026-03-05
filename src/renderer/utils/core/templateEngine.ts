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

// uhtml 호환용 더미 함수
export const render = (_target: HTMLElement, _template: any) => {
  // React/Preact render 로직은 컴포넌트에서 처리
  // 마이그레이션 중 render() 호출 시 경고 또는 처리 필요
  // PluginElement.tsx에서 해당 render 함수 사용 제거 예정
  console.warn('templateEngine.render is deprecated. Use React rendering.');
};

export const svg = html; // htm이 svg 태그를 자연스럽게 처리
