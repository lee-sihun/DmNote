const popupLayerStack: HTMLElement[] = [];

const removePopupLayer = (element: HTMLElement) => {
  const index = popupLayerStack.lastIndexOf(element);
  if (index >= 0) popupLayerStack.splice(index, 1);
};

const removeDisconnectedLayers = () => {
  for (let index = popupLayerStack.length - 1; index >= 0; index -= 1) {
    if (!popupLayerStack[index].isConnected) {
      popupLayerStack.splice(index, 1);
    }
  }
};

export const registerPopupLayer = (element: HTMLElement) => {
  removePopupLayer(element);
  popupLayerStack.push(element);
  return () => removePopupLayer(element);
};

export const isTopmostPopupLayer = (element: HTMLElement | null) => {
  if (!element) return false;
  removeDisconnectedLayers();
  return popupLayerStack[popupLayerStack.length - 1] === element;
};

// 위에 쌓인 레이어 안쪽을 가리키는지 — 자식 팝업이 body로 포털돼 부모 DOM 밖에 있어도
// 그 클릭으로 부모가 닫히면 안 된다 (Escape 소유권과 같은 규칙)
export const isInsideHigherPopupLayer = (
  element: HTMLElement | null,
  target: Node | null,
) => {
  if (!element || !target) return false;
  removeDisconnectedLayers();
  const index = popupLayerStack.lastIndexOf(element);
  if (index < 0) return false;
  return popupLayerStack
    .slice(index + 1)
    .some((layer) => layer.contains(target));
};
