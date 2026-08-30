/**
 * defineElement API 구현
 * 플러그인에서 커스텀 UI 요소를 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { flushPluginInstancesEditSession } from '../displayElement/instancesCommitQueue';
import { normalizePluginInstanceTabId } from '../displayElement/instanceLifecycle';
import { getDefaultSettings } from '../settingsSections';
import type {
  PluginDefinition,
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
  PluginDisplayElementActionContext,
  PluginDisplayElementConfig,
  DMNoteAPI,
} from '@src/types/plugin/api';
import type { SettingsState } from '@src/types/settings/settings';
import { createInstanceSettingsDialogFactory } from './instanceSettingsDialog';
import { createPluginInstancePersistenceRuntime } from './pluginInstancePersistenceRuntime';
import {
  createPluginInstanceSnapshotApplier,
  type SavedInstance,
} from './pluginInstanceSnapshotApplier';

export type { SavedInstance } from './pluginInstanceSnapshotApplier';

export const buildSavedPluginInstances = (
  elements: readonly PluginDisplayElementInternal[],
  definitionId: string,
): SavedInstance[] =>
  elements
    .filter((element) => element.definitionId === definitionId)
    .map((element) => ({
      instanceId: element.id,
      position: element.position,
      settings: element.settings as SavedInstance['settings'],
      measuredSize: element.measuredSize,
      tabId: normalizePluginInstanceTabId(element.tabId),
      hidden: element.hidden === true,
      zIndex: element.zIndex,
      groupId: element.groupId,
    }));

interface DefineElementDependencies {
  pluginId: string;
  api: DMNoteAPI;
  registerCleanup: (cleanup: () => void) => void;
  wrapFunctionWithContext: (
    fn: (...args: unknown[]) => unknown,
  ) => (...args: unknown[]) => unknown;
  isReloading: () => boolean;
  waitForReloadEnd: () => Promise<void>;
}

/**
 * defineElement 함수를 생성합니다.
 */
