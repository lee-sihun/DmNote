import { useEffect, useRef } from 'react';
import { overlayApi } from '@api/modules/window/overlayApi';
import type { OverlayResizeAnchor } from '@src/types/settings/settings';

interface UseOverlayResizeAnchorControllerOptions {
  overlayResizeAnchor: OverlayResizeAnchor;
  setOverlayResizeAnchor: (anchor: OverlayResizeAnchor) => void;
}

export const useOverlayResizeAnchorController = ({
  overlayResizeAnchor,
  setOverlayResizeAnchor,
}: UseOverlayResizeAnchorControllerOptions) => {
  const pendingResizeAnchorRef = useRef<OverlayResizeAnchor | null>(null);
  const applyingResizeAnchorRef = useRef(false);
  const confirmedResizeAnchorRef = useRef(overlayResizeAnchor);

  useEffect(() => {
    if (!applyingResizeAnchorRef.current) {
      confirmedResizeAnchorRef.current = overlayResizeAnchor;
    }
  }, [overlayResizeAnchor]);

  const enqueueResizeAnchor = (anchor: OverlayResizeAnchor): void => {
    pendingResizeAnchorRef.current = anchor;
    setOverlayResizeAnchor(anchor);
    if (applyingResizeAnchorRef.current) return;

    applyingResizeAnchorRef.current = true;
    void (async () => {
      while (pendingResizeAnchorRef.current) {
        const requested = pendingResizeAnchorRef.current;
        pendingResizeAnchorRef.current = null;
        try {
          await overlayApi.setAnchor(requested);
          confirmedResizeAnchorRef.current = requested;
        } catch (error) {
          console.error('Failed to set overlay anchor', error);
          if (!pendingResizeAnchorRef.current) {
            setOverlayResizeAnchor(confirmedResizeAnchorRef.current);
          }
        }
      }
      applyingResizeAnchorRef.current = false;
    })();
  };

  return enqueueResizeAnchor;
};
