import type {
  ResolvedUiTheme,
  UiThemePreference,
} from '@src/types/settings/settings';

// 첫 페인트 전에 부트 스크립트가 읽는 키. windows/main/index.html과 같은 값을 쓴다
export const THEME_CACHE_KEY = 'dmn-ui-theme';

const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)';

type ThemeListener = (theme: ResolvedUiTheme) => void;

const listeners = new Set<ThemeListener>();

// 부트 스크립트가 첫 페인트 전에 html에 속성을 박는다. 여기서 그 값을 그대로
// 받아야 설정이 도착하기 전 첫 렌더에서도 문서와 어긋나지 않는다
const readDocumentTheme = (): ResolvedUiTheme => {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light'
    : 'dark';
};

let resolved: ResolvedUiTheme = readDocumentTheme();

export const getResolvedTheme = (): ResolvedUiTheme => resolved;

export const resolveTheme = (
  preference: UiThemePreference,
): ResolvedUiTheme => {
  if (preference === 'light' || preference === 'dark') return preference;
  try {
    return window.matchMedia(SYSTEM_LIGHT_QUERY).matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

/** system 선택일 때만 구독한다. 명시 선택은 OS 변경과 무관해야 한다 */
export const subscribeSystemTheme = (onChange: () => void): (() => void) => {
  let query: MediaQueryList;
  try {
    query = window.matchMedia(SYSTEM_LIGHT_QUERY);
  } catch {
    return () => {};
  }
  const handle = () => onChange();
  query.addEventListener('change', handle);
  return () => query.removeEventListener('change', handle);
};

export const cacheThemePreference = (preference: UiThemePreference) => {
  try {
    localStorage.setItem(THEME_CACHE_KEY, preference);
  } catch {
    // 저장소가 막혀도 이번 세션 적용에는 지장이 없다
  }
};

export const readCachedThemePreference = (
  fallback: UiThemePreference,
): UiThemePreference => {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    return cached === 'system' || cached === 'light' || cached === 'dark'
      ? cached
      : fallback;
  } catch {
    return fallback;
  }
};

/**
 * 문서 하나에 테마를 싣는다. 분리 패널 자식 문서도 같은 함수를 쓴다 -
 * 자식은 opener의 head 스타일 노드만 복제받고 html 속성은 물려받지 않는다
 */
export const applyThemeToDocument = (
  doc: Document,
  theme: ResolvedUiTheme,
  rootBackground?: string,
) => {
  doc.documentElement.setAttribute('data-theme', theme);
  const meta = doc.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', theme);
  if (rootBackground) {
    doc.documentElement.style.backgroundColor = rootBackground;
  }
};

/**
 * 메인 문서에 테마를 반영하고 구독자에게 알린다.
 *
 * 바탕색은 토큰에서 되읽는다 - 속성을 먼저 바꾸면 그 시점의 --ui-bg-app이
 * 이미 새 테마 값이다. 부트 스크립트만 값을 따로 갖는데, 그때는 번들 CSS가
 * 아직 없어서 토큰을 읽을 수단이 없다
 */
export const applyResolvedTheme = (theme: ResolvedUiTheme) => {
  resolved = theme;
  applyThemeToDocument(document, theme);
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue('--ui-bg-app')
    .trim();
  if (background) {
    document.documentElement.style.backgroundColor = background;
  }
  listeners.forEach((listener) => listener(theme));
};

/**
 * 테마 전환에 반응해야 하는 곳이 쓴다. 토큰을 한 번 읽어 캐시하거나
 * 캔버스에 직접 그려 둔 표면은 여기서 다시 그려야 한다
 */
export const subscribeResolvedTheme = (
  listener: ThemeListener,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
