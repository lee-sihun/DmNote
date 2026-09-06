import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FloatingPopup from './FloatingPopup';
import { registerPopupLayer } from '../popupLayer';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 우클릭 메뉴·피커 표면은 body 포털이라 모달 잠금(inert 루트) 밖에 남는다.
// 모달이 자기 위에 쌓이면 스스로 onClose를 부른다
describe('FloatingPopup 모달 잠금', () => {
  let host: HTMLDivElement;
  let root: Root;
  const layerCleanups: Array<() => void> = [];
  const onClose = vi.fn();

  const renderPopup = async (closeOnModalCover?: boolean) => {
    await act(async () =>
      root.render(
        <FloatingPopup
          open
          ariaLabel="popup"
          onClose={onClose}
          animate={false}
          portalToBody
          closeOnModalCover={closeOnModalCover}
        >
          <button type="button">item</button>
        </FloatingPopup>,
      ),
    );
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    onClose.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
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

  it('모달 진입 순간 열려 있던 팝업을 닫는다', async () => {
    await renderPopup();
    expect(onClose).not.toHaveBeenCalled();

    await registerModalLayer();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('모달이 이미 떠 있을 때 연 팝업(모달 안)은 닫지 않는다', async () => {
    await registerModalLayer();

    await renderPopup();
    expect(onClose).not.toHaveBeenCalled();
  });

  // 피커 표면은 자기 흐름에서 알림 모달을 띄운다 - 알림이 피커를 닫으면 안 된다
  it('closeOnModalCover=false면 모달이 덮여도 닫지 않는다', async () => {
    await renderPopup(false);

    await registerModalLayer();
    expect(onClose).not.toHaveBeenCalled();
  });
});
