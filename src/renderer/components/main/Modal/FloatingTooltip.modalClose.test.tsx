import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FloatingTooltip from './FloatingTooltip';
import { registerPopupLayer } from './popupLayer';

// floating-ui autoUpdate가 요구하는 jsdom에 없는 API
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('FloatingTooltip 모달 잠금', () => {
  let host: HTMLDivElement;
  let root: Root;
  const layerCleanups: Array<() => void> = [];

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root.render(
        <FloatingTooltip content="tip" delay={0}>
          <button data-testid="anchor" />
        </FloatingTooltip>,
      ),
    );
  });

  afterEach(async () => {
    await act(async () =>
      layerCleanups
        .splice(0)
        .reverse()
        .forEach((cleanup) => cleanup()),
    );
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const registerModalLayer = async () => {
    const layer = document.createElement('div');
    layer.setAttribute('data-dmn-modal-backdrop', 'true');
    document.body.appendChild(layer);
    await act(async () => layerCleanups.push(registerPopupLayer(layer)));
  };

  const hoverAnchor = async () => {
    const anchor = host.querySelector('[data-testid="anchor"]')!;
    await act(async () => {
      // React의 onMouseEnter는 mouseover에서 합성된다 - relatedTarget이 밖이면 진입
      anchor.parentElement!.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true }),
      );
    });
  };

  // 툴팁은 인라인 z-70이라 스태킹 컨텍스트 없는 조상 밖에서 모달(z-50) 위로 뜬다.
  // 잠긴 크롬은 inert가 mouseleave를 만들어주지 않아 스스로 닫히지 못한다
  it('모달 진입 순간 열려 있던 툴팁을 닫는다', async () => {
    await hoverAnchor();
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();

    await registerModalLayer();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('모달이 이미 열린 뒤에 여는 툴팁은 막지 않는다', async () => {
    await registerModalLayer();

    // 모달 내부 컨트롤의 툴팁이 이 경로다 - 전환 이후의 열기는 그대로 동작
    await hoverAnchor();
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  });
});
