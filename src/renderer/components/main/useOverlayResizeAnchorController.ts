import { useEffect, useRef } from 'react';
import { overlayApi } from '@api/modules/overlayApi';
import type { I18nContextValue } from '@contexts/I18nContextDef';
import type { OverlayResizeAnchor } from '@src/types/settings/settings';

interface UseOverlayResizeAnchorControllerOptions {
  overlayResizeAnchor: OverlayResizeAnchor;
  setOverlayResizeAnchor: (anchor: OverlayResizeAnchor) => void;
  t: I18nContextValue['t'];
  showAlert: (msg: string, confirmText?: string) => void;
}

export const useOverlayResizeAnchorController = ({
  overlayResizeAnchor,
  setOverlayResizeAnchor,
  t,
  showAlert,
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
          showAlert(t('common.saveFailed'));
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
