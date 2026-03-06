/**
 * 디스플레이 요소 API
 * 플러그인에서 디스플레이 요소를 생성, 조회, 수정, 삭제하는 API를 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/useKeyStore';
import { DisplayElementInstance } from '@utils/displayElementInstance';
import { html } from '@utils/core/templateEngine';
import { createPluginTranslator } from '@utils/plugin/pluginI18n';
import { handlerRegistry } from '../handlers';
import {
  registerDisplayElementInstance,
  unregisterDisplayElementInstance,
} from './instanceRegistry';
import {
  resolveFullId,
  resolveInstance,
  createNoopDisplayElementInstance,
  type DisplayElementTarget,
} from './targetResolver';
import { buildDisplayElementTemplate } from './templateBuilder';
import { saveToHistory } from './historyUtils';
import type {
  PluginDisplayElement,
  PluginDisplayElementConfig,
  PluginDisplayElementInternal,
} from '@src/types/api';

/**
 * 내부용 디스플레이 요소 제거 함수
 */
const removeDisplayElementInternal = (fullId: string): void => {
  const store = usePluginDisplayElementStore.getState();
  const element = store.elements.find((el) => el.fullId === fullId);
  if (element) {
    if (element._onClickId) handlerRegistry.unregister(element._onClickId);
    if (element._onPositionChangeId)
      handlerRegistry.unregister(element._onPositionChangeId);
    if (element._onDeleteId) handlerRegistry.unregister(element._onDeleteId);
  }

  store.removeElement(fullId);
  unregisterDisplayElementInstance(fullId);
};

/**
 * 디스플레이 요소 API 객체
 */
