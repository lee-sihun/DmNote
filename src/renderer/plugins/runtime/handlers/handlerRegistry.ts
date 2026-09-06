/**
 * 플러그인 핸들러 레지스트리
 * 플러그인의 이벤트 핸들러를 전역적으로 관리합니다.
 */

import { clearComponentHandlers } from '@utils/plugin/components/pluginUtils';

type HandlerFunction = (...args: unknown[]) => void | Promise<void>;

class PluginHandlerRegistry {
  private handlers: Map<string, HandlerFunction> = new Map();
  private pluginHandlers: Map<string, Set<string>> = new Map();
  private handlerOwners: Map<string, string> = new Map();

  /**
   * 핸들러를 등록하고 고유 ID를 반환합니다.
   */
  register(pluginId: string, handler: HandlerFunction): string {
    const handlerId = `__dmn_handler_${pluginId}_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}`;

    this.handlers.set(handlerId, handler);

    if (!this.pluginHandlers.has(pluginId)) {
      this.pluginHandlers.set(pluginId, new Set());
    }
    this.pluginHandlers.get(pluginId)!.add(handlerId);
    this.handlerOwners.set(handlerId, pluginId);

    window[handlerId as `__dmn_handler_${string}`] = handler;

    return handlerId;
  }

  /**
   * 핸들러 ID로 핸들러를 조회합니다.
   */
  get(handlerId: string): HandlerFunction | undefined {
    return this.handlers.get(handlerId);
  }

  /**
   * 특정 핸들러를 등록 해제합니다.
   */
  unregister(handlerId: string): void {
    this.handlers.delete(handlerId);
    const pluginId = this.handlerOwners.get(handlerId);
    if (pluginId) {
      const handlerIds = this.pluginHandlers.get(pluginId);
      handlerIds?.delete(handlerId);
      if (handlerIds?.size === 0) this.pluginHandlers.delete(pluginId);
      this.handlerOwners.delete(handlerId);
    }
    delete window[handlerId as `__dmn_handler_${string}`];
  }

  /**
   * 특정 플러그인의 모든 핸들러를 정리합니다.
   */
  clearPlugin(pluginId: string): void {
    const handlerIds = this.pluginHandlers.get(pluginId);
    if (handlerIds) {
      handlerIds.forEach((id) => {
        this.handlers.delete(id);
        this.handlerOwners.delete(id);
        delete window[id as `__dmn_handler_${string}`];
      });
      this.pluginHandlers.delete(pluginId);
    }

    clearComponentHandlers(pluginId);
  }

  /**
   * 모든 핸들러를 정리합니다.
   */
  clear(): void {
    this.handlers.forEach((_, id) => {
      delete window[id as `__dmn_handler_${string}`];
    });
    this.handlers.clear();
    this.pluginHandlers.clear();
    this.handlerOwners.clear();
  }
}

export const handlerRegistry = new PluginHandlerRegistry();
