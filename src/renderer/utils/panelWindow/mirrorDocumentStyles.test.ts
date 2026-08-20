import { afterEach, describe, expect, it } from 'vitest';

import {
  mirrorDocumentStyles,
  removeMirroredStyles,
} from './mirrorDocumentStyles';

const createTarget = () => document.implementation.createHTMLDocument('child');

const flushObserver = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const styleTexts = (doc: Document) =>
  Array.from(doc.head.querySelectorAll('style')).map(
    (node) => node.textContent,
  );

describe('mirrorDocumentStyles', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    document.head.replaceChildren();
  });

  it('copies stylesheet links and style blocks in source order', async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/main.css';
    const style = document.createElement('style');
    style.textContent = '.a{color:red}';
    document.head.append(link, style);

    const target = createTarget();
    const mirror = mirrorDocumentStyles(document, target);
    cleanups.push(mirror.dispose);
    await mirror.ready;

    const copies = target.head.querySelectorAll('link, style');
    expect(copies).toHaveLength(2);
    expect((copies[0] as HTMLLinkElement).href).toBe(link.href);
    expect(copies[0].hasAttribute('data-dmn-mirrored-style')).toBe(true);
    expect(copies[1].textContent).toBe('.a{color:red}');
  });

  it('follows additions, text updates and removals', async () => {
    const target = createTarget();
    const mirror = mirrorDocumentStyles(document, target);
    cleanups.push(mirror.dispose);

    const style = document.createElement('style');
    style.textContent = '.hmr{a:1}';
    document.head.appendChild(style);
    await flushObserver();
    expect(styleTexts(target)).toEqual(['.hmr{a:1}']);

    // Vite HMR은 텍스트 노드를 갈아끼운다
    style.textContent = '.hmr{a:2}';
    await flushObserver();
    expect(styleTexts(target)).toEqual(['.hmr{a:2}']);

    // 앞에 끼워 넣어도 순서를 따라간다
    const first = document.createElement('style');
    first.textContent = '.first{}';
    document.head.insertBefore(first, style);
    await flushObserver();
    expect(styleTexts(target)).toEqual(['.first{}', '.hmr{a:2}']);

    style.remove();
    await flushObserver();
    expect(styleTexts(target)).toEqual(['.first{}']);
  });

  it('dispose stops tracking and removes copies; removeMirroredStyles clears leftovers', async () => {
    const style = document.createElement('style');
    style.textContent = '.x{}';
    document.head.appendChild(style);
    const target = createTarget();
    const mirror = mirrorDocumentStyles(document, target);
    expect(styleTexts(target)).toEqual(['.x{}']);

    mirror.dispose();
    expect(styleTexts(target)).toEqual([]);
    const late = document.createElement('style');
    late.textContent = '.late{}';
    document.head.appendChild(late);
    await flushObserver();
    expect(styleTexts(target)).toEqual([]);

    // 이전 세션 흔적 정리
    const stale = target.createElement('style');
    stale.setAttribute('data-dmn-mirrored-style', '');
    target.head.appendChild(stale);
    const own = target.createElement('style');
    target.head.appendChild(own);
    removeMirroredStyles(target);
    expect(target.head.querySelectorAll('style')).toHaveLength(1);
  });
});
