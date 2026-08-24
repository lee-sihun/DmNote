// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preload: vi.fn<(targetDocument: Document) => Promise<void>>(),
}));

vi.mock('./fontPickerPreload', () => ({
  preloadFontPickerFonts: mocks.preload,
}));

import FontPickerOpenButton from './FontPickerOpenButton';

describe('FontPickerOpenButton', () => {
  let host: HTMLDivElement;
  let root: Root;
  let resolvePreload: () => void;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.preload.mockReset();
    mocks.preload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePreload = resolve;
        }),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('폰트 준비가 끝난 뒤에만 페이지를 연다', async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(
        <FontPickerOpenButton
          activePageKey={null}
          pageKey="font"
          onOpen={onOpen}
          onClose={() => undefined}
        >
          설정하기
        </FontPickerOpenButton>,
      );
    });

    await act(async () => host.querySelector('button')?.click());
    expect(mocks.preload).toHaveBeenCalledWith(document);
    expect(onOpen).not.toHaveBeenCalled();

    await act(async () => resolvePreload());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('포인터가 버튼에 들어오면 클릭 전에 준비를 시작한다', async () => {
    await act(async () => {
      root.render(
        <FontPickerOpenButton
          activePageKey={null}
          pageKey="font"
          onOpen={() => undefined}
          onClose={() => undefined}
        >
          설정하기
        </FontPickerOpenButton>,
      );
    });

    await act(async () => {
      host
        .querySelector('button')
        ?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    });

    expect(mocks.preload).toHaveBeenCalledWith(document);
  });

  it('준비 중 다른 페이지로 이동하면 늦게 폰트 페이지를 열지 않는다', async () => {
    const onOpen = vi.fn();
    const render = (activePageKey: string | null) => (
      <FontPickerOpenButton
        activePageKey={activePageKey}
        pageKey="font"
        onOpen={onOpen}
        onClose={() => undefined}
      >
        설정하기
      </FontPickerOpenButton>
    );

    await act(async () => root.render(render(null)));
    await act(async () => host.querySelector('button')?.click());
    await act(async () => root.render(render('sound')));
    await act(async () => resolvePreload());

    expect(onOpen).not.toHaveBeenCalled();
  });
});
