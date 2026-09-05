/**
 * 모달 초기 포커스의 입력 모달리티 분기 계약
 * - 키보드 흐름 오픈은 첫 컨트롤로, 마우스 흐름 오픈은 backdrop으로
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Modal from '@components/main/Modal/Modal';
import { installPointerFocusGuard } from '@utils/focus/pointerFocusGuard';

// jsdom은 크기·가시성 실측이 없어 실제 필터가 전부 걸러낸다 - 분기 검증용 우회
vi.mock('@utils/focusableElements', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@utils/focusableElements')
  >();
  return {
    ...actual,
    getFocusableElements: (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLElement>('button')),
  };
});

describe('Modal 초기 포커스 모달리티', () => {
  let host: HTMLDivElement;
  let root: Root;
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installPointerFocusGuard(document);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    uninstall();
  });

  const renderModal = () => {
    act(() => {
      root.render(
        <Modal animate={false}>
          <button type="button">확인</button>
        </Modal>,
      );
    });
  };

  it('키보드 흐름에서는 첫 컨트롤에 포커스한다', () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    renderModal();
    expect((document.activeElement as HTMLElement | null)?.tagName).toBe(
      'BUTTON',
    );
  });

  it('마우스 흐름에서는 backdrop에 포커스한다', () => {
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    );
    renderModal();
    const backdrop = document.querySelector('[data-dmn-modal-backdrop]');
    expect(document.activeElement).toBe(backdrop);
  });
});
