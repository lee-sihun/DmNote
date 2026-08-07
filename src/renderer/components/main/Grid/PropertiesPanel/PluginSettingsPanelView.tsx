import { usePressAction } from '@hooks/usePressAction';
import React from 'react';
import type {
  PluginSettingSchema,
  PluginMessages,
  PluginSettingValue,
} from '@src/types/plugin/api';
import type { PluginSettingsPanelPayload } from '@stores/grid/usePropertiesPanelStore';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from './panelChrome';
import {
  hasRenderableSettings,
  type SettingsNormalizationErrorKind,
} from '@plugins/runtime/settingsSections';

interface PluginSettingsPanelViewProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  pluginSettingsPanel: PluginSettingsPanelPayload;
  pluginPanelSettings: Record<string, unknown>;
  handlePluginSettingsPanelChange: (
    key: string,
    value: PluginSettingValue,
  ) => void;
  handlePluginSettingsPanelConfirm: () => void;
  isSaving: boolean;
  setPluginScrollRef: (node: HTMLDivElement | null) => void;
  renderPluginSettingsForm: (
    schema: Record<string, PluginSettingSchema> | undefined,
    values: Record<string, unknown>,
    messages: PluginMessages | undefined,
    pluginId: string,
    colorIdPrefix: string,
    onChange: (key: string, value: unknown) => void,
  ) => React.ReactNode;
  reportNormalizationError: (
    pluginId: string,
    key: string,
    error: unknown,
    kind: SettingsNormalizationErrorKind,
  ) => void;
  t: (key: string) => string | undefined;
}

const PluginSettingsPanelView: React.FC<PluginSettingsPanelViewProps> = ({
  setPanelElement,
  pluginSettingsPanel,
  pluginPanelSettings,
  handlePluginSettingsPanelChange,
  handlePluginSettingsPanelConfirm,
  isSaving,
  setPluginScrollRef,
  renderPluginSettingsForm,
  reportNormalizationError,
  t,
}) => {
  // 렌더할 설정이 없으면 안내 문구를 패널 세로 중앙에 배치
  // empty-state로 단락돼도 visibility 예외가 기록되도록 폼과 같은 리포터 전달
  const settingsRenderable = hasRenderableSettings(
    pluginSettingsPanel.definition.settings,
    pluginPanelSettings,
    (key, error, kind) =>
      reportNormalizationError(pluginSettingsPanel.pluginId, key, error, kind),
  );

  // 설정 입력 blur와 저장 click의 경합 방어
  const confirmPress = usePressAction(() => handlePluginSettingsPanelConfirm());

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className={PANEL_HEADER_CLASS}>
        {/* 한 줄 헤더 — 타이틀 + 연한 플러그인 id (배치 패널의 카운트 표기와 동일 관례) */}
        <div className="flex items-center gap-[8px] min-w-0">
          <span className="text-fg text-label leading-none flex-shrink-0">
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
      {settingsRenderable ? (
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
                pluginSettingsPanel.pluginId,
                `plugin-settings-${pluginSettingsPanel.pluginId}`,
                handlePluginSettingsPanelChange,
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-[24px]">
          <p className="text-fg-faint text-body text-center">
            {t('propertiesPanel.pluginNoSettings') || '설정할 항목이 없습니다.'}
          </p>
        </div>
      )}
      {/* 단일 저장 CTA — 취소는 우상단 패널 토글(X)이 담당 */}
      <div className="p-[12px] shrink-0">
        <button
          {...confirmPress}
          disabled={isSaving}
          className="w-full h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
        >
          {t('common.save') || '저장'}
        </button>
      </div>
    </div>
  );
};

export default PluginSettingsPanelView;
