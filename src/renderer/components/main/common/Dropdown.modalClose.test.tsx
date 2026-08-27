import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPopupLayer } from '../Modal/popupLayer';
import Dropdown from './Dropdown';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 닫힘 모션이 도는 동안 메뉴 DOM은 잠깐 남는다. 열려 있는 메뉴만 센다
const openListbox = () =>
  document.querySelector(
    '[role="listbox"]:not([data-dmn-motion-state="closing"])',
  );

// 드롭다운 메뉴는 body 포털(z 60)이라 모달(z 50) 위에 뜨고 inert 루트 밖에 있다.
// 모달이 덮이면 스스로 닫혀야 배경 조작이 실제로 잠긴다
describe('Dropdown 모달 잠금', () => {
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
        <Dropdown
          options={[
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ]}
          value="a"
          onChange={vi.fn()}
        />,
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

  const openMenu = async () => {
    const trigger = host.querySelector<HTMLButtonElement>('button')!;
    await act(async () => trigger.click());
  };

  it('모달 진입 순간 열려 있던 메뉴를 닫는다', async () => {
    await openMenu();
    expect(openListbox()).not.toBeNull();

    await registerModalLayer();
    expect(openListbox()).toBeNull();
  });

  it('모달 안에서 연 메뉴(모달보다 뒤에 등록)는 닫지 않는다', async () => {
    await registerModalLayer();

    await openMenu();
    expect(openListbox()).not.toBeNull();
  });

  it('모달 안 메뉴 위에 두 번째 모달(알림)이 뜨면 닫는다', async () => {
    await registerModalLayer();
    await openMenu();
    expect(openListbox()).not.toBeNull();

    await registerModalLayer();
    expect(openListbox()).toBeNull();
  });
});
