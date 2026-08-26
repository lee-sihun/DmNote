import { useEffect, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { obsApi } from '@api/modules/obsApi';
import { scopeUserCss } from '@utils/css/scopeUserCss';
import {
  hasLeadingImports,
  resolveUserCssImports,
} from '@utils/css/resolveUserCssImports';
import { fetchCustomCssImport } from '@api/modules/customCssImportApi';
import type { TabCssOverrides } from '@src/types/plugin/css';
import type { CustomCss } from '@src/types/plugin/css';

const STYLE_ELEMENT_ID = 'dmn-custom-css';
const SCOPE_CACHE_LIMIT = 4;

interface CustomCssInjectionOptions {
  // 지정 시 모든 셀렉터를 이 스코프 하위로 재작성해 주입 (메인창 미리보기 격리).
  // 미지정이면 원문 주입 (오버레이·OBS)
  scopeSelector?: string;
}

/**
 * CSS 적용 우선순위:
 * 1. 전역 CSS OFF → 모든 CSS 미적용 (탭 설정 무시)
 * 2. 전역 CSS ON + 탭 enabled=false → CSS 미적용
 * 3. 전역 CSS ON + 탭 enabled=true + 로컬 파일 있음 → 탭 CSS 적용
 * 4. 전역 CSS ON + (탭 설정 없음 또는 로컬 파일 없음) → 전역 CSS 적용
 */
export function useCustomCssInjection(options?: CustomCssInjectionOptions) {
  const scopeSelector = options?.scopeSelector;
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
    // 스코프 변환은 결정적이라 원문 기준 캐시 - 탭별 CSS를 오가도 재파싱
    // 없이 조회만 하도록 몇 장 유지 (대용량 시트는 변환에 수십 ms)
    const scopeCache = new Map<string, string>();
    // @import는 시트를 받아야 해서 비동기. 우선 import를 뺀 결과를 넣고, 받아서
    // 인라인·스코프한 결과가 준비되면 같은 원문일 때 다시 적용한다. 원문이
    // 바뀌면 진행 중이던 해석은 중단한다
    const importResolvedCache = new Map<string, string>();
    let pendingImport: { raw: string; controller: AbortController } | null =
      null;
    let disposed = false;
    let reapply: (() => void) | null = null;
    const remember = (
      cache: Map<string, string>,
      raw: string,
      value: string,
    ) => {
      if (cache.size >= SCOPE_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(raw, value);
    };
    const resolveImports = (raw: string, scope: string) => {
      if (pendingImport?.raw === raw) return;
      pendingImport?.controller.abort();
      const controller = new AbortController();
      pendingImport = { raw, controller };
      void resolveUserCssImports(raw, fetchCustomCssImport, {
        signal: controller.signal,
      })
        .then((inlined) => {
          if (disposed || controller.signal.aborted) return;
          remember(importResolvedCache, raw, scopeUserCss(inlined, scope));
          reapply?.();
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn('[custom-css] @import resolve failed', error);
        })
        .finally(() => {
          if (pendingImport?.controller === controller) pendingImport = null;
        });
    };
    const applyScope = (raw: string): string => {
      if (!scopeSelector || !raw) return raw;
      const resolved = importResolvedCache.get(raw);
      if (resolved !== undefined) return resolved;
      let scoped = scopeCache.get(raw);
      if (scoped === undefined) {
        scoped = scopeUserCss(raw, scopeSelector);
        remember(scopeCache, raw, scoped);
      }
      if (hasLeadingImports(raw)) resolveImports(raw, scopeSelector);
      return scoped;
    };

    const applyCssForCurrentTab = () => {
      const styleEl = styleElRef.current;
      if (!styleEl) return;

      // 동일 내용 재대입은 스타일시트 재파싱으로 @keyframes 애니메이션을
      // 재시작시키므로 실제 변경 시에만 대입 (스코프 변환 후 문자열 기준)
      const setStyle = (rawContent: string, disabled: boolean) => {
        const content = applyScope(rawContent);
        const changed =
          styleEl.textContent !== content || styleEl.disabled !== disabled;
        if (styleEl.textContent !== content) {
          styleEl.textContent = content;
        }
        styleEl.disabled = disabled;
        // 커스텀 CSS는 글리프 메트릭을 바꿀 수 있다 - 측정 캐시 무효화 신호
        if (changed) {
          window.dispatchEvent(new Event('dmn-custom-css-applied'));
        }
      };

      const currentTab = useKeyStore.getState().selectedKeyType;
      const tabCss = tabCssOverridesRef.current[currentTab];
      const globalCss = globalCssRef.current;
      const globalUse = globalUseRef.current;

      // 1. 전역 CSS OFF → 모든 CSS 미적용
      if (!globalUse) {
        setStyle('', true);
        return;
      }

      // 2. 전역 ON + 탭 설정이 있는 경우
      if (tabCss) {
        // 탭 enabled=false → CSS 미적용
        if (!tabCss.enabled) {
          setStyle('', true);
          return;
        }

        // 탭 enabled=true이고 로컬 파일 있음 → 탭 CSS 적용
        if (tabCss.path && tabCss.content) {
          setStyle(tabCss.content, false);
          return;
        }
      }

      // 3. 전역 CSS 적용 (탭 설정 없거나 로컬 파일 없음)
      if (globalCss.content) {
        setStyle(globalCss.content, false);
      } else {
        setStyle('', true);
      }
    };

    reapply = applyCssForCurrentTab;

    // 초기 데이터 로드 (OBS 재동기화 시에도 재사용)
    const refetchAll = async () => {
      try {
        const [globalCss, globalUse, overrides] = await Promise.all([
          window.api.css.get(),
          window.api.css.getUse(),
          window.api.css.tab.getAll(),
        ]);
        globalCssRef.current = globalCss;
        globalUseRef.current = globalUse;
        tabCssOverridesRef.current = overrides;
        applyCssForCurrentTab();
      } catch (error) {
        console.error('Failed to fetch custom CSS state', error);
      }
    };

    void refetchAll();

    // OBS WS 재연결/lag 복구 시 재조회 (네이티브에서는 미발화)
    const unsubResync = obsApi.onResync(() => {
      void refetchAll();
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
      disposed = true;
      pendingImport?.controller.abort();
      unsubResync();
      unsubGlobalUse();
      unsubGlobalContent();
      unsubTabCss();
      unsubKeyStore();
    };
  }, [scopeSelector]);

  // 참고: selectedKeyType 변경 시 CSS 재적용은 위 unsubKeyStore에서 처리
  // 별도 useEffect 불필요, 중복 실행 방지를 위해 제거됨
}
