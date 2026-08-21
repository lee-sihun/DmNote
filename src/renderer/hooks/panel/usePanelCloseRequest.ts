import { useEffect, useRef } from 'react';

import { panelWindowApi } from '@api/modules/panelWindowApi';
import {
  dockPropertiesPanel,
  isTransitionFailure,
  usePanelHostStore,
} from '@stores/grid/usePanelHostStore';

const waitForPanelTransitionIdle = (): Promise<void> => {
  if (usePanelHostStore.getState().transition === 'idle') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const unsubscribe = usePanelHostStore.subscribe((state) => {
      if (state.transition !== 'idle') return;
      unsubscribe();
      resolve();
    });
    if (usePanelHostStore.getState().transition === 'idle') {
      unsubscribe();
      resolve();
    }
  });
};

export const usePanelCloseRequest = (onFailure?: () => void): void => {
  const onFailureRef = useRef(onFailure);

  useEffect(() => {
    onFailureRef.current = onFailure;
  }, [onFailure]);

  useEffect(
    () =>
      panelWindowApi.onCloseRequested(({ requestId }) => {
        void (async () => {
          await panelWindowApi.ackClose(requestId).catch((error) => {
            console.error('Failed to acknowledge panel close request', error);
          });
          let outcome = await dockPropertiesPanel();
          while (outcome === 'busy') {
            await waitForPanelTransitionIdle();
            outcome = await dockPropertiesPanel();
          }
          if (isTransitionFailure(outcome)) {
            onFailureRef.current?.();
          }
        })().catch((error) => {
          console.error('Failed to handle panel close request', error);
          onFailureRef.current?.();
        });
      }),
    [],
  );
};
