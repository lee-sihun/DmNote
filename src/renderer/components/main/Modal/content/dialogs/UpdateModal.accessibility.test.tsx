import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UpdateModal from './UpdateModal';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const updateInfo = {
  currentVersion: '2.0.0',
  latestVersion: '2.0.1',
  releaseUrl: 'https://example.com/release',
  releaseName: '2.0.1',
  releaseNotes: '',
  publishedAt: '',
};

describe('UpdateModal 접근성 이름', () => {
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
    host.remove();
    document.body.innerHTML = '';
  });

  const renderModal = async (isLatestVersion: boolean) => {
    await act(async () => {
      root.render(
        <UpdateModal
          isOpen
          updateInfo={updateInfo}
          isLatestVersion={isLatestVersion}
          onClose={vi.fn()}
          onSkipVersion={vi.fn()}
        />,
      );
    });
  };

  it('업데이트가 있으면 새 버전 제목을 dialog 이름으로 사용한다', async () => {
    await renderModal(false);

    expect(
      document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
    ).toBe('update.title');
  });

  it('최신 버전이면 화면 제목과 같은 dialog 이름을 사용한다', async () => {
    await renderModal(true);

    expect(
      document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
    ).toBe('update.latestAlready');
  });
});
