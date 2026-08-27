import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasModalLayerAbove,
  isModalLayerActive,
  registerPopupLayer,
  subscribeModalLayerActivity,
} from './popupLayer';

const appendLayer = (attribute: 'modal' | 'popup') => {
  const element = document.createElement('div');
  element.setAttribute(
    attribute === 'modal' ? 'data-dmn-modal-backdrop' : 'data-dmn-popup-layer',
    'true',
  );
  document.body.appendChild(element);
  return element;
};

describe('popupLayer modal activity', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => cleanup());
    document.body.innerHTML = '';
  });

  it('비모달 레이어는 배경 입력을 잠그지 않는다', () => {
    const popup = appendLayer('popup');
    cleanups.push(registerPopupLayer(popup));

    expect(isModalLayerActive()).toBe(false);
  });

  it('마지막 모달이 해제될 때까지 잠금을 유지한다', () => {
    const first = appendLayer('modal');
    const second = appendLayer('modal');
    const unregisterFirst = registerPopupLayer(first);
    const unregisterSecond = registerPopupLayer(second);
    cleanups.push(unregisterFirst, unregisterSecond);

    expect(isModalLayerActive()).toBe(true);
    unregisterSecond();
    expect(isModalLayerActive()).toBe(true);
    unregisterFirst();
    expect(isModalLayerActive()).toBe(false);
  });

  it('snapshot 조회는 끊긴 모달을 무시하되 render 중 알림을 만들지 않는다', () => {
    const listener = vi.fn();
    cleanups.push(subscribeModalLayerActivity(listener));
    const modal = appendLayer('modal');
    cleanups.push(registerPopupLayer(modal));
    expect(listener).toHaveBeenCalledOnce();

    modal.remove();
    expect(isModalLayerActive()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();

    const popup = appendLayer('popup');
    cleanups.push(registerPopupLayer(popup));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('hasModalLayerAbove', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => cleanup());
    document.body.innerHTML = '';
  });

  it('팝업 뒤에 등록된 모달은 팝업을 덮는다', () => {
    const popup = appendLayer('popup');
    cleanups.push(registerPopupLayer(popup));
    cleanups.push(registerPopupLayer(appendLayer('modal')));

    expect(hasModalLayerAbove(popup)).toBe(true);
  });

  it('모달 안에서 연 팝업(모달보다 뒤 등록)은 덮이지 않은 것으로 본다', () => {
    cleanups.push(registerPopupLayer(appendLayer('modal')));
    const popup = appendLayer('popup');
    cleanups.push(registerPopupLayer(popup));

    expect(hasModalLayerAbove(popup)).toBe(false);
  });

  // 집계 boolean은 true 그대로지만 아래 팝업이 새 모달에 덮이므로 알려야 한다
  it('모달 위에 두 번째 모달이 등록되면 구독자에게 알린다', () => {
    const listener = vi.fn();
    cleanups.push(subscribeModalLayerActivity(listener));
    cleanups.push(registerPopupLayer(appendLayer('modal')));
    const popup = appendLayer('popup');
    cleanups.push(registerPopupLayer(popup));
    expect(listener).toHaveBeenCalledTimes(1);

    const unregisterSecond = registerPopupLayer(appendLayer('modal'));
    cleanups.push(unregisterSecond);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(hasModalLayerAbove(popup)).toBe(true);

    unregisterSecond();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(hasModalLayerAbove(popup)).toBe(false);
  });

  it('스택에 없는 요소와 끊긴 모달은 판정하지 않는다', () => {
    const stranger = appendLayer('popup');
    expect(hasModalLayerAbove(stranger)).toBe(false);
    expect(hasModalLayerAbove(null)).toBe(false);

    const popup = appendLayer('popup');
    cleanups.push(registerPopupLayer(popup));
    const modal = appendLayer('modal');
    cleanups.push(registerPopupLayer(modal));
    modal.remove();
    expect(hasModalLayerAbove(popup)).toBe(false);
  });
});
