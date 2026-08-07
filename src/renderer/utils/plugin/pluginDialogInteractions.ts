import { setupPluginDropdownInteractions } from './pluginDropdownManager';
import { createPluginHandlerDispatcher } from './pluginHandlerDispatcher';

export const attachPluginDialogInteractions = (root: HTMLElement) => {
  const dispatcher = createPluginHandlerDispatcher();
  const handleCheckboxToggle = (event: Event) => {
    const target = event.target as HTMLElement;
    const checkbox = target.closest('[data-checkbox-toggle]');
    if (!checkbox || !root.contains(checkbox)) return;
    event.preventDefault();

    const input = checkbox.querySelector(
      'input[type=checkbox]',
    ) as HTMLInputElement | null;
    const knob = checkbox.querySelector('div') as HTMLElement | null;
    if (!input || !knob) return;

    input.checked = !input.checked;
    if (input.checked) {
      checkbox.classList.remove('bg-line-strong');
      checkbox.classList.add('bg-accent');
      knob.classList.remove('left-[2px]');
      knob.classList.add('left-[14px]');
    } else {
      checkbox.classList.remove('bg-accent');
      checkbox.classList.add('bg-line-strong');
      knob.classList.remove('left-[14px]');
      knob.classList.add('left-[2px]');
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const handleInputBlur = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (
      input.tagName !== 'INPUT' ||
      input.type !== 'number' ||
      !input.hasAttribute('data-plugin-input-blur')
    ) {
      return;
    }

    const minValue = input.getAttribute('data-plugin-input-min');
    const maxValue = input.getAttribute('data-plugin-input-max');
    const parsedValue = Number.parseFloat(input.value);

    if (input.value === '' || Number.isNaN(parsedValue)) {
      input.value = String(minValue ? Number.parseFloat(minValue) : 0);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    let clampedValue = parsedValue;
    if (minValue && parsedValue < Number.parseFloat(minValue)) {
      clampedValue = Number.parseFloat(minValue);
    }
    if (maxValue && parsedValue > Number.parseFloat(maxValue)) {
      clampedValue = Number.parseFloat(maxValue);
    }

    if (clampedValue !== parsedValue) {
      input.value = String(clampedValue);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  const handleEvent = (event: Event) => {
    const target = event.target as HTMLElement;
    const handlerAttribute =
      event.type === 'click'
        ? 'data-plugin-handler'
        : event.type === 'input'
        ? 'data-plugin-handler-input'
        : event.type === 'change'
        ? 'data-plugin-handler-change'
        : null;
    if (!handlerAttribute) return;

    let element: HTMLElement | null = target;
    while (element && element !== root) {
      const handlerName = element.getAttribute(handlerAttribute);
      if (handlerName) {
        const handler = (window as unknown as Record<string, unknown>)[
          handlerName
        ];
        if (typeof handler === 'function') {
          dispatcher.dispatch(
            element,
            handler as (event: Event) => unknown,
            event,
          );
        }
        return;
      }
      element = element.parentElement;
    }
  };

  const detachDropdowns = setupPluginDropdownInteractions(root);
  root.addEventListener('click', handleCheckboxToggle);
  root.addEventListener('click', handleEvent);
  root.addEventListener('change', handleEvent);
  root.addEventListener('input', handleEvent);
  root.addEventListener('blur', handleInputBlur, true);

  return () => {
    dispatcher.cleanup();
    root.removeEventListener('click', handleCheckboxToggle);
    root.removeEventListener('click', handleEvent);
    root.removeEventListener('change', handleEvent);
    root.removeEventListener('input', handleEvent);
    root.removeEventListener('blur', handleInputBlur, true);
    detachDropdowns();
  };
};
