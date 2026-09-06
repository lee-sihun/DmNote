import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FloatingPopup from './FloatingPopup';
import { registerPopupLayer } from '../popupLayer';

const dispatchMouseDown = (target: Element) => {
  act(() => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
};

describe('FloatingPopup dismiss 런타임 계약', () => {
  let host: HTMLDivElement;
  let root: Root;
  let reference: HTMLButtonElement;
  let interactive: HTMLButtonElement;
  let outside: HTMLDivElement;
  let referenceRef: React.RefObject<HTMLElement>;
  let interactiveRef: React.RefObject<HTMLElement>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  const layerCleanups: Array<() => void> = [];

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    reference = document.createElement('button');
    interactive = document.createElement('button');
    outside = document.createElement('div');
    referenceRef = { current: reference };
    interactiveRef = { current: interactive };
    onClose = vi.fn<() => void>();
    document.body.append(reference, interactive, outside, host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () =>
      layerCleanups
        .splice(0)
        .reverse()
        .forEach((cleanup) => cleanup()),
    );
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const renderPopup = async (autoClose: boolean, open = true) => {
    await act(async () => {
      root.render(
        <FloatingPopup
          open={open}
          ariaLabel="dismiss popup"
          referenceRef={referenceRef}
          interactiveRefs={[interactiveRef]}
          fixedX={0}
          fixedY={0}
          animate={false}
          autoClose={autoClose}
          onClose={onClose}
        >
          <button type="button">surface action</button>
        </FloatingPopup>,
      );
    });
  };

  const dismissTargets = async () => {
    const modal = document.createElement('div');
    modal.dataset.dmnModalBackdrop = 'true';
    const submenu = document.createElement('div');
    submenu.dataset.dmnPopupSubmenu = 'true';
    // 온캔버스 편집 오버레이(그라데이션 축·자세 기즈모)는 한 속성으로 예외 처리
    const gradient = document.createElement('div');
    gradient.dataset.dmnCanvasEditorOverlay = 'true';
    const higherLayer = document.createElement('div');
    higherLayer.dataset.dmnPopupLayer = 'true';
    document.body.append(modal, submenu, gradient, higherLayer);
    await act(async () => {
      layerCleanups.push(registerPopupLayer(higherLayer));
    });
    return { gradient, higherLayer, modal, submenu };
  };

  it('auto-close는 표면·trigger·포털 예외를 유지하지만 interactive ref는 예외로 두지 않는다', async () => {
    await renderPopup(true);
    const surface = document.querySelector<HTMLElement>(
      '[data-dmn-floating-popup="true"]',
    )!;
    const { gradient, higherLayer, modal, submenu } = await dismissTargets();

    for (const target of [
      surface,
      reference,
      modal,
      submenu,
      gradient,
      higherLayer,
    ]) {
      dispatchMouseDown(target);
      expect(onClose).not.toHaveBeenCalled();
    }

    dispatchMouseDown(interactive);
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    dispatchMouseDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('persistent는 표면·trigger·interactive ref·포털 예외를 유지하고 외부만 닫는다', async () => {
    await renderPopup(false);
    const surface = document.querySelector<HTMLElement>(
      '[data-dmn-floating-popup="true"]',
    )!;
    const { gradient, higherLayer, modal, submenu } = await dismissTargets();

    for (const target of [
      surface,
      reference,
      interactive,
      modal,
      submenu,
      gradient,
      higherLayer,
    ]) {
      dispatchMouseDown(target);
      expect(onClose).not.toHaveBeenCalled();
    }

    dispatchMouseDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-close는 bubble mousedown만 등록하고 닫힐 때 같은 listener를 해제한다', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    await renderPopup(true);

    const registered = add.mock.calls.find(([type]) => type === 'mousedown');
    expect(registered?.[2]).toBeUndefined();
    add.mockClear();
    remove.mockClear();

    await renderPopup(true, false);

    expect(remove).toHaveBeenCalledWith('mousedown', registered?.[1]);
    expect(
      add.mock.calls.filter(([type]) =>
        ['pointerup', 'pointerdown', 'mousedown'].includes(type),
      ),
    ).toHaveLength(0);
  });

  it('persistent는 capture pointerup·pointerdown·mousedown을 등록하고 모두 해제한다', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    await renderPopup(false);

    const registered = new Map(
      add.mock.calls
        .filter(([type]) =>
          ['pointerup', 'pointerdown', 'mousedown'].includes(type),
        )
        .map(([type, listener, options]) => [type, { listener, options }]),
    );
    expect(Array.from(registered.keys())).toEqual([
      'pointerup',
      'pointerdown',
      'mousedown',
    ]);
    expect(
      Array.from(registered.values()).map(({ options }) => options),
    ).toEqual([true, true, true]);
    remove.mockClear();

    await renderPopup(false, false);

    for (const [type, { listener }] of registered) {
      expect(remove).toHaveBeenCalledWith(type, listener, true);
    }
  });
});
