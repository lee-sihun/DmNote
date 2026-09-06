type PluginHandler = (event: Event) => unknown;

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  'then' in value &&
  typeof value.then === 'function';

interface PendingInput {
  element: HTMLElement;
  handler: PluginHandler;
  event: Event;
}

export const createPluginHandlerDispatcher = (
  inputStrategy: 'sync' | 'frame' = 'frame',
) => {
  const pendingInputs = new Map<HTMLElement, PendingInput>();
  const pendingActions = new WeakSet<HTMLElement>();
  let frame: number | null = null;

  const flushInputs = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const pending = [...pendingInputs.values()];
    pendingInputs.clear();
    pending.forEach(({ handler, event }) => {
      try {
        const result = handler(event);
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch((error) =>
            console.error('Plugin input handler failed', error),
          );
        }
      } catch (error) {
        console.error('Plugin input handler failed', error);
      }
    });
  };

  const scheduleInput = (pending: PendingInput) => {
    pendingInputs.set(pending.element, pending);
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      flushInputs();
    });
  };

  const dispatch = (
    element: HTMLElement,
    handler: PluginHandler,
    event: Event,
  ) => {
    if (event.type === 'input') {
      if (inputStrategy === 'sync') {
        try {
          const result = handler(event);
          if (isPromiseLike(result)) {
            void Promise.resolve(result).catch((error) =>
              console.error('Plugin input handler failed', error),
            );
          }
        } catch (error) {
          console.error('Plugin input handler failed', error);
        }
        return;
      }
      scheduleInput({ element, handler, event });
      return;
    }

    flushInputs();
    if (event.type === 'click' && pendingActions.has(element)) return;

    try {
      const result = handler(event);
      if (!isPromiseLike(result) || event.type !== 'click') return;

      pendingActions.add(element);
      const button = element instanceof HTMLButtonElement ? element : null;
      const wasDisabled = button?.disabled ?? false;
      element.setAttribute('aria-busy', 'true');
      if (button) button.disabled = true;
      void Promise.resolve(result)
        .catch((error) => console.error('Plugin action handler failed', error))
        .finally(() => {
          pendingActions.delete(element);
          element.removeAttribute('aria-busy');
          if (button) button.disabled = wasDisabled;
        });
    } catch (error) {
      console.error('Plugin action handler failed', error);
    }
  };

  const cleanup = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pendingInputs.clear();
  };

  return { dispatch, flushInputs, cleanup };
};
