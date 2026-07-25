// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FloatingPopup from '@components/main/Modal/FloatingPopup';

// floating-ui autoUpdate가 요구 — 배치는 fixed 좌표라 관찰 결과가 필요 없음
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

// 부모 팝업 안의 트리거로 자식 팝업을 여는 실제 구조 (그림자 → 색상)
const Nested = ({
  childOpen,
  onParentClose,
  onChildClose,
}: {
  childOpen: boolean;
  onParentClose: () => void;
  onChildClose: () => void;
}) => {
  const parentTriggerRef = useRef<HTMLButtonElement>(null);
  const childTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={parentTriggerRef} data-testid="parent-trigger" />
      <div data-testid="outside" />
      <FloatingPopup
        open
        ariaLabel="parent"
        referenceRef={parentTriggerRef}
        fixedX={10}
        fixedY={10}
        autoClose={false}
        onClose={onParentClose}
      >
        <div data-testid="parent-body">
          <button ref={childTriggerRef} data-testid="child-trigger" />
        </div>
        {childOpen ? (
          <FloatingPopup
            open
            ariaLabel="child"
            referenceRef={childTriggerRef}
            fixedX={20}
            fixedY={20}
            autoClose={false}
            onClose={onChildClose}
          >
            <div data-testid="child-body" />
          </FloatingPopup>
        ) : null}
      </FloatingPopup>
    </>
  );
};

const pointerDownOn = (selector: string) => {
  const target = document.querySelector(selector);
  expect(target).not.toBeNull();
  act(() => {
    target!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
};

describe('중첩 팝업의 바깥 클릭 소유권', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onParentClose: ReturnType<typeof vi.fn<() => void>>;
  let onChildClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    onParentClose = vi.fn<() => void>();
    onChildClose = vi.fn<() => void>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (childOpen: boolean) =>
    act(() => {
      root.render(
        <Nested
          childOpen={childOpen}
          onParentClose={onParentClose}
          onChildClose={onChildClose}
        />,
      );
    });

  it('자식 팝업 내부 클릭으로 부모가 닫히지 않는다', () => {
    render(false);
    render(true);

    // 고정 좌표 팝업은 body로 포털되므로 부모 DOM 안에 있지 않음
    expect(
      document
        .querySelector('[data-testid="parent-body"]')
        ?.contains(document.querySelector('[data-testid="child-body"]')),
    ).toBe(false);

    pointerDownOn('[data-testid="child-body"]');

    expect(onParentClose).not.toHaveBeenCalled();
    expect(onChildClose).not.toHaveBeenCalled();
  });

  it('두 팝업 모두 바깥을 클릭하면 닫힌다', () => {
    render(false);
    render(true);

    pointerDownOn('[data-testid="outside"]');

    expect(onChildClose).toHaveBeenCalled();
    expect(onParentClose).toHaveBeenCalled();
  });
});
