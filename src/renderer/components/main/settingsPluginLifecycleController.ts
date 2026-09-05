import {
  currentPluginHealthRevision,
  waitForPluginInjection,
} from '@stores/plugin/usePluginHealthStore';
import { extractPluginId } from '@utils/plugin/pluginUtils';
import { classifyPluginAddResult } from '@utils/plugin/pluginAddResult';
import { jsApi } from '@api/modules/jsApi';
import { pluginApi } from '@api/modules/pluginApi';
import type { I18nContextValue } from '@contexts/I18nContextDef';
import type {
  JsLoadResult,
  JsReloadResult,
  JsRemoveResult,
  JsPluginUpdateResult,
} from '@src/types/plugin/api';
import type { JsPlugin } from '@src/types/plugin/js';

interface PluginError {
  path?: string;
  error: string;
}

export interface PluginToDelete {
  id: string;
  name: string;
  namespace: string;
}

interface MutableValue<T> {
  current: T;
}

interface SettingsPluginLifecycleControllerOptions {
  t: I18nContextValue['t'];
  showAlert: (msg: string, confirmText?: string) => void;
  jsPlugins: JsPlugin[];
  setPluginToDelete: (plugin: PluginToDelete | null) => void;
  setDataDeleteModalOpen: (open: boolean) => void;
  setIsReloadingPlugins: (reloading: boolean) => void;
  setIsAddingPlugins: (adding: boolean) => void;
  setPendingPluginId: (pluginId: string | null) => void;
  reloadingPluginsRef: MutableValue<boolean>;
  addingPluginsRef: MutableValue<boolean>;
  pendingPluginRef: MutableValue<string | null>;
  removingPluginRef: MutableValue<string | null>;
}

