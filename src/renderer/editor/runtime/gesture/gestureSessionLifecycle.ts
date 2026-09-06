export interface GestureSessionLifecycle {
  readonly sessionId: string;
  discarded: boolean;
}

const sessions = new Map<string, GestureSessionLifecycle>();

export const registerGestureSession = (
  sessionId: string,
): GestureSessionLifecycle => {
  const lifecycle = { sessionId, discarded: false };
  sessions.set(sessionId, lifecycle);
  return lifecycle;
};

export const markGestureSessionsDiscarded = (
  sessionIds: readonly string[],
): void => {
  sessionIds.forEach((sessionId) => {
    const lifecycle = sessions.get(sessionId);
    if (lifecycle) lifecycle.discarded = true;
  });
};

export const releaseGestureSession = (
  lifecycle: GestureSessionLifecycle,
): void => {
  if (sessions.get(lifecycle.sessionId) === lifecycle) {
    sessions.delete(lifecycle.sessionId);
  }
};
