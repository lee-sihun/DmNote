import { afterEach, describe, expect, it, vi } from 'vitest';

import {
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
