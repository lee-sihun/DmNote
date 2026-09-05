import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  armOpen: vi.fn(() => Promise.resolve()),
}));

vi.mock('@api/modules/window/panelWindowApi', () => ({
  panelWindowApi: { armOpen: () => mocks.armOpen() },
}));

import {
  getPanelChildWindow,
  openPanelChildWindow,
  PanelChildWindowError,
  resetPanelChildWindow,
} from './panelChildWindow';

// jsdom의 window.open은 창을 만들지 않는다 - 별도 문서를 가진 가짜 Window로 대체
const createFakeChild = () => {
  const doc = document.implementation.createHTMLDocument('');
  const child = { document: doc, closed: false } as unknown as Window;
  return { child, doc };
};

describe('openPanelChildWindow', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.armOpen.mockReset().mockResolvedValue(undefined);
    openSpy = vi.spyOn(window, 'open');
  });

  afterEach(() => {
    resetPanelChildWindow();
    openSpy.mockRestore();
    document.head.replaceChildren();
  });

  it('arms the backend before window.open and prepares the child document', async () => {
    const style = document.createElement('style');
    style.textContent = '.token{}';
    document.head.appendChild(style);
    const { child, doc } = createFakeChild();
    openSpy.mockImplementation(() => {
      expect(mocks.armOpen).toHaveBeenCalledTimes(1);
      return child;
    });

    const handle = await openPanelChildWindow();

    expect(openSpy).toHaveBeenCalledWith(
      'about:blank',
      'dmn-panel',
      expect.stringContaining('popup=yes'),
    );
    expect(handle.window).toBe(child);
    expect(doc.querySelector('meta[charset]')).not.toBeNull();
    expect(
      doc.querySelector('meta[name="color-scheme"]')?.getAttribute('content'),
    ).toBe('dark');
    expect(doc.querySelector('base')?.getAttribute('href')).toBe(
      document.baseURI,
    );
    expect(doc.body.style.margin).toBe('0px');
    expect(
      Array.from(doc.head.querySelectorAll('style')).map((s) => s.textContent),
    ).toEqual(['.token{}']);
    expect(getPanelChildWindow()).toBe(handle);
  });

  it('reuses the live child window without opening again', async () => {
    const { child } = createFakeChild();
    openSpy.mockReturnValue(child);
    const first = await openPanelChildWindow();
    const second = await openPanelChildWindow();
    expect(second).toBe(first);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(mocks.armOpen).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight window creation between concurrent callers', async () => {
    let releaseArm!: () => void;
    mocks.armOpen.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseArm = resolve;
        }),
    );
    const { child } = createFakeChild();
    openSpy.mockReturnValue(child);

    const first = openPanelChildWindow();
    const second = openPanelChildWindow();

    expect(mocks.armOpen).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
    expect(second).toBe(first);

    releaseArm();
    const [firstHandle, secondHandle] = await Promise.all([first, second]);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(secondHandle).toBe(firstHandle);
  });

  it('opens a new window when the previous one is closed', async () => {
    const first = createFakeChild();
    openSpy.mockReturnValue(first.child);
    await openPanelChildWindow();
    (first.child as unknown as { closed: boolean }).closed = true;
    expect(getPanelChildWindow()).toBeNull();

    const second = createFakeChild();
    openSpy.mockReturnValue(second.child);
    const handle = await openPanelChildWindow();
    expect(handle.window).toBe(second.child);
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it('throws when the backend denies the request (window.open returns null)', async () => {
    openSpy.mockReturnValue(null);
    await expect(openPanelChildWindow()).rejects.toBeInstanceOf(
      PanelChildWindowError,
    );
    expect(getPanelChildWindow()).toBeNull();
  });

  it('clears leftovers when the same named window survives a main reload', async () => {
    const { child, doc } = createFakeChild();
    doc.documentElement.dataset.dmnPanelPrepared = '1';
    const stale = doc.createElement('style');
    stale.setAttribute('data-dmn-mirrored-style', '');
    doc.head.appendChild(stale);
    doc.body.appendChild(doc.createElement('div'));
    openSpy.mockReturnValue(child);

    await openPanelChildWindow();

    expect(doc.body.childElementCount).toBe(0);
    expect(doc.head.querySelectorAll('style')).toHaveLength(0);
  });
});
