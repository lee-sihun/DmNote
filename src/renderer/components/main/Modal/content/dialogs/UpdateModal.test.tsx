import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nContext } from '@contexts/I18nContextDef';
import {
  settleDeferredContent,
  stubAnimationFrame,
} from '@src/renderer/__tests__/deferredContentHarness';
import UpdateModal from './UpdateModal';

const updateInfo = {
  currentVersion: '2.0.1',
  latestVersion: '2.0.1',
  releaseUrl: 'https://example.test/release',
  releaseName: '2.0.1',
  releaseNotes: 'bug fixes',
  publishedAt: '2026-08-29T00:00:00Z',
};

describe('UpdateModal 접근성 이름', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    stubAnimationFrame();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it.each([
    [false, 'update.title'],
    [true, 'update.latestAlready'],
  ])('화면 종류에 맞는 이름을 제공한다', async (isLatestVersion, expected) => {
    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: 'ko', setLocale: () => undefined, t: (key) => key }}
        >
          <UpdateModal
            isOpen
            updateInfo={updateInfo}
            onClose={() => undefined}
            onSkipVersion={() => undefined}
            isLatestVersion={isLatestVersion}
          />
        </I18nContext.Provider>,
      );
    });
    await settleDeferredContent();

    expect(
      document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
    ).toBe(expected);
  });
});
