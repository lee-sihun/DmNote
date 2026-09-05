const COMPLETED_HISTORY_FLUSH_LIMIT = 16;

interface LockedHistoryDocument {
  root: HTMLElement;
  wasInert: boolean;
  previousAriaBusy: string | null;
  eventTarget: Window | Document;
}

interface ActiveHistoryFlushLock {
  handshakeId: string;
  documents: Map<Document, LockedHistoryDocument>;
}

let activeLock: ActiveHistoryFlushLock | null = null;
const registeredDocuments = new Set<Document>();
const completedHandshakeIds: string[] = [];
const flushStartListeners = new Set<() => void>();
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

const setInteractionBlocker = (target: Window | Document, enabled: boolean) => {
  BLOCKED_EVENT_TYPES.forEach((eventType) => {
    if (enabled) {
      target.addEventListener(eventType, blockInteraction, true);
    } else {
      target.removeEventListener(eventType, blockInteraction, true);
    }
  });
};

const lockDocument = (doc: Document) => {
  if (!activeLock || activeLock.documents.has(doc)) return;
  const root = doc.documentElement;
  const eventTarget = doc.defaultView ?? doc;
  activeLock.documents.set(doc, {
    root,
    wasInert: root.inert === true,
    previousAriaBusy: root.getAttribute('aria-busy'),
    eventTarget,
  });
  root.inert = true;
  root.setAttribute('aria-busy', 'true');
  setInteractionBlocker(eventTarget, true);
};

const unlockDocument = (doc: Document) => {
  const locked = activeLock?.documents.get(doc);
  if (!locked) return;
  setInteractionBlocker(locked.eventTarget, false);
  locked.root.inert = locked.wasInert;
  if (locked.previousAriaBusy === null) {
    locked.root.removeAttribute('aria-busy');
  } else {
    locked.root.setAttribute('aria-busy', locked.previousAriaBusy);
  }
  activeLock?.documents.delete(doc);
};

export const registerHistoryEditorFlushDocument = (
  doc: Document,
): (() => void) => {
  registeredDocuments.add(doc);
  lockDocument(doc);
  return () => {
    registeredDocuments.delete(doc);
    unlockDocument(doc);
  };
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
  [...activeLock.documents.keys()].forEach(unlockDocument);
  activeLock = null;
};

export const acquireHistoryEditorFlushLock = (handshakeId: string): boolean => {
  if (completedHandshakeIds.includes(handshakeId)) return false;
  if (activeLock?.handshakeId === handshakeId) return true;

  restoreActiveLock();
  activeLock = {
    handshakeId,
    documents: new Map(),
  };
  const errors: unknown[] = [];
  flushStartListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      errors.push(error);
    }
  });
  lockDocument(document);
  registeredDocuments.forEach(lockDocument);
  if (errors.length > 0) throw errors[0];
  return true;
};

export const subscribeHistoryEditorFlushStart = (
  listener: () => void,
): (() => void) => {
  flushStartListeners.add(listener);
  return () => {
    flushStartListeners.delete(listener);
  };
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
