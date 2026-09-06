// @vitest-environment jsdom
import React, { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './I18nContext';
import { I18nContext } from './I18nContextDef';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  result: null as Promise<unknown> | null,
}));
vi.mock('@api/modules/app/settingsApi', () => ({
  settingsApi: { update: mocks.update },
}));

describe('언어 저장과 표시 일치', () => {
  let root: Root;
  let host: HTMLDivElement;
  const originalApi = window.api;
  const Probe = () => {
    const context = useContext(I18nContext)!;
    return (
      <button
        data-locale={context.locale}
        onClick={() => {
          mocks.result = Promise.resolve(context.setLocale('en'));
          void mocks.result.catch(() => {});
        }}
      >
        언어 변경
      </button>
    );
  };
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem('dmnote:locale', 'ko');
    localStorage.setItem('dmnote:locale_initialized', '1');
    mocks.update.mockReset();
    mocks.result = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.api = {
      settings: {
        get: async () => ({ language: 'ko' }),
        onChanged: () => () => {},
      },
    } as never;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root.render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.querySelector('button')).not.toBeNull();
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.api = originalApi;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('저장에 실패하면 호출자에게 알리고 화면과 다음 실행 언어를 유지한다', async () => {
    const failure = new Error('language write failed');
    mocks.update.mockRejectedValue(failure);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button')!.click(),
    );
    await expect(mocks.result).rejects.toBe(failure);
    expect(
      host.querySelector('[data-locale]')?.getAttribute('data-locale'),
    ).toBe('ko');
    expect(localStorage.getItem('dmnote:locale')).toBe('ko');
  });

  it('저장 응답을 받은 뒤 화면과 다음 실행 언어를 함께 바꾼다', async () => {
    let complete!: () => void;
    mocks.update.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    act(() => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(
      host.querySelector('[data-locale]')?.getAttribute('data-locale'),
    ).toBe('ko');
    expect(localStorage.getItem('dmnote:locale')).toBe('ko');
    await act(async () => {
      complete();
      await mocks.result;
    });
    expect(
      host.querySelector('[data-locale]')?.getAttribute('data-locale'),
    ).toBe('en');
    expect(localStorage.getItem('dmnote:locale')).toBe('en');
  });
});
