import { useSyncExternalStore } from 'react';

const popupLayerStack: HTMLElement[] = [];
const modalLayerListeners = new Set<() => void>();
let modalLayerActive = false;

const isModalLayer = (layer: HTMLElement) =>
  layer.getAttribute('data-dmn-modal-backdrop') === 'true';

const readModalLayerActive = () =>
  popupLayerStack.some((layer) => layer.isConnected && isModalLayer(layer));

// 집계 boolean이 바뀔 때 알린다. 모달 레이어 자체의 등록·해제는 집계가 그대로여도
// 알린다 - 모달 위에 뜬 두 번째 모달(알림)도 아래 팝업을 덮으므로 팝업이 다시 물어야 한다.
// useModalLayerActive는 snapshot 비교로 걸러져 불필요한 재렌더는 없다
const publishModalLayerActivity = (modalLayerChanged = false) => {
  const next = readModalLayerActive();
  if (next === modalLayerActive && !modalLayerChanged) return;
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
  publishModalLayerActivity(isModalLayer(element));
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    if (removePopupLayer(element)) {
      publishModalLayerActivity(isModalLayer(element));
    }
  };
};

// useSyncExternalStore snapshot은 render 중에도 호출되므로 읽기만 수행
export const isModalLayerActive = readModalLayerActive;

export const subscribeModalLayerActivity = (listener: () => void) => {
  modalLayerListeners.add(listener);
  return () => {
    modalLayerListeners.delete(listener);
  };
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

// 자기 위에 모달이 덮였는지 — DOM 포함이 아니라 스택 순서로 판정한다.
// body 포털 팝업은 조상 체인에 모달이 없고 분리 패널 창은 문서가 다르지만,
// 모달 안에서 연 팝업은 모달보다 뒤에 등록되므로 false(닫히면 안 된다).
// 스택에 없는 요소는 판정 불가라 닫지 않는다.
// 전제: 팝업이 모달과 같은 커밋에 열린 채 마운트되지 않는다(자식 layout effect가
// 부모보다 먼저 등록돼 순서가 뒤집힌다) - 열림 초기값 true인 팝업을 모달 안에 두지 말 것.
// 반대로 FloatingPopup 표면 등록은 presence 때문에 열림보다 한 커밋 늦으므로, 같은
// 핸들러에서 팝업과 모달을 함께 열면 팝업이 모달 뒤에 서서 "모달 안 팝업"으로 오판된다
export const hasModalLayerAbove = (element: HTMLElement | null) => {
  if (!element) return false;
  if (removeDisconnectedLayers()) publishModalLayerActivity();
  const index = popupLayerStack.lastIndexOf(element);
  if (index < 0) return false;
  return popupLayerStack
    .slice(index + 1)
    .some((layer) => layer.isConnected && isModalLayer(layer));
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
