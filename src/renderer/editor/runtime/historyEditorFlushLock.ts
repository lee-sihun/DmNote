const COMPLETED_HISTORY_FLUSH_LIMIT = 16;

interface ActiveHistoryFlushLock {
  handshakeId: string;
  root: HTMLElement;
  wasInert: boolean;
}

let activeLock: ActiveHistoryFlushLock | null = null;
const completedHandshakeIds: string[] = [];
const BLOCKED_EVENT_TYPES = [
  'keydown',
  'keyup',
  'keypress',
  'pointerdown',
  'mousedown',
  'click',
  'contextmenu',
] as const;

const blockInteraction = (event: Event) => {
  if (!activeLock) return;
  event.preventDefault();
  event.stopImmediatePropagation();
};

const setInteractionBlocker = (enabled: boolean) => {
  BLOCKED_EVENT_TYPES.forEach((eventType) => {
    if (enabled) {
      window.addEventListener(eventType, blockInteraction, true);
    } else {
      window.removeEventListener(eventType, blockInteraction, true);
    }
  });
};

const rememberCompletedHandshake = (handshakeId: string) => {
  if (completedHandshakeIds.includes(handshakeId)) return;
  completedHandshakeIds.push(handshakeId);
  if (completedHandshakeIds.length > COMPLETED_HISTORY_FLUSH_LIMIT) {
    completedHandshakeIds.shift();
  }
};

const restoreActiveLock = () => {
  if (!activeLock) return;
  setInteractionBlocker(false);
  activeLock.root.inert = activeLock.wasInert;
  activeLock = null;
};

export const acquireHistoryEditorFlushLock = (handshakeId: string): boolean => {
  if (completedHandshakeIds.includes(handshakeId)) return false;
  if (activeLock?.handshakeId === handshakeId) return true;

  restoreActiveLock();
  const root = document.documentElement;
  activeLock = {
    handshakeId,
    root,
    wasInert: root.inert === true,
  };
  root.inert = true;
  setInteractionBlocker(true);
  return true;
};

export const releaseHistoryEditorFlushLock = (handshakeId: string): void => {
  rememberCompletedHandshake(handshakeId);
  if (activeLock?.handshakeId !== handshakeId) return;
  restoreActiveLock();
};

export const isHistoryEditorFlushLocked = (): boolean => activeLock !== null;

export const resetHistoryEditorFlushLock = (): void => {
  restoreActiveLock();
  completedHandshakeIds.length = 0;
};
