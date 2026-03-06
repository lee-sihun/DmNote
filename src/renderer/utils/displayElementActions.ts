type ActionMap = Record<string, (...args: unknown[]) => unknown>;

const actionRegistry = new Map<string, ActionMap>();

export const registerExposedActions = (
  elementId: string,
  actions: ActionMap,
) => {
  if (!elementId) return;
  const validEntries = Object.entries(actions || {}).filter(
    ([, fn]) => typeof fn === 'function',
  );
  if (validEntries.length === 0) return;

  const next = { ...(actionRegistry.get(elementId) || {}) };
  validEntries.forEach(([key, fn]) => {
    next[key] = fn;
  });
  actionRegistry.set(elementId, next);
};

export const clearExposedActions = (elementId: string) => {
  if (!elementId) return;
  actionRegistry.delete(elementId);
};

export const invokeExposedAction = async (
  elementId: string,
  action: string,
  args: unknown[] = [],
) => {
  const actions = actionRegistry.get(elementId);
  if (!actions) {
    console.warn(
      `[PluginElement] No exposed actions registered for '${elementId}'`,
    );
    return;
  }

  const fn = actions[action];
  if (typeof fn !== 'function') {
    console.warn(
      `[PluginElement] Action '${action}' is not exposed for '${elementId}'`,
    );
    return;
  }

  try {
    await fn(...args);
  } catch (error) {
    console.error(
      `[PluginElement] Action '${action}' failed for '${elementId}'`,
      error,
    );
  }
};
