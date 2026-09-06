import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomCssHistoryItem } from '@src/types/plugin/api';

const mocks = vi.hoisted(() => ({
  setContent: vi.fn(),
  historyGet: vi.fn(),
  historyActivate: vi.fn(),
  load: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: null }),
}));
vi.mock('@api/modules/resources/cssApi', () => ({ cssApi: mocks }));

import CssPanelContent from './CssPanelContent';

const deferred = () => {
  let resolve!: (value: { success: boolean; error?: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ success: boolean; error?: string }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
};

describe('내장 CSS 토큰 칩과 제거', () => {
  let root: Root;
  let host: HTMLDivElement;
  let props: React.ComponentProps<typeof CssPanelContent>;
  const showAlert = vi.fn();
  const onHistoryCountChange = vi.fn();
  const file: CustomCssHistoryItem = {
    path: '/themes/keys.css',
    status: 'available',
    lastUsedAt: 1,
  };
  const button = (key: string) =>
    Array.from(host.querySelectorAll('button')).find(
      (node) => node.textContent === key,
    );
  const removeButton = () =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.cssEmbeddedRemove"]',
    );
  const render = async (
    patch: Partial<React.ComponentProps<typeof CssPanelContent>> = {},
  ) => {
    props = { ...props, ...patch };
    await act(async () => root.render(<CssPanelContent {...props} />));
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.setContent.mockReset().mockResolvedValue({ success: true });
    mocks.historyGet.mockReset().mockResolvedValue([]);
    mocks.historyActivate.mockReset();
    mocks.load.mockReset();
    vi.stubGlobal('api', { css: { historyGet: mocks.historyGet } });
    showAlert.mockReset();
    onHistoryCountChange.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    props = {
      useCustomCSS: true,
      customCSSPath: null,
      customCSSContent: '[data-key-element] { opacity: 0; }',
      onToggleCustomCSS: vi.fn(),
      onClose: vi.fn(),
      showAlert,
      onHistoryCountChange,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('파일 없는 원문은 상태 카드 칩으로 보이고 목록·개수에는 들어가지 않는다', async () => {
    await render();
    expect(host.textContent).toContain('settings.cssEmbedded');
    expect(host.textContent).not.toContain('settings.noCssFile');
    expect(host.textContent).toContain('settings.cssHistoryEmpty');
    expect(removeButton()).not.toBeNull();
    expect(onHistoryCountChange).toHaveBeenLastCalledWith(0);
  });

  it('비활성화해도 칩과 제거 버튼을 유지하고 별도 문구는 붙이지 않는다', async () => {
    await render({ useCustomCSS: false });
    expect(host.textContent).toContain('settings.cssEmbedded');
    expect(host.textContent).not.toContain('settings.cssApplied');
    expect(removeButton()?.disabled).toBe(false);
  });

  it('원문도 없는 경우 기존 빈 상태를 유지한다', async () => {
    await render({ customCSSContent: '' });
    expect(host.textContent).toContain('settings.noCssFile');
    expect(host.textContent).toContain('settings.cssHistoryEmpty');
    expect(removeButton()).toBeNull();
    expect(onHistoryCountChange).toHaveBeenLastCalledWith(0);
  });

  it('파일 CSS를 내장 CSS로 중복 표시하지 않는다', async () => {
    mocks.historyGet.mockResolvedValue([file]);
    await render({ customCSSPath: file.path });
    expect(host.textContent).toContain('keys.css');
    expect(host.textContent).not.toContain('settings.cssEmbedded');
    expect(removeButton()).toBeNull();
    expect(onHistoryCountChange).toHaveBeenLastCalledWith(1);
  });

  it('개수는 파일 이력만 세고 원문 유무에 흔들리지 않는다', async () => {
    mocks.historyGet.mockResolvedValue([file]);
    await render();
    expect(onHistoryCountChange).toHaveBeenLastCalledWith(1);
    await render({ customCSSContent: '', useCustomCSS: false });
    expect(onHistoryCountChange).toHaveBeenLastCalledWith(1);
    expect(host.textContent).toContain('keys.css');
    expect(removeButton()).toBeNull();
  });

  it('제거는 원문만 비우고 한 번만 저장하며 완료 전에는 CSS를 교체하지 못한다', async () => {
    const pending = deferred();
    mocks.setContent.mockReturnValue(pending.promise);
    mocks.historyGet.mockResolvedValue([file]);
    await render();
    act(() => {
      removeButton()!.click();
      removeButton()!.click();
    });
    expect(mocks.setContent).toHaveBeenCalledTimes(1);
    expect(mocks.setContent).toHaveBeenCalledWith('');
    expect(removeButton()?.disabled).toBe(true);
    expect(button('settings.loadCss')?.disabled).toBe(true);
    expect(button('settings.cssApply')?.disabled).toBe(true);
    expect(host.textContent).toContain('settings.cssEmbedded');
    await act(async () => pending.resolve({ success: true }));
    await render({ customCSSContent: '' });
    expect(removeButton()).toBeNull();
    expect(host.textContent).toContain('settings.noCssFile');
    expect(showAlert).not.toHaveBeenCalled();
  });

  it('제거 실패 시 칩을 보존하고 알린 뒤 재시도할 수 있다', async () => {
    mocks.setContent.mockRejectedValueOnce(new Error('IO_ERROR'));
    await render();
    await act(async () => removeButton()!.click());
    expect(showAlert).toHaveBeenCalledWith('settings.cssEmbeddedRemoveFailed');
    expect(host.textContent).toContain('settings.cssEmbedded');
    expect(removeButton()?.disabled).toBe(false);
    await act(async () => removeButton()!.click());
    expect(mocks.setContent).toHaveBeenCalledTimes(2);
  });

  it('실패 응답도 알림으로 전달한다', async () => {
    mocks.setContent.mockResolvedValueOnce({
      success: false,
      error: 'TOO_LARGE',
    });
    await render();
    await act(async () => removeButton()!.click());
    expect(showAlert).toHaveBeenCalledWith('settings.cssEmbeddedRemoveFailed');
    expect(host.textContent).toContain('settings.cssEmbedded');
  });

  it('늦은 제거 응답이 더 최신 CSS 상태를 덮어쓰지 않는다', async () => {
    const pending = deferred();
    mocks.setContent.mockReturnValue(pending.promise);
    await render();
    act(() => removeButton()!.click());
    await render({ customCSSPath: file.path, customCSSContent: '.new {}' });
    await act(async () => pending.resolve({ success: true }));
    expect(host.textContent).toContain('keys.css');
    expect(host.textContent).not.toContain('settings.noCssFile');
    expect(removeButton()).toBeNull();
  });
});