export const createSettingsPluginLifecycleController = ({
  t,
  showAlert,
  jsPlugins,
  setPluginToDelete,
  setDataDeleteModalOpen,
  setIsReloadingPlugins,
  setIsAddingPlugins,
  setPendingPluginId,
  reloadingPluginsRef,
  addingPluginsRef,
  pendingPluginRef,
  removingPluginRef,
}: SettingsPluginLifecycleControllerOptions) => {
  const formatPluginErrors = (errors: PluginError[] = []): string =>
    errors.map((item) => `${item.path ?? 'unknown'}: ${item.error}`).join('\n');

  // 파일을 읽는 데 성공해도 브라우저가 평가하지 못하면 실패다.
  // 주입 결과가 정산될 때까지 기다렸다가 실제로 죽은 플러그인을 오류로 합류시킨다
  const collectInjectionErrors = async (
    candidates: JsPlugin[],
    revision: number,
  ): Promise<PluginError[]> => {
    const injected: JsPlugin[] = candidates.filter(
      (plugin) => plugin.enabled && plugin.content,
    );
    if (!injected.length) return [];

    const { outcome, health } = await waitForPluginInjection(
      revision,
      injected.map((plugin) => plugin.id),
    );

    // 전역 JS가 꺼져 있으면 주입 대상이 아니다. 실패로 셀 일이 아니다
    if (outcome === 'skipped') return [];

    // 주입이 아예 못 돌았으면 결과가 비어 있다. 이걸 '오류 없음'으로 읽으면
    // 실행되지 않은 플러그인을 성공으로 표시하게 된다
    if (outcome !== 'settled') {
      return injected.map((plugin) => ({
        path: plugin.path ?? plugin.name,
        error: t('settings.jsNotApplied'),
      }));
    }

    return injected
      .filter((plugin) => health[plugin.id]?.status === 'failed')
      .map((plugin) => ({
        path: plugin.path ?? plugin.name,
        // 빈 메시지(throw '')는 nullish가 아니라 그대로 렌더되므로 ||
        error: health[plugin.id]?.message || t('settings.jsRuntimeError'),
      }));
  };

  const canReloadPlugins: boolean = jsPlugins.some(
    (plugin: JsPlugin) => plugin.path,
  );

  const handleReloadPlugins = async (): Promise<void> => {
    if (reloadingPluginsRef.current) return;
    if (jsPlugins.length === 0) {
      showAlert?.(t('settings.jsReloadNoPlugins'));
      return;
    }
    const startTime: number = performance.now();
    reloadingPluginsRef.current = true;
    setIsReloadingPlugins(true);
    try {
      // 요청 전에 회차를 잡는다 - 응답보다 주입 정산이 먼저 끝나도 놓치지 않는다
      const healthRevision: number = currentPluginHealthRevision();
      const result: JsReloadResult = await jsApi.reload();
      const updated: JsPlugin[] = result.updated ?? [];
      const injectionErrors: PluginError[] = await collectInjectionErrors(
        updated,
        healthRevision,
      );
      const errors: PluginError[] = [
        ...(result.errors ?? []),
        ...injectionErrors,
      ];

      const succeeded: number = updated.length - injectionErrors.length;

      if (errors.length && succeeded) {
        showAlert?.(
          `${t('settings.jsReloadPartial', {
            count: succeeded,
          })}\n${formatPluginErrors(errors)}`,
        );
      } else if (errors.length) {
        showAlert?.(
          `${t('settings.jsReloadFailed')}\n${formatPluginErrors(errors)}`,
        );
      } else if (succeeded) {
        showAlert?.(t('settings.jsReloadSuccess', { count: succeeded }));
      } else {
        showAlert?.(t('settings.jsReloadNoChanges'));
      }
    } catch (error) {
      console.error('Failed to reload JS plugins', error);
      showAlert?.(`${t('settings.jsReloadFailed')}${error}`);
    } finally {
      reloadingPluginsRef.current = false;
      const elapsed: number = performance.now() - startTime;
      const MIN_SPINNER_MS = 250;
      if (elapsed < MIN_SPINNER_MS) {
        setTimeout(
          () => setIsReloadingPlugins(false),
          MIN_SPINNER_MS - elapsed,
        );
      } else {
        setIsReloadingPlugins(false);
      }
    }
  };

  const handleAddPlugins = async (): Promise<void> => {
    if (addingPluginsRef.current) return;
    addingPluginsRef.current = true;
    setIsAddingPlugins(true);
    try {
      const healthRevision: number = currentPluginHealthRevision();
      const result: JsLoadResult = await jsApi.load();
      if (!result) return;
      const added: JsPlugin[] = result.added ?? [];
      const injectionErrors: PluginError[] = await collectInjectionErrors(
        added,
        healthRevision,
      );
      const errors: PluginError[] = [
        ...(result.errors ?? []),
        ...injectionErrors,
      ];
      const alertKind = classifyPluginAddResult(added.length, errors.length);

      if (alertKind === 'partial') {
        showAlert?.(
          `${t('settings.jsAddPartial', {
            count: added.length,
          })}\n${formatPluginErrors(errors)}`,
        );
      } else if (alertKind === 'failed') {
        showAlert?.(
          `${t('settings.jsAddFailed')}\n${formatPluginErrors(errors)}`,
        );
      } else if (alertKind === 'success') {
        showAlert?.(t('settings.jsAddSuccess', { count: added.length }));
      }
    } catch (error) {
      console.error('Failed to add JS plugins', error);
      showAlert?.(`${t('settings.jsAddFailed')}${error}`);
    } finally {
      addingPluginsRef.current = false;
      setIsAddingPlugins(false);
    }
  };

  const handlePluginToggle = async (
    pluginId: string,
    nextState: boolean,
  ): Promise<void> => {
    if (pendingPluginRef.current) return;
    pendingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);
    try {
      const result: JsPluginUpdateResult = await jsApi.setPluginEnabled(
        pluginId,
        nextState,
      );
      if (!result.success) {
        showAlert?.(t('settings.jsPluginToggleFailed'));
      }
    } catch (error) {
      console.error('Failed to toggle JS plugin', error);
      showAlert?.(t('settings.jsPluginToggleFailed'));
    } finally {
      pendingPluginRef.current = null;
      setPendingPluginId(null);
    }
  };

  const handlePluginRemove = async (pluginId: string): Promise<void> => {
    const plugin: JsPlugin | undefined = jsPlugins.find(
      (candidate: JsPlugin) => candidate.id === pluginId,
    );
    if (!plugin) return;
    if (removingPluginRef.current || pendingPluginRef.current) return;
    removingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);

    try {
      // 실제 플러그인 네임스페이스 추출 (@id 또는 파일명 기반)
      const pluginNamespace: string = extractPluginId(
        plugin.content,
        plugin.name,
      );
      const pluginStorageNamespace = `${pluginNamespace}/`;

      // 네임스페이스를 prefix로 사용하는 데이터가 있는지 확인
      // 백엔드에서 자동으로 "plugin_data_" 를 붙이므로 순수 네임스페이스만 전달
      const hasData: boolean = await pluginApi.storage.hasData(
        pluginStorageNamespace,
      );
      console.warn(
        '[PluginRemove] namespace=',
        pluginNamespace,
        'hasData=',
        hasData,
      );

      if (hasData) {
        setPluginToDelete({
          id: pluginId,
          name: plugin.name,
          namespace: pluginNamespace,
        });
        setDataDeleteModalOpen(true);
      } else {
        removingPluginRef.current = null;
        setPendingPluginId(null);
        await removePluginOnly(pluginId);
      }
    } catch (error) {
      console.error('Failed to check plugin data', error);
      showAlert?.(t('settings.jsPluginRemoveFailed'));
    } finally {
      removingPluginRef.current = null;
      setPendingPluginId(null);
    }
  };

  const removePluginOnly = async (pluginId: string): Promise<void> => {
    if (removingPluginRef.current) return;
    removingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);
    try {
      const result: JsRemoveResult = await jsApi.remove(pluginId);
      if (!result.success) {
        showAlert?.(t('settings.jsPluginRemoveFailed'));
      }
    } catch (error) {
      console.error('Failed to remove JS plugin', error);
      showAlert?.(t('settings.jsPluginRemoveFailed'));
    } finally {
      removingPluginRef.current = null;
      setPendingPluginId(null);
      setDataDeleteModalOpen(false);
      setPluginToDelete(null);
    }
  };

  const removePluginWithData = async (pluginId: string): Promise<void> => {
    if (removingPluginRef.current) return;
    removingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);
    try {
      const plugin: JsPlugin | undefined = jsPlugins.find(
        (p: JsPlugin) => p.id === pluginId,
      );
      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // 실제 네임스페이스를 다시 추출
      const pluginNamespace: string = extractPluginId(
        plugin.content,
        plugin.name,
      );
      const pluginStorageNamespace = `${pluginNamespace}/`;

      // 1) 먼저 플러그인 제거 → 클린업이 실행되며 일부 플러그인은 저장을 시도할 수 있음
      const result: JsRemoveResult = await jsApi.remove(pluginId);
      if (!result.success) {
        showAlert?.(t('settings.jsPluginRemoveFailed'));
      }

      // 2) 그 다음 스토리지 정리 → 클린업 중 재생성된 값까지 함께 제거
      await pluginApi.storage.clearByPrefix(pluginStorageNamespace);
    } catch (error) {
      console.error('Failed to remove JS plugin with data', error);
      showAlert?.(t('settings.jsPluginRemoveFailed'));
    } finally {
      removingPluginRef.current = null;
      setPendingPluginId(null);
      setDataDeleteModalOpen(false);
      setPluginToDelete(null);
    }
  };

  return {
    canReloadPlugins,
    handleReloadPlugins,
    handleAddPlugins,
    handlePluginToggle,
    handlePluginRemove,
    removePluginOnly,
    removePluginWithData,
  };
};