export const displayElementApi = {
  html,
  template: buildDisplayElementTemplate,

  /**
   * 새로운 디스플레이 요소를 추가합니다.
   */
  add: (element: PluginDisplayElementConfig): DisplayElementInstance => {
    if (window.__dmn_window_type !== 'main') {
      console.warn(
        '[UI API] displayElement.add is only available in main window',
      );
      return createNoopDisplayElementInstance();
    }

    const pluginId = window.__dmn_current_plugin_id;
    if (!pluginId) {
      console.warn('[UI API] displayElement.add called outside plugin context');
      return createNoopDisplayElementInstance();
    }

    // 히스토리 저장 (요소 추가 전)
    saveToHistory();

    const id = `element-${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}`;
    const fullId = `${pluginId}::${id}`;

    const {
      template,
      state: initialState,
      html: initialHtml,
      ...elementOptions
    } = element;

    const currentTabId =
      elementOptions.tabId || useKeyStore.getState().selectedKeyType;

    const templateFn = typeof template === 'function' ? template : undefined;
    const stateSnapshot = initialState
      ? { ...initialState }
      : templateFn
        ? {}
        : undefined;

    const htmlContent = typeof initialHtml === 'string' ? initialHtml : '';

    if (!htmlContent && !templateFn) {
      console.warn(
        `[UI API] displayElement '${fullId}' has no HTML content. The panel will be empty until setState/setHTML is called.`,
      );
    }

    let onClickId: string | undefined;
    let onPositionChangeId: string | undefined;
    let onDeleteId: string | undefined;

    if (typeof elementOptions.onClick === 'function') {
      onClickId = handlerRegistry.register(pluginId, elementOptions.onClick);
    }
    if (typeof elementOptions.onPositionChange === 'function') {
      onPositionChangeId = handlerRegistry.register(
        pluginId,
        elementOptions.onPositionChange,
      );
    }
    if (typeof elementOptions.onDelete === 'function') {
      onDeleteId = handlerRegistry.register(pluginId, elementOptions.onDelete);
    }

    const internalElement: PluginDisplayElementInternal = {
      ...elementOptions,
      html: htmlContent,
      id,
      pluginId,
      fullId,
      tabId: currentTabId,
      onClick:
        onClickId ||
        (typeof elementOptions.onClick === 'string'
          ? elementOptions.onClick
          : undefined),
      onPositionChange:
        onPositionChangeId ||
        (typeof elementOptions.onPositionChange === 'string'
          ? elementOptions.onPositionChange
          : undefined),
      onDelete:
        onDeleteId ||
        (typeof elementOptions.onDelete === 'string'
          ? elementOptions.onDelete
          : undefined),
      _onClickId: onClickId,
      _onPositionChangeId: onPositionChangeId,
      _onDeleteId: onDeleteId,
    };

    usePluginDisplayElementStore.getState().addElement(internalElement);

    const currentLocale = window.__dmn_current_locale || 'ko';
    const pluginMessages = window.__dmn_plugin_messages?.[pluginId];
    const t = createPluginTranslator(pluginMessages, currentLocale);

    const instance = new DisplayElementInstance({
      fullId,
      pluginId,
      scoped: Boolean(elementOptions.scoped),
      initialState: stateSnapshot,
      template: templateFn,
      updateElement: (targetId, updates) => {
        usePluginDisplayElementStore
          .getState()
          .updateElement(targetId, updates);
      },
      removeElement: (targetId) => {
        removeDisplayElementInternal(targetId);
      },
      locale: currentLocale,
      t,
    });

    registerDisplayElementInstance(instance);

    if (templateFn) {
      instance.setState({});
    }

    return instance;
  },

  /**
   * fullId로 디스플레이 요소 인스턴스를 조회합니다.
   */
  get: (fullId: string) => resolveInstance(fullId),

  /**
   * 디스플레이 요소의 상태를 업데이트합니다.
   */
  setState: (target: DisplayElementTarget, updates: Record<string, unknown>) => {
    const instance = resolveInstance(target);
    if (!instance) return;
    instance.setState(updates || {});
  },

  /**
   * 디스플레이 요소의 데이터를 업데이트합니다.
   */
  setData: (target: DisplayElementTarget, updates: Record<string, unknown>) => {
    const instance = resolveInstance(target);
    if (!instance) return;
    instance.setData(updates || {});
  },

  /**
   * 디스플레이 요소의 텍스트를 설정합니다.
   */
  setText: (target: DisplayElementTarget, selector: string, text: string) => {
    const instance = resolveInstance(target);
    if (!instance) return;
    instance.setText(selector, text);
  },

  /**
   * 디스플레이 요소의 HTML을 설정합니다.
   */
  setHTML: (
    target: DisplayElementTarget,
    selector: string,
    htmlContent: string,
  ) => {
    const instance = resolveInstance(target);
    if (!instance) return;
    instance.setHTML(selector, htmlContent);
  },

  /**
   * 디스플레이 요소의 스타일을 설정합니다.
   */
  setStyle: (
    target: DisplayElementTarget,
    selector: string,
    styles: Record<string, string>,
  ) => {
    const instance = resolveInstance(target);
    if (!instance) return;
    instance.setStyle(selector, styles);
  },

  /**
   * 디스플레이 요소에 클래스를 추가합니다.
   */
  addClass: (
    target: DisplayElementTarget,
    selector: string,
    ...classNames: string[]
  ) => {
    const instance = resolveInstance(target);
    if (!instance) return;
    instance.addClass(selector, ...classNames);
  },

  /**
   * 디스플레이 요소에서 클래스를 제거합니다.
   */
  removeClass: (
    target: DisplayElementTarget,
    selector: string,
    ...classNames: string[]
  ) => {
    const instance = resolveInstance(target);
    if (!instance) return;
    instance.removeClass(selector, ...classNames);
  },

  /**
   * 디스플레이 요소의 클래스를 토글합니다.
   */
  toggleClass: (
    target: DisplayElementTarget,
    selector: string,
    className: string,
  ) => {
    const instance = resolveInstance(target);
    if (!instance || !className) return;
    instance.toggleClass(selector, className);
  },

  /**
   * 디스플레이 요소 내에서 선택자로 요소를 조회합니다.
   */
  query: (target: DisplayElementTarget, selector: string) => {
    const instance = resolveInstance(target);
    if (!instance) return null;
    return instance.query(selector);
  },

  /**
   * 디스플레이 요소를 업데이트합니다.
   */
  update: (
    target: DisplayElementTarget,
    updates: Partial<PluginDisplayElement>,
  ) => {
    if (window.__dmn_window_type !== 'main') {
      console.warn(
        '[UI API] displayElement.update is only available in main window',
      );
      return;
    }
    const fullId = resolveFullId(target);
    if (!fullId) return;
    usePluginDisplayElementStore.getState().updateElement(fullId, updates);
  },

  /**
   * 디스플레이 요소를 제거합니다.
   */
  remove: (target: DisplayElementTarget) => {
    if (window.__dmn_window_type !== 'main') {
      console.warn(
        '[UI API] displayElement.remove is only available in main window',
      );
      return;
    }
    const fullId = resolveFullId(target);
    if (!fullId) return;

    // 히스토리 저장 (요소 삭제 전)
    saveToHistory();

    removeDisplayElementInternal(fullId);
  },

  /**
   * 현재 플러그인의 모든 디스플레이 요소를 제거합니다.
   */
  clearMyElements: () => {
    if (window.__dmn_window_type !== 'main') {
      console.warn(
        '[UI API] displayElement.clearMyElements is only available in main window',
      );
      return;
    }

    const pluginId = window.__dmn_current_plugin_id;
    if (!pluginId) {
      console.warn('[UI API] clearMyElements called outside plugin context');
      return;
    }

    const elements = usePluginDisplayElementStore
      .getState()
      .elements.filter((el) => el.pluginId === pluginId);
    elements.forEach((element) => {
      removeDisplayElementInternal(element.fullId);
    });
  },
};

export { removeDisplayElementInternal };
