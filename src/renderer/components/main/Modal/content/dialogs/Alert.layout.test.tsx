import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nContext } from '@contexts/I18nContextDef';
import {
  settleDeferredContent,
  stubAnimationFrame,
} from '@src/renderer/__tests__/deferredContentHarness';
import Alert from './Alert';

describe('Alert 긴 문구 레이아웃', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('긴 문구는 넓어질 수 있고 한국어 단어와 긴 경로를 안전하게 줄바꿈한다', async () => {
    stubAnimationFrame();
    const message =
      '플러그인 1개를 추가했지만 일부 실패했습니다.\nqa-plugin.js: 플러그인을 적용하지 못했습니다.';

    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{
            locale: 'ko',
            setLocale: () => undefined,
            t: (key) => key,
          }}
        >
          <Alert isOpen message={message} />
        </I18nContext.Provider>,
      );
    });
    await settleDeferredContent();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const card = dialog?.querySelector('button')?.parentElement?.parentElement;
    const messageElement = Array.from(
      dialog?.querySelectorAll<HTMLElement>('div') ?? [],
    ).find((element) => element.textContent === message);

    expect(card?.className).toContain('max-w-[calc(100vw-48px)]');
    expect(messageElement?.className).toContain('max-w-[412px]');
    expect(messageElement?.className).toContain('break-keep');
    expect(messageElement?.className).toContain('break-words');
  });
});
