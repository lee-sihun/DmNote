import type { WindowTarget } from '@src/types/plugin/api';
import { emitTo } from '@tauri-apps/api/event';

type InternalWindowTarget = WindowTarget | 'panel';

const isMissingTargetWindow = (
  error: unknown,
  target: InternalWindowTarget,
): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`Window '${target}' not found`);
};

/** 선택적 창이 닫혀 있어도 내부 동기화 Promise를 안전하게 종료 */
export const sendBridgeMessageBestEffort = (
  target: InternalWindowTarget,
  type: string,
  data?: unknown,
): void => {
  try {
    const pending =
      target === 'panel'
        ? emitTo('panel', 'plugin-bridge:message', {
            type,
            data: data ?? null,
          })
        : window.api?.bridge?.sendTo(target, type, data);
    if (!pending) return;

    void pending.catch((error: unknown) => {
      if (isMissingTargetWindow(error, target)) return;
      console.error(`[Bridge] Failed to send '${type}' to '${target}':`, error);
    });
  } catch (error) {
    if (isMissingTargetWindow(error, target)) return;
    console.error(`[Bridge] Failed to send '${type}' to '${target}':`, error);
  }
};
