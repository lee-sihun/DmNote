import React, { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PopupExit from './PopupExit';
import FloatingPopup from './FloatingPopup';

// 피커를 대신하는 최소 자식.
// commitOnUnmount는 colorPickerPrimitives의 "드래그 중 언마운트돼도 마지막 값을
// 커밋" 계약을 흉내낸다 - 퇴장 유예가 이 계약을 깨지 않는지 보는 게 핵심이다
const Panel = ({
  open,
  target,
  onMount,
  onCommit,
}: {
  open?: boolean;
  target: string | null;
  onMount: () => void;
  onCommit: (target: string | null) => void;
}) => {
  const commitRef = useRef(onCommit);
  const targetRef = useRef(target);
  commitRef.current = onCommit;
  targetRef.current = target;

  useEffect(() => {
    onMount();
    return () => commitRef.current(targetRef.current);
    // 마운트 1회 계약
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div data-testid="panel" data-open={String(open)} />;
};

describe('PopupExit', () => {
  let host: HTMLDivElement;
  let root: Root;

  const panel = () =>
    document.querySelector<HTMLElement>('[data-testid="panel"]');

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const render = async (
    target: string | null,
    hooks: { onMount: () => void; onCommit: (t: string | null) => void },
  ) => {
    const open = target !== null;
    await act(async () => {
      root.render(
        <PopupExit open={open}>
          {target ? (
            <Panel
              open
              target={target}
              onMount={hooks.onMount}
              onCommit={hooks.onCommit}
            />
          ) : null}
        </PopupExit>,
      );
    });
  };

  it('keeps the panel mounted through the exit window and flips open to false', async () => {
    const onMount = vi.fn();
    const onCommit = vi.fn();

    await render('fill', { onMount, onCommit });
    expect(panel()?.dataset.open).toBe('true');
    expect(onMount).toHaveBeenCalledTimes(1);

    // 호출부가 대상을 비우며 닫는다
    await render(null, { onMount, onCommit });
    expect(panel()).not.toBeNull();
    expect(panel()?.dataset.open).toBe('false');
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(panel()).toBeNull();
    // 인스턴스는 한 번만 마운트됐다 - 퇴장 구간에 재마운트되지 않는다
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('commits the last open target when the exit finishes', async () => {
    const onMount = vi.fn();
    const onCommit = vi.fn();

    await render('stroke', { onMount, onCommit });
    await render(null, { onMount, onCommit });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // 대상이 null인 채로 커밋되면 호출부가 저장을 버린다
    expect(onCommit).toHaveBeenCalledWith('stroke');
  });

  it('gives a fresh instance when reopened inside the exit window', async () => {
    const onMount = vi.fn();
    const onCommit = vi.fn();

    await render('fill', { onMount, onCommit });
    await render(null, { onMount, onCommit });
    // 퇴장이 끝나기 전에 다른 대상으로 재오픈
    await render('stroke', { onMount, onCommit });

    expect(panel()?.dataset.open).toBe('true');
    expect(onMount).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenCalledWith('fill');
  });

  // 이 조합이 실제 payoff다 - 호출부가 대상을 비워도 팝업이 퇴장 상태를 거친다
  it('drives a real popup through the closing state before unmount', async () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      document.createElement('div').getBoundingClientRect(),
    ] as unknown as DOMRectList);

    const renderPicker = async (target: string | null) => {
      await act(async () => {
        root.render(
          <PopupExit open={target !== null}>
            {target ? (
              <FloatingPopup
                open
                ariaLabel="Picker"
                fixedX={40}
                fixedY={40}
                autoClose={false}
                onClose={() => undefined}
              >
                <span>{target}</span>
              </FloatingPopup>
            ) : null}
          </PopupExit>,
        );
      });
    };

    await renderPicker('fill');
    const surface = document.querySelector<HTMLElement>(
      '[data-dmn-floating-popup="true"]',
    );
    expect(surface).not.toBeNull();

    await renderPicker(null);
    expect(surface?.getAttribute('data-dmn-motion-state')).toBe('closing');
    // 대상이 비어도 잔상은 마지막 열림 내용을 유지한다
    expect(surface?.textContent).toBe('fill');

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(
      document.querySelector('[data-dmn-floating-popup="true"]'),
    ).toBeNull();
  });
});
