import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { flushPluginInstancesEditSession } from '../displayElement/instancesCommitQueue';
import { omitLayoutSettingValues } from '../settingsSections';
import type { DMNoteAPI, PluginDefinition } from '@src/types/plugin/api';
import { createPluginSettingsDialogContent } from './pluginSettingsDialogContent';

type Translate = (
  key?: string,
  params?: Record<string, string | number>,
  fallback?: string,
) => string;

interface CreateInstanceSettingsDialogFactoryOptions {
  pluginId: string;
  api: DMNoteAPI;
  wrapFunctionWithContext: (
    fn: (...args: unknown[]) => unknown,
  ) => (...args: unknown[]) => unknown;
}

interface CreateOpenInstanceSettingsOptions {
  definition: PluginDefinition;
  defaultSettings: Record<string, string | number | boolean>;
  translate: Translate;
}

export const createInstanceSettingsDialogFactory = ({
  pluginId,
  api,
  wrapFunctionWithContext,
}: CreateInstanceSettingsDialogFactoryOptions) => {
  const visibilityErrorKeys = new Set<string>();

  return ({
    definition,
    defaultSettings,
    translate,
  }: CreateOpenInstanceSettingsOptions) => {
    return async (instanceId: string) => {
      const element = usePluginDisplayElementStore
        .getState()
        .elements.find((el) => el.fullId === instanceId);

      if (!element) {
        console.warn(
          `[Plugin ${pluginId}] Cannot find element ${instanceId} for settings`,
        );
        return;
      }

      const currentSettings: Record<string, unknown> = omitLayoutSettingValues(
        definition.settings,
        {
          ...defaultSettings,
          ...(element.settings || {}),
        },
      );
      const originalSettings = { ...currentSettings };

      const reportNormalizationError = (
        key: string,
        error: unknown,
        kind: 'visibility' | 'unsupported-type',
      ) => {
        if (visibilityErrorKeys.has(key)) return;
        visibilityErrorKeys.add(key);
        const message =
          kind === 'unsupported-type'
            ? `Unsupported setting type for "${key}"`
            : `Failed to evaluate visibility for setting "${key}"`;
        console.error(`[Plugin ${pluginId}] ${message}:`, error);
      };
      const modalScope = `plugin-element-${encodeURIComponent(
        pluginId,
      )}-${encodeURIComponent(instanceId)}`;
      const dialogContent = await createPluginSettingsDialogContent({
        pluginId,
        api,
        settingsDefinition: definition.settings,
        settings: currentSettings,
        modalScope,
        translate,
        createColorPickerId: (key) => `plugin-${pluginId}-${instanceId}-${key}`,
        onNormalizationError: reportNormalizationError,
        wrapSettingChange: wrapFunctionWithContext,
        onSettingValueChange: async (key, newValue, updateVisibility) => {
          currentSettings[key] = newValue;
          api.ui.displayElement.update(instanceId, {
            settings: { ...currentSettings },
          });
          updateVisibility();
        },
      });

      try {
        const confirmed = await api.ui.dialog.custom(
          dialogContent.htmlContent,
          {
            showCancel: true,
            confirmText: dialogContent.confirmText,
            cancelText: dialogContent.cancelText,
          },
        );

        if (!confirmed) {
          api.ui.displayElement.update(instanceId, {
            settings: originalSettings,
          });
        }
        // 모달 정산은 확정 경계 - 확정·취소 revert 모두 즉시 커밋
        flushPluginInstancesEditSession(pluginId);
      } finally {
        dialogContent.dispose();
      }
    };
  };
};
