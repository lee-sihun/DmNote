import React from 'react';
import type { PluginSettingSchema, PluginMessages, PluginSettingValue } from '@src/types/api';
import type { PluginSettingsPanelPayload } from '@stores/usePropertiesPanelStore';
import { SidebarToggleIcon } from './PropertyInputs';

interface PluginSettingsPanelViewProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  pluginSettingsPanel: PluginSettingsPanelPayload;
  pluginPanelSettings: Record<string, unknown>;
  handlePluginSettingsPanelChange: (key: string, value: PluginSettingValue) => void;
  handlePluginSettingsPanelConfirm: () => void;
  handlePluginSettingsPanelCancel: () => void;
  setPluginScrollRef: (node: HTMLDivElement | null) => void;
  setPluginThumbRef: (node: HTMLDivElement | null) => void;
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
  setPluginThumbRef,
  renderPluginSettingsForm,
  t,
}) => {
  return (
    <div
      ref={setPanelElement}
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-[#1F1F24] border-l border-[#3A3943] flex flex-col z-30 shadow-lg"
    >
      <div className="flex items-center justify-between p-[12px] border-b border-[#3A3943]">
        <div className="flex flex-col gap-[2px]">
          <span className="text-[#DBDEE8] text-style-2">
            {t('propertiesPanel.pluginSettings') || '플러그인 설정'}
          </span>
          <span className="text-[#6B6D75] text-style-4 truncate max-w-[150px]">
            {pluginSettingsPanel.pluginId}
          </span>
        </div>
        <button
          onClick={handlePluginSettingsPanelCancel}
          className="w-[24px] h-[24px] flex items-center justify-center hover:bg-[#2A2A30] rounded-[4px] transition-colors"
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
          <div className="p-[12px]">
            {renderPluginSettingsForm(
              pluginSettingsPanel.definition.settings,
              pluginPanelSettings,
              pluginSettingsPanel.definition.messages,
              `plugin-settings-${pluginSettingsPanel.pluginId}`,
              handlePluginSettingsPanelChange,
            )}
          </div>
          <div className="properties-panel-overlay-bar">
            <div
              ref={setPluginThumbRef}
              className="properties-panel-overlay-thumb"
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>
      <div className="border-t border-[#3A3943] p-[12px]">
        <div className="flex gap-[8px]">
          <button
            onClick={handlePluginSettingsPanelCancel}
            className="flex-1 h-[30px] bg-[#2A2A30] border border-[#3A3943] rounded-[7px] text-style-3 text-[#DBDEE8] hover:bg-[#303036] transition-colors"
          >
            {t('common.cancel') || '취소'}
          </button>
          <button
            onClick={handlePluginSettingsPanelConfirm}
            className="flex-1 h-[30px] bg-[#2A2A30] border border-[#3A3943] rounded-[7px] text-style-3 text-[#DBDEE8] hover:bg-[#303036] transition-colors"
          >
            {t('common.save') || '저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PluginSettingsPanelView;
