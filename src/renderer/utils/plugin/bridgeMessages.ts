import type { WindowTarget } from '@src/types/plugin/api';

const isMissingTargetWindow = (
  error: unknown,
  target: WindowTarget,
): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`Window '${target}' not found`);
};

/** 선택적 창이 닫혀 있어도 내부 동기화 Promise를 안전하게 종료 */
export const sendBridgeMessageBestEffort = (
  target: WindowTarget,
  type: string,
  data?: unknown,
): void => {
  try {
    const bridge = window.api?.bridge;
    if (!bridge) return;

    void bridge.sendTo(target, type, data).catch((error: unknown) => {
      if (isMissingTargetWindow(error, target)) return;
      console.error(`[Bridge] Failed to send '${type}' to '${target}':`, error);
    });
  } catch (error) {
    if (isMissingTargetWindow(error, target)) return;
    console.error(`[Bridge] Failed to send '${type}' to '${target}':`, error);
  }
};
