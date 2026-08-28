import { useSyncExternalStore } from 'react';
import {
  getResolvedTheme,
  subscribeResolvedTheme,
} from '@utils/theme/applyTheme';
import type { ResolvedUiTheme } from '@src/types/settings/settings';

/**
 * 지금 그려지고 있는 테마를 읽는다.
 *
 * CSS 토큰으로 해결되는 것은 이 훅이 필요 없다. 토큰 밖에 있는 자산을
 * 테마별로 갈아끼워야 할 때만 쓴다 (미리보기 클립 등)
 */
export const useResolvedTheme = (): ResolvedUiTheme =>
  useSyncExternalStore(
    subscribeResolvedTheme,
    getResolvedTheme,
    getResolvedTheme,
  );
