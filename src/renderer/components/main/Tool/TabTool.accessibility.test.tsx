import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TabTool from './TabTool';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: () => ({
    selectedKeyType: '4key',
    setSelectedKeyType: vi.fn(),
    isBootstrapped: true,
  }),
}));
vi.mock('./icons/TabGridIcon', () => ({ default: () => null }));
vi.mock('../Modal/FloatingPopup', () => ({ default: () => null }));
vi.mock('../Modal/content/settings/TabList', () => ({ default: () => null }));
vi.mock('@hooks/useIconMotion', () => ({
  useIconMotion: () => ({ motionProps: {} }),
}));

describe('TabTool 접근성 이름', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('커스텀 레이아웃 아이콘 버튼에 번역된 이름과 힌트를 제공한다', () => {
    act(() => root.render(<TabTool />));

    const button = host.querySelector<HTMLButtonElement>(
      '[aria-label="tabs.title"]',
    );
    expect(button).not.toBeNull();
    expect(button?.title).toBe('tabs.title');
  });
});
