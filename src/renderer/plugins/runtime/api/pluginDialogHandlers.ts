import {
  unregisterComponentHandler,
  withComponentHandlerTracking,
} from '@utils/plugin/components/pluginUtils';
import { handlerRegistry } from '../handlers';

export const createPluginDialogHandlerScope = () => {
  const registryHandlerIds = new Set<string>();
  const componentHandlerIds = new Set<string>();

  return {
    capture<T>(factory: () => T): T {
      return withComponentHandlerTracking(
        (handlerId) => componentHandlerIds.add(handlerId),
        factory,
      );
    },
    trackRegistryHandler(handlerId: string): string {
      registryHandlerIds.add(handlerId);
      return handlerId;
    },
    dispose(): void {
      componentHandlerIds.forEach(unregisterComponentHandler);
      componentHandlerIds.clear();
      registryHandlerIds.forEach((handlerId) =>
        handlerRegistry.unregister(handlerId),
      );
      registryHandlerIds.clear();
    },
  };
};
