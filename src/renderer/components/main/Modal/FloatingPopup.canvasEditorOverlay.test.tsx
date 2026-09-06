import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FloatingPopup from './floatingPopup/FloatingPopup';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 온캔버스 편집 오버레이(그라데이션 축 핸들·자세 손끝 기즈모)는 팝업 밖 DOM이지만
// 조작 자체가 그 팝업의 편집이다. capture 단계 바깥 클릭 판정이 이걸 예외로
// 인정하지 않으면 노브를 누르는 순간 팝업이 닫혀 핸들을 쓸 수 없다
describe('FloatingPopup 온캔버스 편집 오버레이', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();

  // 두 닫힘 경로 모두 예외를 알아야 한다 - PickerSurface(자세 팝업)는
  // autoClose=false라 capture 판정을 타고, 기본 팝업은 mousedown 판정을 탄다
  const renderPopup = async (autoClose: boolean) => {
    await act(async () =>
      root.render(
        <FloatingPopup
          open
          ariaLabel="popup"
          onClose={onClose}
          animate={false}
          portalToBody
          autoClose={autoClose}
        >
          <button type="button">item</button>
        </FloatingPopup>,
      ),
    );
  };

  // 캔버스 오버레이는 팝업과 무관한 자리에 렌더된다 (Grid 안, body 포털 밖)
  const canvasNode = (marker?: string) => {
    const overlay = document.createElement('div');
    if (marker) overlay.setAttribute(marker, 'true');
    const knob = document.createElement('div');
    overlay.appendChild(knob);
    host.appendChild(overlay);
    return knob;
  };

  const press = (node: Element, type: 'pointerdown' | 'mousedown') =>
    act(() => {
      node.dispatchEvent(
        type === 'pointerdown'
          ? new PointerEvent(type, { bubbles: true, cancelable: true })
          : new MouseEvent(type, { bubbles: true, cancelable: true }),
      );
    });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    onClose.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('capture 판정에서 마커가 붙은 오버레이 조작은 팝업을 닫지 않는다', async () => {
    await renderPopup(false);

    await press(canvasNode('data-dmn-canvas-editor-overlay'), 'pointerdown');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('capture 판정에서 마커 없는 캔버스 클릭은 그대로 팝업을 닫는다', async () => {
    await renderPopup(false);

    await press(canvasNode(), 'pointerdown');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('autoClose 판정도 같은 마커를 예외로 본다', async () => {
    await renderPopup(true);

    await press(canvasNode('data-dmn-canvas-editor-overlay'), 'mousedown');
    expect(onClose).not.toHaveBeenCalled();

    await press(canvasNode(), 'mousedown');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
