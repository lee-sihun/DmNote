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
          onSubmit={() => true}
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
          onSubmit={() => true}
          t={(key: string) => key}
        />,
      );
    });
    expect(document.querySelector('.cm-editor')).toBeNull();
  });
});

describe('WebFontInputModal 저장 거절', () => {
  let host: HTMLDivElement;
  let root: Root;
  let originalRangeRects: (() => DOMRectList) | undefined;

  const VALID_CSS = "@font-face { font-family: 'Demo'; src: url(demo.woff2); }";

  // jsdom에는 Range 측정이 없어서 CodeMirror measure가 던진다
  const rangeProto = Range.prototype as unknown as {
    getClientRects?: () => DOMRectList;
  };
  const emptyRectList = () =>
    Object.assign([], {
      item: () => null,
    }) as unknown as DOMRectList;

  beforeEach(() => {
    originalRangeRects = rangeProto.getClientRects;
    rangeProto.getClientRects = emptyRectList;
    stubAnimationFrame();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    rangeProto.getClientRects = originalRangeRects;
    vi.unstubAllGlobals();
  });

  const renderWithOutcome = async (saved: boolean) => {
    await act(async () => {
      root.render(
        <WebFontInputModal
          isOpen
          onClose={() => undefined}
          onSubmit={() => saved}
          initialCss={VALID_CSS}
          t={(key: string) => key}
        />,
      );
    });
    await settleDeferredContent();
  };

  const editorText = () =>
    document.querySelector('.cm-editor')?.querySelector('.cm-content')
      ?.textContent ?? '';

  const pressSubmit = async () => {
    const submit = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'webFontInput.submit',
    );
    expect(submit?.disabled).toBe(false);
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('저장이 거절되면 편집 중이던 CSS를 그대로 남긴다', async () => {
    await renderWithOutcome(false);
    expect(editorText()).toContain("font-family: 'Demo'");

    await pressSubmit();

    expect(editorText()).toContain("font-family: 'Demo'");
  });

  it('저장에 성공하면 편집기를 비운다', async () => {
    await renderWithOutcome(true);

    await pressSubmit();

    // 비면 자리표시자 예시가 대신 보이므로 원본이 사라졌는지로 판정한다
    expect(editorText()).not.toContain("font-family: 'Demo'");
  });
});
