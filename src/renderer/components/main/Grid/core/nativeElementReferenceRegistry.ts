export type NativeElementReferenceRegistry = Map<string, HTMLElement>;

export const updateNativeElementReference = (
  registry: NativeElementReferenceRegistry,
  key: string,
  node: HTMLElement | null,
): void => {
  if (node === null) {
    registry.delete(key);
    return;
  }
  registry.set(key, node);
};
