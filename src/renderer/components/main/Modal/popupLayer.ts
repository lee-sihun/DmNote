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
