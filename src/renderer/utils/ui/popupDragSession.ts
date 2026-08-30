export type PopupDragSessionState = 'idle' | 'pending' | 'active';

type PopupDragSessionListener = (state: PopupDragSessionState) => void;

let state: PopupDragSessionState = 'idle';
const listeners = new Set<PopupDragSessionListener>();

const setState = (next: PopupDragSessionState) => {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener(state);
};

export const getPopupDragSessionState = () => state;

export const beginPopupDragSession = () => setState('pending');

export const activatePopupDragSession = () => setState('active');

export const endPopupDragSession = () => setState('idle');

export const subscribePopupDragSession = (
  listener: PopupDragSessionListener,
) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
