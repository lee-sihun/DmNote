import { useEffect, useRef, useState } from 'react';
import { obsApi } from '@api/modules/window/obsApi';
import { settingsApi } from '@api/modules/app/settingsApi';
import type { I18nContextValue } from '@contexts/I18nContextDef';
import type { ObsStatus } from '@src/types/obs';
import { DEFAULT_OBS_PORT } from '@src/types/obs';

interface UseObsSettingsControllerOptions {
  t: I18nContextValue['t'];
  showAlert: (msg: string, confirmText?: string) => void;
  showConfirm: (
    msg: string,
    onConfirm: () => void,
    options?: {
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    },
  ) => void;
}

export const useObsSettingsController = ({
  t,
  showAlert,
  showConfirm,
}: UseObsSettingsControllerOptions): {
  obsStatus: ObsStatus;
  handleObsToggle: () => Promise<void>;
  handleObsCopyUrl: () => Promise<void>;
  handleObsRegenerateToken: () => void;
} => {
  const [obsStatus, setObsStatus] = useState<ObsStatus>({
    running: false,
    port: DEFAULT_OBS_PORT,
    clientCount: 0,
  });
  const obsTogglingRef = useRef(false);
  const regeneratingObsTokenRef = useRef(false);

  // OBS 상태 이벤트 구독 + clientCount 폴링
  useEffect(() => {
    let mounted = true;
    obsApi
      .status()
      .then((status) => {
        if (mounted) setObsStatus(status);
      })
      .catch(() => undefined);

    // start/stop 이벤트 구독
    const unsubscribe = obsApi.onStatus((status) => {
      if (mounted) setObsStatus(status);
    });

    // clientCount는 connect/disconnect 이벤트가 없으므로 폴링 유지
    const interval = setInterval(async () => {
      try {
        const status = await obsApi.status();
        if (mounted) {
          setObsStatus((prev) =>
            prev.clientCount === status.clientCount ? prev : status,
          );
        }
      } catch {}
    }, 5000);

    return () => {
      mounted = false;
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const handleObsToggle = async (): Promise<void> => {
    if (obsTogglingRef.current) return;
    const next = !obsStatus.running;
    setObsStatus((prev) => ({ ...prev, running: next }));
    obsTogglingRef.current = true;
    try {
      const status = next ? await obsApi.start() : await obsApi.stop();
      setObsStatus(status);
      await settingsApi.update({ obsModeEnabled: next });
    } catch (error) {
      console.error('Failed to toggle OBS mode', error);
      setObsStatus((prev) => ({ ...prev, running: !next }));
      showAlert?.(
        next ? t('settings.obsStartFailed') : t('settings.obsStopFailed'),
      );
    } finally {
      obsTogglingRef.current = false;
    }
  };

  const handleObsCopyUrl = async (): Promise<void> => {
    const tokenParam = obsStatus.token ? `?token=${obsStatus.token}` : '';
    const host = obsStatus.localIp || 'localhost';
    const url = `http://${host}:${obsStatus.port}${tokenParam}`;
    try {
      await navigator.clipboard.writeText(url);
      showAlert?.(t('settings.obsCopied'));
    } catch {
      showAlert?.(url);
    }
  };

  const handleObsRegenerateToken = (): void => {
    if (regeneratingObsTokenRef.current) return;
    regeneratingObsTokenRef.current = true;
    showConfirm(
      t('settings.obsTokenRegenMessage'),
      async () => {
        try {
          const status = await obsApi.regenerateToken();
          setObsStatus(status);
        } catch (error) {
          console.error('Failed to regenerate OBS token', error);
        } finally {
          regeneratingObsTokenRef.current = false;
        }
      },
      {
        confirmText: t('settings.obsTokenRegenConfirm'),
        onCancel: () => {
          regeneratingObsTokenRef.current = false;
        },
      },
    );
  };

  return {
    obsStatus,
    handleObsToggle,
    handleObsCopyUrl,
    handleObsRegenerateToken,
  };
};
