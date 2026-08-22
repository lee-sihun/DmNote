import { useSyncExternalStore } from 'react';

const popupLayerStack: HTMLElement[] = [];
const modalLayerListeners = new Set<() => void>();
let modalLayerActive = false;

const readModalLayerActive = () =>
  popupLayerStack.some(
    (layer) =>
      layer.isConnected &&
      layer.getAttribute('data-dmn-modal-backdrop') === 'true',
  );

const publishModalLayerActivity = () => {
  const next = readModalLayerActive();
  if (next === modalLayerActive) return;
  modalLayerActive = next;
  [...modalLayerListeners].forEach((listener) => listener());
};

const removePopupLayer = (element: HTMLElement) => {
  const index = popupLayerStack.lastIndexOf(element);
  if (index < 0) return false;
  popupLayerStack.splice(index, 1);
  return true;
};

const removeDisconnectedLayers = () => {
  let removed = false;
  for (let index = popupLayerStack.length - 1; index >= 0; index -= 1) {
    if (!popupLayerStack[index].isConnected) {
      popupLayerStack.splice(index, 1);
      removed = true;
    }
  }
  return removed;
};

export const registerPopupLayer = (element: HTMLElement) => {
  removeDisconnectedLayers();
  removePopupLayer(element);
  popupLayerStack.push(element);
  publishModalLayerActivity();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    if (removePopupLayer(element)) publishModalLayerActivity();
  };
};

// useSyncExternalStore snapshot은 render 중에도 호출되므로 읽기만 수행
export const isModalLayerActive = readModalLayerActive;

export const subscribeModalLayerActivity = (listener: () => void) => {
  modalLayerListeners.add(listener);
  return () => modalLayerListeners.delete(listener);
};

export const useModalLayerActive = () =>
  useSyncExternalStore(
    subscribeModalLayerActivity,
    isModalLayerActive,
    isModalLayerActive,
  );

export const isTopmostPopupLayer = (element: HTMLElement | null) => {
  if (!element) return false;
  if (removeDisconnectedLayers()) publishModalLayerActivity();
  return popupLayerStack[popupLayerStack.length - 1] === element;
};

// 위에 쌓인 레이어 안쪽을 가리키는지 — 자식 팝업이 body로 포털돼 부모 DOM 밖에 있어도
// 그 클릭으로 부모가 닫히면 안 된다 (Escape 소유권과 같은 규칙)
export const isInsideHigherPopupLayer = (
  element: HTMLElement | null,
  target: Node | null,
) => {
  if (!element || !target) return false;
  if (removeDisconnectedLayers()) publishModalLayerActivity();
  const index = popupLayerStack.lastIndexOf(element);
  if (index < 0) return false;
  return popupLayerStack
    .slice(index + 1)
    .some((layer) => layer.contains(target));
};
