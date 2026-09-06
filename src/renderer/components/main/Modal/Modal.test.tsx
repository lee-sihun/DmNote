import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingPopup from './floatingPopup/FloatingPopup';
import Modal from './Modal';
import { isModalLayerActive } from './popupLayer';
import {
  settleDeferredContent,
  stubAnimationFrame,
} from '@src/renderer/__tests__/deferredContentHarness';

describe('Modal focus contract', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      document.createElement('div').getBoundingClientRect(),
    ] as unknown as DOMRectList);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('moves focus into the dialog and restores the opener on unmount', async () => {
    const opener = document.createElement('button');
    document.body.prepend(opener);
    opener.focus();

    await act(async () => {
      root.render(
        <Modal ariaLabel="Test dialog">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>,
      );
    });

    expect(document.activeElement?.textContent).toBe('First');

    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab and Shift+Tab inside the top dialog', async () => {
    await act(async () => {
      root.render(
        <Modal ariaLabel="Test dialog">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>,
      );
    });

    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    );
    buttons[1].focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(buttons[0]);

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('skips CSS-hidden fields when focusing and cycling', async () => {
    await act(async () => {
      root.render(
        <Modal ariaLabel="Test dialog">
          <button type="button" style={{ display: 'none' }}>
            Hidden first
          </button>
          <button type="button">Visible first</button>
          <button type="button">Visible last</button>
          <button type="button" style={{ visibility: 'hidden' }}>
            Hidden last
          </button>
        </Modal>,
      );
    });

    const visibleButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ).filter((button) => button.textContent?.startsWith('Visible'));
    expect(document.activeElement).toBe(visibleButtons[0]);

    visibleButtons[1].focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(visibleButtons[0]);

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(visibleButtons[1]);
  });

  it('does not replace a child autoFocus target', async () => {
    await act(async () => {
      root.render(
        <Modal ariaLabel="Test dialog">
          <button type="button">First</button>
          <input aria-label="Preferred" autoFocus />
        </Modal>,
      );
    });

    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Preferred',
    );
  });

  it('after-paint 전략은 dialog shell을 먼저 표시한 뒤 콘텐츠를 mount한다', async () => {
    stubAnimationFrame();

    await act(async () => {
      root.render(
        <Modal
          ariaLabel="Deferred dialog"
          animate={false}
          contentMountStrategy="after-paint"
        >
          <button type="button">Deferred action</button>
        </Modal>,
      );
    });

    const dialog = document.querySelector<HTMLElement>(
      '[aria-label="Deferred dialog"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).not.toContain('Deferred action');
    expect(document.activeElement).toBe(dialog);

    await settleDeferredContent();

    const action = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Deferred action',
    );
    expect(action).not.toBeUndefined();
    expect(document.activeElement).toBe(action);
  });

  it('퇴장 전까지 지연 콘텐츠가 준비되지 않으면 새로 mount하지 않는다', async () => {
    let pendingFrame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      pendingFrame = null;
    });

    await act(async () => {
      root.render(
        <Modal
          ariaLabel="Closing deferred dialog"
          motionState="entering"
          contentMountStrategy="after-paint"
        >
          <button type="button">Late action</button>
        </Modal>,
      );
    });
    expect(pendingFrame).not.toBeNull();

    await act(async () => {
      root.render(
        <Modal
          ariaLabel="Closing deferred dialog"
          motionState="closing"
          contentMountStrategy="after-paint"
        >
          <button type="button">Late action</button>
        </Modal>,
      );
    });

    expect(pendingFrame).toBeNull();
    expect(document.body.textContent).not.toContain('Late action');
  });

  it('closing 전환 즉시 배경 입력 잠금 소유권을 놓는다', async () => {
    await act(async () => {
      root.render(
        <Modal ariaLabel="Closing dialog" motionState="open">
          <button type="button">Action</button>
        </Modal>,
      );
    });
    expect(isModalLayerActive()).toBe(true);

    await act(async () => {
      root.render(
        <Modal ariaLabel="Closing dialog" motionState="closing">
          <button type="button">Action</button>
        </Modal>,
      );
    });

    expect(
      document.querySelector('[aria-label="Closing dialog"]'),
    ).not.toBeNull();
    expect(isModalLayerActive()).toBe(false);
  });

  it('inert 해제보다 먼저 실패한 opener 포커스를 다음 frame에 복구한다', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const opener = document.createElement('button');
    document.body.prepend(opener);
    opener.focus();
    const nativeFocus = opener.focus.bind(opener);
    const focus = vi
      .spyOn(opener, 'focus')
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => nativeFocus());

    await act(async () => {
      root.render(
        <Modal ariaLabel="Retry focus" motionState="open">
          <button type="button">Action</button>
        </Modal>,
      );
    });
    await act(async () => {
      root.render(
        <Modal ariaLabel="Retry focus" motionState="closing">
          <button type="button">Action</button>
        </Modal>,
      );
    });

    expect(focus).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(1);
    act(() => frames[0](performance.now()));
    expect(focus).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(opener);
  });

  it('yields keyboard ownership while a popup layer is open', async () => {
    const closeModal = vi.fn();
    const closePopup = vi.fn();
    await act(async () => {
      root.render(
        <Modal ariaLabel="Test dialog" onClick={closeModal}>
          <button type="button">Dialog action</button>
        </Modal>,
      );
    });
    await act(async () => {
      root.render(
        <Modal ariaLabel="Test dialog" onClick={closeModal}>
          <button type="button">Dialog action</button>
          <FloatingPopup
            open
            ariaLabel="Test popup"
            animate={false}
            onClose={closePopup}
          >
            <button type="button">Popup action</button>
          </FloatingPopup>
        </Modal>,
      );
    });

    const popupAction = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Popup action',
    );
    popupAction?.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(popupAction);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(closePopup).toHaveBeenCalledTimes(1);
    expect(closeModal).not.toHaveBeenCalled();
  });

  it('owns Escape when opened after an existing inline popup', async () => {
    const closePopup = vi.fn();
    const closeModal = vi.fn();
    const popup = (
      <FloatingPopup
        key="popup"
        open
        ariaLabel="Background popup"
        animate={false}
        onClose={closePopup}
      >
        <button type="button">Popup action</button>
      </FloatingPopup>
    );

    await act(async () => root.render(<>{popup}</>));
    await act(async () => {
      root.render(
        <>
          {popup}
          <Modal key="modal" ariaLabel="Top dialog" onClick={closeModal}>
            <button type="button">Dialog action</button>
          </Modal>
        </>,
      );
    });

    // 배경 팝업은 모달이 덮이는 순간 스스로 닫힌다(잠금 밖에 남는 body 포털 표면 차단).
    // Escape는 그 뒤에도 모달만 소비한다 - 팝업 닫힘이 한 번 더 나가면 안 된다
    expect(closePopup).toHaveBeenCalledTimes(1);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(closePopup).toHaveBeenCalledTimes(1);
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it('lets a child popup mounted with the modal own Escape', async () => {
    const closePopup = vi.fn();
    const closeModal = vi.fn();
    await act(async () => {
      root.render(
        <Modal ariaLabel="Test dialog" onClick={closeModal}>
          <FloatingPopup
            open
            ariaLabel="Test popup"
            animate={false}
            onClose={closePopup}
          >
            <button type="button">Popup action</button>
          </FloatingPopup>
        </Modal>,
      );
    });

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(closePopup).toHaveBeenCalledTimes(1);
    expect(closeModal).not.toHaveBeenCalled();
  });
});
