import { useEffect, useRef, useState } from 'react';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';

interface UsePluginSettingsPanelControllerOptions {
  t: (key: string) => string;
}

export const usePluginSettingsPanelController = ({
  t,
}: UsePluginSettingsPanelControllerOptions) => {
  const pluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.pluginSettingsPanel,
  );
  const closePluginSettingsPanel = usePropertiesPanelStore(
    (state) => state.closePluginSettingsPanel,
  );
  const [pluginPanelSettings, setPluginPanelSettings] = useState<
    Record<string, unknown>
  >({});
  const [isPluginSettingsSaving, setIsPluginSettingsSaving] = useState(false);
  const pluginSettingsSavingRef = useRef(false);
  const cancelRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (pluginSettingsPanel) {
      setPluginPanelSettings(pluginSettingsPanel.settings || {});
      setIsPluginSettingsSaving(false);
      pluginSettingsSavingRef.current = false;
    }
  }, [pluginSettingsPanel]);

  const handleChange = (key: string, value: unknown) => {
    if (!pluginSettingsPanel) return;
    setPluginPanelSettings((previous) => {
      const next = { ...previous, [key]: value };
      pluginSettingsPanel.onChange(next);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!pluginSettingsPanel || pluginSettingsSavingRef.current) return;
    pluginSettingsSavingRef.current = true;
    setIsPluginSettingsSaving(true);
    try {
      await pluginSettingsPanel.onConfirm(
        pluginPanelSettings,
        pluginSettingsPanel.originalSettings,
      );
      pluginSettingsPanel.resolve(true);
    } catch (error) {
      // settle은 세션이 1회 소유한다 - 여기서는 안내만
      console.error('[Plugin Settings] Failed to apply settings:', error);
      void window.api.ui.dialog
        .alert(t('common.saveFailed'), { confirmText: t('common.ok') })
        .catch(() => {});
    } finally {
      pluginSettingsSavingRef.current = false;
      setIsPluginSettingsSaving(false);
      // 세션이 이미 뷰를 닫았거나 다른 세션이 올라왔으면 남의 패널을 닫지 않는다
      if (
        usePropertiesPanelStore.getState().pluginSettingsPanel ===
        pluginSettingsPanel
      ) {
        closePluginSettingsPanel();
      }
    }
  };

  cancelRef.current = () => {
    if (!pluginSettingsPanel || pluginSettingsSavingRef.current) return;
    try {
      pluginSettingsPanel.onCancel(pluginSettingsPanel.originalSettings);
    } catch (error) {
      console.error('[Plugin Settings] Failed to cancel settings:', error);
    } finally {
      pluginSettingsPanel.resolve(false);
      closePluginSettingsPanel();
    }
  };
  const handleCancel = () => {
    cancelRef.current();
  };

  return {
    pluginSettingsPanel,
    pluginPanelSettings,
    isPluginSettingsSaving,
    cancelRef,
    handleChange,
    handleConfirm,
    handleCancel,
  };
};
