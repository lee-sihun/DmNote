import { useEffect, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { TabCssOverrides } from '@src/types/plugin/css';
import type { CustomCss } from '@src/types/plugin/css';

const STYLE_ELEMENT_ID = 'dmn-custom-css';

/**
 * CSS 적용 우선순위:
 * 1. 전역 CSS OFF → 모든 CSS 미적용 (탭 설정 무시)
 * 2. 전역 CSS ON + 탭 enabled=false → CSS 미적용
 * 3. 전역 CSS ON + 탭 enabled=true + 로컬 파일 있음 → 탭 CSS 적용
 * 4. 전역 CSS ON + (탭 설정 없음 또는 로컬 파일 없음) → 전역 CSS 적용
 */
export function useCustomCssInjection() {
  // 상태 캐싱 ref
  const globalCssRef = useRef<CustomCss>({ path: null, content: '' });
  const globalUseRef = useRef<boolean>(false);
  const tabCssOverridesRef = useRef<TabCssOverrides>({});
  const styleElRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    // 스타일 요소 생성/재사용
    let styleEl = document.getElementById(
      STYLE_ELEMENT_ID,
    ) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ELEMENT_ID;
      document.head.appendChild(styleEl);
    }
    styleElRef.current = styleEl;

    /**
     * 현재 탭에 적용할 CSS 결정 및 적용
     */
    const applyCssForCurrentTab = () => {
      const styleEl = styleElRef.current;
      if (!styleEl) return;

      const currentTab = useKeyStore.getState().selectedKeyType;
      const tabCss = tabCssOverridesRef.current[currentTab];
      const globalCss = globalCssRef.current;
      const globalUse = globalUseRef.current;

      // 1. 전역 CSS OFF → 모든 CSS 미적용
      if (!globalUse) {
        styleEl.textContent = '';
        styleEl.disabled = true;
        return;
      }

      // 2. 전역 ON + 탭 설정이 있는 경우
      if (tabCss) {
        // 탭 enabled=false → CSS 미적용
        if (!tabCss.enabled) {
          styleEl.textContent = '';
          styleEl.disabled = true;
          return;
        }

        // 탭 enabled=true이고 로컬 파일 있음 → 탭 CSS 적용
        if (tabCss.path && tabCss.content) {
          styleEl.textContent = tabCss.content;
          styleEl.disabled = false;
          return;
        }
      }

      // 3. 전역 CSS 적용 (탭 설정 없거나 로컬 파일 없음)
      if (globalCss.content) {
        styleEl.textContent = globalCss.content;
        styleEl.disabled = false;
      } else {
        styleEl.textContent = '';
        styleEl.disabled = true;
      }
    };

    // 초기 데이터 로드
    const initPromises = [
      window.api.css.get().then((data) => {
        globalCssRef.current = data;
      }),
      window.api.css.getUse().then((enabled) => {
        globalUseRef.current = enabled;
      }),
      window.api.css.tab.getAll().then((overrides) => {
        tabCssOverridesRef.current = overrides;
      }),
    ];

    Promise.all(initPromises).then(() => {
      applyCssForCurrentTab();
    });

    // 전역 CSS 변경 구독
    const unsubGlobalUse = window.api.css.onUse(({ enabled }) => {
      globalUseRef.current = enabled;
      applyCssForCurrentTab();
    });

    const unsubGlobalContent = window.api.css.onContent((css) => {
      globalCssRef.current = css;
      applyCssForCurrentTab();
    });

    // 탭별 CSS 변경 구독
    const unsubTabCss = window.api.css.tab.onChanged((payload) => {
      if (payload.css) {
        tabCssOverridesRef.current[payload.tabId] = payload.css;
      } else {
        delete tabCssOverridesRef.current[payload.tabId];
      }
      // 현재 탭에 해당하는 변경인 경우에만 재적용
      if (payload.tabId === useKeyStore.getState().selectedKeyType) {
        applyCssForCurrentTab();
      }
    });

    // 탭 변경 구독 (zustand store)
    let prevSelectedKeyType = useKeyStore.getState().selectedKeyType;
    const unsubKeyStore = useKeyStore.subscribe((state) => {
      if (state.selectedKeyType !== prevSelectedKeyType) {
        prevSelectedKeyType = state.selectedKeyType;
        applyCssForCurrentTab();
      }
    });

    return () => {
      unsubGlobalUse();
      unsubGlobalContent();
      unsubTabCss();
      unsubKeyStore();
    };
  }, []);

  // 참고: selectedKeyType 변경 시 CSS 재적용은 위 unsubKeyStore에서 처리
  // 별도 useEffect 불필요, 중복 실행 방지를 위해 제거됨
}
