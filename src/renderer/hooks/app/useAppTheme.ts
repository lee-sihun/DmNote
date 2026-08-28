import { useEffect } from 'react';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  applyResolvedTheme,
  cacheThemePreference,
  resolveTheme,
  subscribeSystemTheme,
} from '@utils/theme/applyTheme';

/**
 * 앱 UI 테마를 문서에 반영한다.
 *
 * 설정값(system/light/dark)을 실제 테마로 해석해 documentElement에 data-theme으로
 * 싣는다. 토큰이 [data-theme] 아래에만 있으므로 이 속성이 팔레트의 유일한 스위치다.
 * system일 때만 OS 변경을 구독한다 - 명시 선택은 OS와 무관해야 한다.
 *
 * 메인 창에서만 호출한다. 오버레이와 OBS는 사용자 콘텐츠 대역이라
 * 문서 html에 다크가 정적으로 박혀 있다
 */
export const useAppTheme = () => {
  const preference = useSettingsStore((state) => state.uiTheme);

  useEffect(() => {
    cacheThemePreference(preference);
    applyResolvedTheme(resolveTheme(preference));
    if (preference !== 'system') return;
    return subscribeSystemTheme(() => {
      applyResolvedTheme(resolveTheme('system'));
    });
  }, [preference]);
};
