import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nContext } from '@contexts/I18nContextDef';
import {
  settleDeferredContent,
  stubAnimationFrame,
} from '@src/renderer/__tests__/deferredContentHarness';
import Alert from './Alert';
import en from '@src/renderer/locales/en.json';
import ko from '@src/renderer/locales/ko.json';
import ru from '@src/renderer/locales/ru.json';
import zhHant from '@src/renderer/locales/zh-Hant.json';
import zhCn from '@src/renderer/locales/zh-cn.json';

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
    // 문구의 \n이 줄바꿈으로 살아나는 유일한 고리
    expect(messageElement?.className).toContain('whitespace-pre-line');
  });
});

describe('확인 문구 개행 계약', () => {
  const locales = {
    en,
    ko,
    ru,
    'zh-Hant': zhHant,
    'zh-cn': zhCn,
  } as unknown as Record<string, Record<string, Record<string, string>>>;

  // 질문과 부연이 한 덩어리로 흐르면 창 폭에 따라 문장 한가운데서 끊긴다
  const twoSentence = [
    ['fontPicker', 'deleteConfirm'],
    ['soundPicker', 'deleteConfirm'],
  ] as const;

  it('두 문장짜리 확인 문구는 문장 경계에서 갈린다', () => {
    Object.entries(locales).forEach(([name, messages]) => {
      twoSentence.forEach(([section, key]) => {
        const label = `${name}.${section}.${key}`;
        const text = messages[section][key];

        expect(text, label).toContain('\n');
        // 개행이 문장 한가운데 들어가면 고치려던 문제가 그대로다
        expect(text.split('\n')[0], label).toMatch(/[?？]$/);
      });
    });
  });
});
