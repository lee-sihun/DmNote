/**
 * 디스플레이 요소 인스턴스 레지스트리
 * 플러그인의 디스플레이 요소 인스턴스들을 관리합니다.
 */

import { DisplayElementInstance } from '@utils/displayElementInstance';

const displayElementInstances = new Map<string, DisplayElementInstance>();
const displayElementInstancesByPlugin = new Map<string, Set<string>>();

/**
 * 디스플레이 요소 인스턴스를 등록합니다.
 */
export const registerDisplayElementInstance = (
  instance: DisplayElementInstance,
): void => {
  displayElementInstances.set(instance.id, instance);
  if (!displayElementInstancesByPlugin.has(instance.pluginId)) {
    displayElementInstancesByPlugin.set(instance.pluginId, new Set());
  }
  displayElementInstancesByPlugin.get(instance.pluginId)!.add(instance.id);
};

/**
 * 디스플레이 요소 인스턴스를 등록 해제합니다.
 */
export const unregisterDisplayElementInstance = (fullId: string): void => {
  const instance = displayElementInstances.get(fullId);
  if (!instance) return;
  instance.dispose();
  displayElementInstances.delete(fullId);
  const pluginSet = displayElementInstancesByPlugin.get(instance.pluginId);
  if (pluginSet) {
    pluginSet.delete(fullId);
    if (pluginSet.size === 0) {
      displayElementInstancesByPlugin.delete(instance.pluginId);
    }
  }
};

/**
 * 특정 플러그인의 모든 인스턴스를 정리합니다.
 */
export const clearInstancesByPlugin = (pluginId: string): void => {
  const ids = displayElementInstancesByPlugin.get(pluginId);
  if (!ids) return;
  Array.from(ids).forEach((id) => unregisterDisplayElementInstance(id));
};

/**
 * 모든 인스턴스를 정리합니다.
 */
export const clearAllInstances = (): void => {
  Array.from(displayElementInstances.keys()).forEach((id) =>
    unregisterDisplayElementInstance(id),
  );
  displayElementInstancesByPlugin.clear();
};

/**
 * fullId로 인스턴스를 조회합니다.
 */
export const getDisplayElementInstance = (
  fullId: string,
): DisplayElementInstance | undefined => {
  return displayElementInstances.get(fullId);
};

/**
 * 외부에서 사용할 레지스트리 인터페이스
 */
export const displayElementInstanceRegistry = {
  get(fullId: string) {
    return displayElementInstances.get(fullId);
  },
  clearByPluginId(pluginId: string) {
    clearInstancesByPlugin(pluginId);
  },
  clearAll() {
    clearAllInstances();
  },
};
