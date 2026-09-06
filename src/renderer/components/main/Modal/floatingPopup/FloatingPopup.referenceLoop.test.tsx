// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingPopup from './FloatingPopup';

const { setReferenceCalls } = vi.hoisted(() => ({
  setReferenceCalls: vi.fn(),
}));

vi.mock('@floating-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/react')>();
  const ReactModule = await import('react');

  return {
    ...actual,
    useFloating: (options: Parameters<typeof actual.useFloating>[0]) => {
      const floating = actual.useFloating(options);
      const [, forceRender] = ReactModule.useReducer(
        (revision) => revision + 1,
        0,
      );
      const setReference: typeof floating.refs.setReference = (node) => {
        setReferenceCalls(node);
        floating.refs.setReference(node);
        forceRender();
      };

      return {
        ...floating,
        refs: { ...floating.refs, setReference },
      };
    },
  };
});

describe('FloatingPopup 동일 참조 반복 동기화 방지', () => {
  let host: HTMLDivElement;
  let root: Root;
  let anchor: HTMLButtonElement;
  let referenceRef: React.RefObject<HTMLElement>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    setReferenceCalls.mockClear();
    host = document.createElement('div');
    anchor = document.createElement('button');
    document.body.append(anchor, host);
    referenceRef = { current: anchor };
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const renderPopup = async (revision: string) => {
    await act(async () => {
      root.render(
        <FloatingPopup
          open
          ariaLabel="반복 참조 테스트"
          referenceRef={referenceRef}
          fixedX={20}
          fixedY={30}
          animate={false}
          autoClose={false}
          onClose={() => undefined}
        >
          <span>{revision}</span>
        </FloatingPopup>,
      );
    });
  };

  it('내용이 다시 렌더되어도 같은 DOM 노드는 한 번만 전달한다', async () => {
    await renderPopup('처음');
    await renderPopup('변경');

    expect(setReferenceCalls).toHaveBeenCalledTimes(1);
    expect(setReferenceCalls).toHaveBeenCalledWith(anchor);
  });
});
