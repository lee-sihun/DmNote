export interface CustomDialogCallbacks {
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface CustomDialogCallbackRef {
  current: CustomDialogCallbacks;
}

export const replaceCustomDialogCallbacks = (
  ref: CustomDialogCallbackRef,
  next: CustomDialogCallbacks,
): void => {
  const previous = ref.current;
  ref.current = next;
  previous.onCancel?.();
};

export const closeCustomDialogOwnedSurface = (
  referenceElement: HTMLElement | undefined,
  close: () => void,
): void => {
  if (referenceElement?.closest('[data-plugin-dialog-content]')) close();
};
