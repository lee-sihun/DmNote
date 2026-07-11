import React from 'react';
import type {
  PluginSettingSchema,
  PluginMessages,
  PluginSettingValue,
} from '@src/types/plugin/api';
import type { PluginSettingsPanelPayload } from '@stores/grid/usePropertiesPanelStore';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from './panelChrome';
import { PropertySection } from './PropertyInputs';

interface PluginSettingsPanelViewProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  pluginSettingsPanel: PluginSettingsPanelPayload;
  pluginPanelSettings: Record<string, unknown>;
  handlePluginSettingsPanelChange: (
    key: string,
    value: PluginSettingValue,
  ) => void;
  handlePluginSettingsPanelConfirm: () => void;
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
  setPluginScrollRef,
  renderPluginSettingsForm,
  t,
}) => {
  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className={PANEL_HEADER_CLASS}>
        {/* 한 줄 헤더 — 타이틀 + 연한 플러그인 id (배치 패널의 카운트 표기와 동일 관례) */}
        <div className="flex items-center gap-[8px] min-w-0">
          <span className="text-fg text-style-2 leading-none flex-shrink-0">
            {t('propertiesPanel.pluginSettings') || '플러그인 설정'}
          </span>
          <span
            className="text-fg-faint text-body truncate max-w-[100px]"
            title={pluginSettingsPanel.pluginId}
          >
            {pluginSettingsPanel.pluginId}
          </span>
        </div>
      </div>
      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={setPluginScrollRef}
          className="properties-panel-overlay-viewport"
        >
          <div className="px-[12px] pb-[12px]">
            {/* 요소 선택 패널과 동일한 섹션 카드로 폼을 감쌈 */}
            <PropertySection>
              {renderPluginSettingsForm(
                pluginSettingsPanel.definition.settings,
                pluginPanelSettings,
                pluginSettingsPanel.definition.messages,
                `plugin-settings-${pluginSettingsPanel.pluginId}`,
                handlePluginSettingsPanelChange,
                { wrap: false },
              )}
            </PropertySection>
          </div>
        </div>
      </div>
      {/* 단일 저장 CTA — 취소는 우상단 패널 토글(X)이 담당 */}
      <div className="p-[12px] shrink-0">
        <button
          onClick={handlePluginSettingsPanelConfirm}
          className="w-full h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-lg text-accent-fg text-label transition-colors duration-fast"
        >
          {t('common.save') || '저장'}
        </button>
      </div>
    </div>
  );
};

export default PluginSettingsPanelView;
