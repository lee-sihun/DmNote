import { createElement } from 'react';
import htm from 'htm';

/**
 * CSS 문자열 style을 React CSSProperties 객체로 변환
 * htm 템플릿에서 style="color: red; font-size: 14px" 형태를 지원하기 위함
 */
function parseStyleString(
  styleStr: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const declaration of styleStr.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;
    const prop = declaration.slice(0, colonIndex).trim();
    const value = declaration.slice(colonIndex + 1).trim();
    if (!prop || !value) continue;
    // kebab-case → camelCase (e.g. font-size → fontSize)
    const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[camelProp] = value;
  }
  return result;
}

function wrappedCreateElement(
  type: string,
  props: Record<string, unknown> | null,
  ...children: React.ReactNode[]
) {
  if (props && typeof props.style === 'string') {
    props = { ...props, style: parseStyleString(props.style) };
  }
  return createElement(type, props, ...children);
}

export const html = htm.bind(wrappedCreateElement);

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
export const render = (_target: HTMLElement, _template: unknown) => {
  // React/Preact render 로직은 컴포넌트에서 처리
  // 마이그레이션 중 render() 호출 시 경고 또는 처리 필요
  // PluginElement.tsx에서 해당 render 함수 사용 제거 예정
  console.warn('templateEngine.render is deprecated. Use React rendering.');
};

export const svg = html; // htm이 svg 태그를 자연스럽게 처리
