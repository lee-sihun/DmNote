import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_CACHE_KEY } from '@utils/theme/applyTheme';

describe('useSettingsStore 초기 테마', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('첫 화면과 같은 유효한 캐시 값으로 초기화한다', async () => {
    localStorage.setItem(THEME_CACHE_KEY, 'light');

    const { useSettingsStore } = await import('./useSettingsStore');

    expect(useSettingsStore.getState().uiTheme).toBe('light');
  });

  it('유효하지 않은 캐시는 canonical 기본값으로 폴백한다', async () => {
    localStorage.setItem(THEME_CACHE_KEY, 'invalid');

    const { useSettingsStore } = await import('./useSettingsStore');

    expect(useSettingsStore.getState().uiTheme).toBe('system');
  });
});
