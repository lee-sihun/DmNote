/**
 * 디스플레이 요소 API
 * 플러그인에서 디스플레이 요소를 생성, 조회, 수정, 삭제하는 API를 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { DisplayElementInstance } from '@utils/displayElementInstance';
import { html } from '@utils/core/templateEngine';
import { createPluginTranslator } from '@utils/plugin/pluginI18n';
import { handlerRegistry } from '../handlers';
import {
  registerDisplayElementInstance,
  unregisterDisplayElementInstance,
} from './instanceRegistry';
import {
  flushPluginInstancesEditSession,
  rotatePluginInstancesEditSession,
} from './instancesCommitQueue';
import {
  resolveFullId,
  resolveInstance,
  createNoopDisplayElementInstance,
  type DisplayElementTarget,
} from './targetResolver';
import { buildDisplayElementTemplate } from './templateBuilder';
import type {
  PluginDisplayElement,
  PluginDisplayElementConfig,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

// 런타임 내부(복원·재주입) 전용 config - 저장된 영구 instanceId를 요소 id로
// 지정하고 groupId 소속을 함께 복원
export type InternalDisplayElementConfig = PluginDisplayElementConfig & {
  instanceId?: string;
  groupId?: string;
};

let internalAddDepth = 0;

/**
 * 내부용 디스플레이 요소 제거 함수
 */
const disposeDisplayElementResources = (
  fullId: string,
  element?: PluginDisplayElementInternal,
): void => {
  if (element?._onClickId) handlerRegistry.unregister(element._onClickId);
  if (element?._onPositionChangeId)
    handlerRegistry.unregister(element._onPositionChangeId);
  if (element?._onDeleteId) handlerRegistry.unregister(element._onDeleteId);
  unregisterDisplayElementInstance(fullId);
};

const removeDisplayElementInternal = (fullId: string): void => {
  const store = usePluginDisplayElementStore.getState();
  const element = store.elements.find((el) => el.fullId === fullId);
  disposeDisplayElementResources(fullId, element);
  store.removeElement(fullId);
};

// paste 복제 전용 핸들러 재발급 - _onXxxId는 dispose가 등록 해제까지 소유하는
// 참조라 복제와 공유하면 한쪽 제거가 다른 쪽 핸들러를 죽인다. 같은 함수를
// 새 id로 재등록해 생명주기를 분리하고, 원본 등록이 이미 해제된 경우는
// dangling 참조 대신 핸들러 없는 복제로 정리한다
export const reissueDisplayElementHandlers = <
  T extends Pick<
    PluginDisplayElementInternal,
    | 'pluginId'
    | 'onClick'
    | 'onPositionChange'
    | 'onDelete'
    | '_onClickId'
    | '_onPositionChangeId'
    | '_onDeleteId'
  >,
>(
  element: T,
): T => {
  const reissue = <V>(
    handlerRef: V | string | undefined,
    ownedId: string | undefined,
  ): { handlerRef: V | string | undefined; ownedId: string | undefined } => {
    // 소유 등록이 없으면 재발급 대상 아님 (플러그인이 직접 관리하는 문자열 참조 등)
    if (!ownedId) return { handlerRef, ownedId };
    const handler = handlerRegistry.get(ownedId);
    if (!handler) {
      return {
        handlerRef: handlerRef === ownedId ? undefined : handlerRef,
        ownedId: undefined,
      };
    }
    const newId = handlerRegistry.register(element.pluginId, handler);
    return {
      handlerRef: handlerRef === ownedId ? newId : handlerRef,
      ownedId: newId,
    };
  };
  const onClick = reissue(element.onClick, element._onClickId);
  const onPositionChange = reissue(
    element.onPositionChange,
    element._onPositionChangeId,
  );
  const onDelete = reissue(element.onDelete, element._onDeleteId);
  return {
    ...element,
    onClick: onClick.handlerRef,
    onPositionChange: onPositionChange.handlerRef,
    onDelete: onDelete.handlerRef,
    _onClickId: onClick.ownedId,
    _onPositionChangeId: onPositionChange.ownedId,
    _onDeleteId: onDelete.ownedId,
  } as T;
};

const removeDisplayElementsInternal = (fullIds: readonly string[]): void => {
  const ids = new Set(fullIds);
  if (ids.size === 0) return;

  const store = usePluginDisplayElementStore.getState();
  const elements = store.elements;
  const elementsById = new Map(
    elements.map((element) => [element.fullId, element]),
  );

  ids.forEach((fullId) => {
    disposeDisplayElementResources(fullId, elementsById.get(fullId));
  });

  const remaining = elements.filter((element) => !ids.has(element.fullId));
  if (remaining.length !== elements.length) {
    store.setElements(remaining);
  }
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

    if (internalAddDepth === 0) {
      rotatePluginInstancesEditSession(pluginId);
    }

    const {
      template,
      state: initialState,
      html: initialHtml,
      instanceId,
      groupId,
      definitionId,
      ...elementOptions
    } = element as InternalDisplayElementConfig;

    // 영구 instanceId를 요소 id로 사용 - 지정 수용은 내부 복원 경로만
    // (플러그인이 넘긴 값은 무시 - 중복·비정형 ID는 백엔드 커밋이 거절됨)
    const id =
      internalAddDepth > 0 && instanceId ? instanceId : crypto.randomUUID();
    const fullId = `${pluginId}::${id}`;

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
      // 그룹 소속 지정 수용도 내부 복원 경로만 - 공개 add의 임의 groupId는
      // 저장 규칙 밖 dangling 소속이 되므로 무시
      ...(internalAddDepth > 0 && groupId !== undefined ? { groupId } : {}),
      // definitionId 수용은 내부 복원 경로와 자기 플러그인 definition(defId ===
      // pluginId) 지정만 - 타 플러그인 definitionId 위조가 그 플러그인의 저장
      // 모집단에 편입되는 것을 차단
      ...(definitionId !== undefined &&
      (internalAddDepth > 0 || definitionId === pluginId)
        ? { definitionId }
        : {}),
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
        rotatePluginInstancesEditSession(pluginId);
        removeDisplayElementInternal(targetId);
        // 삭제는 discrete 편집 - debounce 대기 없이 즉시 커밋
        flushPluginInstancesEditSession(pluginId);
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
  setState: (
    target: DisplayElementTarget,
    updates: Record<string, unknown>,
  ) => {
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

    const element = usePluginDisplayElementStore
      .getState()
      .elements.find((candidate) => candidate.fullId === fullId);
    if (element) rotatePluginInstancesEditSession(element.pluginId);
    removeDisplayElementInternal(fullId);
    // 삭제는 discrete 편집 - debounce 대기 없이 즉시 커밋
    if (element) flushPluginInstancesEditSession(element.pluginId);
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
    if (elements.length === 0) return;

    rotatePluginInstancesEditSession(pluginId);
    elements.forEach((element) => {
      removeDisplayElementInternal(element.fullId);
    });
    // 일괄 삭제도 discrete 편집 - 마지막에 1회만 즉시 커밋
    flushPluginInstancesEditSession(pluginId);
  },
};

const addDisplayElementInternal = (
  element: InternalDisplayElementConfig,
): DisplayElementInstance => {
  internalAddDepth += 1;
  try {
    return displayElementApi.add(element);
  } finally {
    internalAddDepth -= 1;
  }
};

export { addDisplayElementInternal, removeDisplayElementsInternal };