export const createDefineElement = (deps: DefineElementDependencies) => {
  const {
    pluginId,
    api,
    registerCleanup,
    wrapFunctionWithContext,
    isReloading,
    waitForReloadEnd,
  } = deps;
  const createOpenInstanceSettings = createInstanceSettingsDialogFactory({
    pluginId,
    api,
    wrapFunctionWithContext,
  });

  return (definition: PluginDefinition) => {
    const defId = pluginId;
    const internalDef: PluginDefinitionInternal = {
      ...definition,
      id: defId,
      pluginId: pluginId,
    };

    usePluginDisplayElementStore.getState().registerDefinition(internalDef);

    const instancePersistenceRuntime = createPluginInstancePersistenceRuntime({
      pluginId,
      definitionId: defId,
      registerCleanup,
      isReloading,
      waitForReloadEnd,
      buildSavedPluginInstances,
    });
    const { instanceSaveBarrier } = instancePersistenceRuntime;
    const defaultSettings: Record<string, string | number | boolean> =
      getDefaultSettings(definition.settings);

    let currentLocale = 'ko';
    const applyLocale = (next?: string) => {
      if (typeof next === 'string' && next.trim().length > 0) {
        currentLocale = next;
      }
    };

    if (api.i18n?.getLocale) {
      api.i18n
        .getLocale()
        .then(applyLocale)
        .catch(() => undefined);
    } else if (api.settings?.get) {
      api.settings
        .get()
        .then((settings) => applyLocale((settings as SettingsState)?.language))
        .catch(() => undefined);
    }

    let localeCleanup: (() => void) | null = null;
    if (api.i18n?.onLocaleChange) {
      localeCleanup = api.i18n.onLocaleChange(applyLocale);
      if (localeCleanup) {
        registerCleanup(() => {
          try {
            if (localeCleanup) localeCleanup();
          } catch (error) {
            console.error(
              `[Plugin ${pluginId}] Failed to cleanup locale listener`,
              error,
            );
          }
        });
      }
    }

    const translate = (
      key?: string,
      params?: Record<string, string | number>,
      fallback?: string,
    ) =>
      translatePluginMessage({
        messages: definition.messages,
        locale: currentLocale,
        key,
        params,
        fallback,
      });

    const buildActionsProxy = (elementId: string) =>
      new Proxy(
        {},
        {
          get: (_target, prop: string | symbol) => {
            if (typeof prop !== 'string') return undefined;
            return (...args: unknown[]) => {
              sendBridgeMessageBestEffort(
                'overlay',
                'plugin:displayElement:invokeAction',
                {
                  elementId,
                  action: prop,
                  args,
                },
              );
            };
          },
        },
      );

    const buildCustomContextMenuItems = () =>
      (definition.contextMenu?.items || []).map((item, index) => ({
        id: item.action || `custom-${index}`,
        label: item.label,
        position: item.position,
        visible: item.visible,
        disabled: item.disabled,
        onClick: (ctx: PluginDisplayElementActionContext) => {
          const actions =
            ctx?.actions ||
            buildActionsProxy(
              (ctx?.element as PluginDisplayElementInternal)?.fullId || '',
            );

          if (typeof item.onClick === 'function') {
            return item.onClick({ ...ctx, actions });
          }

          if (item.action && typeof actions[item.action] === 'function') {
            return actions[item.action]();
          }
        },
      }));

    const useModalSettings = definition.settingsUI === 'modal';

    const openInstanceSettings = createOpenInstanceSettings({
      definition,
      defaultSettings,
      translate,
    });

    const handleElementClick = (e: Event) => {
      if (!useModalSettings) return;
      const target = e.currentTarget as HTMLElement;
      const instanceId = target.getAttribute('data-plugin-element');
      if (instanceId) {
        return openInstanceSettings(instanceId);
      }
    };

    if (window.__dmn_window_type === 'main') {
      const createLabel =
        definition.contextMenu?.create || `${definition.name} 생성`;

      // maxInstances 제한 체크를 위한 헬퍼 함수 (현재 탭 기준)
      const getInstanceCountForTab = (tabId: string) => {
        return usePluginDisplayElementStore
          .getState()
          .elements.filter(
            (el) => el.definitionId === defId && el.tabId === tabId,
          ).length;
      };

      const menuId = api.ui.contextMenu.addGridMenuItem({
        id: `create-${defId}`,
        label: createLabel,
        // maxInstances 제한 도달 시 메뉴 비활성화 (현재 탭 기준)
        disabled: () => {
          const maxInstances = definition.maxInstances;
          if (!maxInstances || maxInstances <= 0) return false;
          const currentTabId = useKeyStore.getState().selectedKeyType;
          return getInstanceCountForTab(currentTabId) >= maxInstances;
        },
        onClick: async (context) => {
          // 클릭 시에도 한 번 더 체크 (동시 클릭 방지, 현재 탭 기준)
          const maxInstances = definition.maxInstances;
          if (maxInstances && maxInstances > 0) {
            const currentTabId = useKeyStore.getState().selectedKeyType;
            if (getInstanceCountForTab(currentTabId) >= maxInstances) {
              console.warn(
                `[Plugin ${pluginId}] Max instances (${maxInstances}) reached for ${defId} in tab ${currentTabId}`,
              );
              return;
            }
          }

          api.ui.displayElement.add({
            html: '<!-- plugin-element -->',
            position: {
              x: context.position.dx,
              y: context.position.dy,
            },
            draggable: true,
            definitionId: defId,
            settings: { ...defaultSettings },
            state: definition.previewState || {},
            onClick: useModalSettings ? handleElementClick : undefined,
            contextMenu: {
              enableDelete: true,
              deleteLabel: definition.contextMenu?.delete || '삭제',
              customItems: buildCustomContextMenuItems(),
            },
          } as unknown as PluginDisplayElementConfig);
          // 생성은 discrete 편집 - debounce 대기 없이 즉시 커밋
          flushPluginInstancesEditSession(pluginId);
        },
      });

      registerCleanup(() => {
        api.ui.contextMenu.removeMenuItem(menuId);
      });
    }

    const applyInstancesSnapshot = createPluginInstanceSnapshotApplier({
      pluginId,
      definitionId: defId,
      definition,
      defaultSettings,
      instanceSaveBarrier,
      useModalSettings,
      handleElementClick,
      buildCustomContextMenuItems,
    });

    instancePersistenceRuntime.connectSnapshotApplier(applyInstancesSnapshot);
  };
};
