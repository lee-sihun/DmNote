import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  settleDeferredContent,
  stubAnimationFrame,
} from '@src/renderer/__tests__/deferredContentHarness';
import WebFontInputModal from './WebFontInputModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('WebFontInputModal 편집기 마운트', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    stubAnimationFrame();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const renderModal = async (initialCss: string) => {
    await act(async () => {
      root.render(
        <WebFontInputModal
          isOpen
          onClose={() => undefined}
          onSubmit={() => undefined}
          initialCss={initialCss}
          t={(key: string) => key}
        />,
      );
    });
  };

  it('본문이 첫 paint 뒤에 붙어도 CodeMirror가 초기값으로 만들어진다', async () => {
    const initialCss = "@font-face { font-family: 'Demo'; }";
    await renderModal(initialCss);
    // 지연 마운트 전에는 컨테이너 자체가 없다
    expect(document.querySelector('.webfont-cm-editor')).toBeNull();

    await settleDeferredContent();

    const editor = document.querySelector<HTMLElement>('.cm-editor');
    expect(editor).not.toBeNull();
    expect(editor?.querySelector('.cm-content')?.textContent).toContain(
      "font-family: 'Demo'",
    );
  });

  it('코드 입력부는 불투명 웰 대신 어두운 glass 재질을 사용한다', async () => {
    await renderModal('');
    await settleDeferredContent();

    const surface = document.querySelector<HTMLElement>(
      '[data-webfont-editor-surface="true"]',
    );
    expect(surface).not.toBeNull();
    expect(surface?.className).toContain('bg-glass-dim');
    expect(surface?.className).toContain('backdrop-glass-popup');
    expect(surface?.className).not.toContain('bg-inset-solid');
    expect(surface?.className).not.toContain('shadow-');
  });

  it('닫히면 에디터를 정리한다', async () => {
    await renderModal('');
    await settleDeferredContent();
    expect(document.querySelector('.cm-editor')).not.toBeNull();

    await act(async () => {
      root.render(
        <WebFontInputModal
          isOpen={false}
          onClose={() => undefined}
          onSubmit={() => undefined}
          t={(key: string) => key}
        />,
      );
    });
    expect(document.querySelector('.cm-editor')).toBeNull();
  });
});
