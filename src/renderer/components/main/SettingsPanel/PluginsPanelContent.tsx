import React from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import {
  FILL_DISABLED_CLASS,
  FILL_INTERACTIVE_CLASS,
  PANEL_FOOTER_BUTTON_CLASS,
  PANEL_FOOTER_CLASS,
  PANEL_LIST_EMPTY_CLASS,
  PANEL_LIST_ROW_CLASS,
  PANEL_LIST_SCROLL_CLASS,
  PANEL_LIST_WELL_CLASS,
  PANEL_PILL_CLASS,
  PANEL_ROW_NAME_ACTIVE_CLASS,
  PANEL_ROW_NAME_CLASS,
  PANEL_ROW_NAME_INACTIVE_CLASS,
  PANEL_SECTION_CLASS,
} from '@components/main/SettingsPanel/panelChrome';
import { SettingToggleRow } from '@components/main/common/SettingRow';
import ListPopup from '@components/main/Modal/ListPopup';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import type { JsPlugin } from '@src/types/plugin/js';

interface PluginsPanelContentProps {
  plugins: JsPlugin[];
  useCustomJS: boolean;
  onToggleCustomJS: () => void;
  onAdd: () => void;
  onToggle: (pluginId: string, enabled: boolean) => void;
  onRemove: (pluginId: string) => void;
  onClose: () => void;
  isAdding: boolean;
  // 토글·삭제 요청이 백엔드에 나가 있는 동안 겹침 방지
  isPluginActionPending: boolean;
}

const PluginsPanelContent = ({
  plugins,
  useCustomJS,
  onToggleCustomJS,
  onAdd,
  onToggle,
  onRemove,
  onClose,
  isAdding,
  isPluginActionPending,
}: PluginsPanelContentProps) => {
  const { t } = useTranslation();
  const { scrollContainerRef: scrollRef } = useLenis();
  const menu = usePickerItemMenu<string>();

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-[12px] pb-[12px] shrink-0">
        <div className={PANEL_SECTION_CLASS}>
          <SettingToggleRow
            label={t('settings.customJS')}
            checked={useCustomJS}
            onToggle={onToggleCustomJS}
          />
        </div>
      </div>

      {/* 리스트 테이블 - 패널 바닥까지 채우되 상하좌우 12px 여백 통일 */}
      <div className={PANEL_LIST_WELL_CLASS}>
        <div ref={scrollRef} className={PANEL_LIST_SCROLL_CLASS}>
          {plugins.length === 0 ? (
            <div className={PANEL_LIST_EMPTY_CLASS}>
              {t('settings.noPlugins')}
            </div>
          ) : (
            <div className="flex flex-col py-[8px]">
              {plugins.map((plugin) => {
                return (
                  <div
                    key={plugin.id}
                    role="button"
                    tabIndex={0}
                    onPointerDown={() => menu.capturePressState(plugin.id)}
                    onClick={(event) => menu.openFromRow(event, plugin.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        menu.openFromRow(event, plugin.id);
                      }
                    }}
                    onContextMenu={(event) =>
                      menu.openFromContextMenu(event, plugin.id)
                    }
                    className={PANEL_LIST_ROW_CLASS}
                    title={plugin.name}
                  >
                    <span
                      className={`${PANEL_ROW_NAME_CLASS} ${
                        plugin.enabled
                          ? PANEL_ROW_NAME_ACTIVE_CLASS
                          : PANEL_ROW_NAME_INACTIVE_CLASS
                      }`}
                    >
                      {plugin.name}
                    </span>
                    {/* 알약형 온·오프 - 무채색 밝기 단계로만 상태 표현 */}
                    <button
                      type="button"
                      aria-pressed={plugin.enabled}
                      className={`${PANEL_PILL_CLASS} ${
                        plugin.enabled
                          ? FILL_INTERACTIVE_CLASS
                          : 'bg-fill-faint text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-active'
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isPluginActionPending) return;
                        onToggle(plugin.id, !plugin.enabled);
                      }}
                    >
                      {plugin.enabled ? t('common.on') : t('common.off')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 하단 바 - 추가(주 액션, 크게) + 닫기 */}
      <div className={PANEL_FOOTER_CLASS}>
        <button
          onClick={() => {
            if (!isAdding) onAdd();
          }}
          disabled={isAdding}
          className={`flex-[2] ${PANEL_FOOTER_BUTTON_CLASS} ${
            isAdding ? FILL_DISABLED_CLASS : FILL_INTERACTIVE_CLASS
          }`}
        >
          {isAdding ? t('settings.adding') : t('settings.loadJs')}
        </button>
        <button
          onClick={onClose}
          className={`flex-1 ${PANEL_FOOTER_BUTTON_CLASS} ${FILL_INTERACTIVE_CLASS}`}
        >
          {t('common.close')}
        </button>
      </div>

      {menu.menuKey !== null && (
        <ListPopup
          open
          ariaLabel={t('common.more')}
          position={menu.menuPosition ?? undefined}
          onClose={menu.close}
          items={[{ id: 'remove', label: t('settings.removePlugin') }]}
          onSelect={(id) => {
            const pluginId = menu.menuKey;
            menu.close();
            if (id === 'remove' && pluginId && !isPluginActionPending) {
              onRemove(pluginId);
            }
          }}
          offsetX={0}
          offsetY={0}
        />
      )}
    </div>
  );
};

export default PluginsPanelContent;
