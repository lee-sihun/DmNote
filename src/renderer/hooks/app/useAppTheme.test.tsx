import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppTheme } from './useAppTheme';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  readCachedThemePreference,
  THEME_CACHE_KEY,
} from '@utils/theme/applyTheme';

const Host = () => {
  useAppTheme();
  return null;
};

describe('useAppTheme', () => {
  let container: HTMLDivElement;
  let root: Root;
  let systemIsLight: boolean;
  let emitSystemChange: () => void;
  let addEventListener: ReturnType<typeof vi.fn>;
  let removeEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    systemIsLight = true;
    const listeners = new Set<() => void>();
    addEventListener = vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    });
    removeEventListener = vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    });
    emitSystemChange = () => listeners.forEach((listener) => listener());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return systemIsLight;
        },
        media: '(prefers-color-scheme: light)',
        onchange: null,
        addEventListener,
        removeEventListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.backgroundColor = '#131315';
    useSettingsStore.setState({ uiTheme: 'system' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('bootstrap 완료를 기다리지 않고 현재 설정을 적용한다', () => {
    useSettingsStore.setState({ uiTheme: 'dark' });
    act(() => root.render(<Host />));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('dark');
  });

  it('system이면 즉시 OS 변경을 구독하고 명시 테마로 바뀔 때 해제한다', () => {
    act(() => root.render(<Host />));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(addEventListener).toHaveBeenCalledTimes(1);

    systemIsLight = false;
    act(() => emitSystemChange());
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => useSettingsStore.setState({ uiTheme: 'light' }));
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('캐시가 유효할 때만 초기 설정 힌트로 사용한다', () => {
    localStorage.setItem(THEME_CACHE_KEY, 'light');
    expect(readCachedThemePreference('system')).toBe('light');

    localStorage.setItem(THEME_CACHE_KEY, 'invalid');
    expect(readCachedThemePreference('system')).toBe('system');
  });

  it('캐시 접근이 실패하면 기본 설정으로 폴백한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(readCachedThemePreference('dark')).toBe('dark');
  });
});
