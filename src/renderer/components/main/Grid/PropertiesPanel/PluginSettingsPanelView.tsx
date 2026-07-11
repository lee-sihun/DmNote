import React from 'react';
import type {
  PluginSettingSchema,
  PluginMessages,
  PluginSettingValue,
} from '@src/types/plugin/api';
import type { PluginSettingsPanelPayload } from '@stores/grid/usePropertiesPanelStore';
import { SidebarToggleIcon } from './PropertyInputs';
import { PANEL_ROOT_CLASS } from './panelChrome';

interface PluginSettingsPanelViewProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  pluginSettingsPanel: PluginSettingsPanelPayload;
  pluginPanelSettings: Record<string, unknown>;
  handlePluginSettingsPanelChange: (
    key: string,
    value: PluginSettingValue,
  ) => void;
  handlePluginSettingsPanelConfirm: () => void;
  handlePluginSettingsPanelCancel: () => void;
  setPluginScrollRef: (node: HTMLDivElement | null) => void;
  renderPluginSettingsForm: (
    schema: Record<string, PluginSettingSchema> | undefined,
    values: Record<string, unknown>,
    messages: PluginMessages | undefined,
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
    options?: { wrap?: boolean },
  ) => React.ReactNode;
  t: (key: string) => string | undefined;
}

const PluginSettingsPanelView: React.FC<PluginSettingsPanelViewProps> = ({
  setPanelElement,
  pluginSettingsPanel,
  pluginPanelSettings,
  handlePluginSettingsPanelChange,
  handlePluginSettingsPanelConfirm,
  handlePluginSettingsPanelCancel,
  setPluginScrollRef,
  renderPluginSettingsForm,
  t,
}) => {
  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex items-center justify-between p-[12px] pb-[12px]">
        <div className="flex flex-col gap-[2px]">
          <span className="text-fg text-style-2 leading-none">
            {t('propertiesPanel.pluginSettings') || '플러그인 설정'}
          </span>
          <span className="text-fg-faint text-body truncate max-w-[150px]">
            {pluginSettingsPanel.pluginId}
          </span>
        </div>
        <button
          onClick={handlePluginSettingsPanelCancel}
          className="w-[24px] h-[24px] -my-[6px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors"
          title={t('propertiesPanel.closePanel') || '속성 패널 닫기'}
        >
          <SidebarToggleIcon isOpen={true} />
        </button>
      </div>
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={setPluginScrollRef}
          className="properties-panel-overlay-viewport"
        >
          <div className="px-[12px] pb-[12px]">
            {renderPluginSettingsForm(
              pluginSettingsPanel.definition.settings,
              pluginPanelSettings,
              pluginSettingsPanel.definition.messages,
              `plugin-settings-${pluginSettingsPanel.pluginId}`,
              handlePluginSettingsPanelChange,
            )}
          </div>
        </div>
      </div>
      <div className="border-t border-line p-[12px]">
        <div className="flex gap-[8px]">
          <button
            onClick={handlePluginSettingsPanelCancel}
            className="flex-1 h-[30px] bg-fill rounded-lg text-style-3 text-fg hover:bg-fill-hover transition-colors"
          >
            {t('common.cancel') || '취소'}
          </button>
          <button
            onClick={handlePluginSettingsPanelConfirm}
            className="flex-1 h-[30px] bg-fill rounded-lg text-style-3 text-fg hover:bg-fill-hover transition-colors"
          >
            {t('common.save') || '저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PluginSettingsPanelView;
