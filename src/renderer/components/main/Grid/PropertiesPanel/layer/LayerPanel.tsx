import React from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { SidebarToggleIcon, ModeToggleIcon } from '../PropertyInputs';
import { LAYER_PANEL_TABS, type LayerPanelTabType } from '../types';
import LayerTabContent from './LayerTabContent';
import GridTabContent from '../GridTabContent';

// ============================================================================
// 레이어 패널 Props
// ============================================================================

interface LayerPanelProps {
  onClose: () => void;
  onSwitchToProperty?: () => void;
  hasSelection?: boolean;
  onSelectionFromPanel?: () => void;
}

// ============================================================================
// 레이어 패널 탭 버튼 컴포넌트
// ============================================================================

interface LayerPanelTabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const LayerPanelTabButton: React.FC<LayerPanelTabButtonProps> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    className={`w-full h-[24px] rounded-md text-style-2 transition-colors ${
      active
        ? 'bg-surface-active text-fg shadow-elevation-1'
        : 'text-fg-muted hover:text-fg'
    }`}
  >
    {children}
  </button>
);

// ============================================================================
// 레이어 패널 탭 컴포넌트
// ============================================================================

interface LayerPanelTabsProps {
  activeTab: LayerPanelTabType;
  onTabChange: (tab: LayerPanelTabType) => void;
  t: (key: string) => string;
}

const LayerPanelTabs: React.FC<LayerPanelTabsProps> = ({
  activeTab,
  onTabChange,
  t,
}) => (
  <div className="flex w-full h-[30px] bg-inset rounded-md items-center p-[3px] gap-[5px]">
    <LayerPanelTabButton
      active={activeTab === LAYER_PANEL_TABS.LAYER}
      onClick={() => onTabChange(LAYER_PANEL_TABS.LAYER)}
    >
      {t('propertiesPanel.tabLayer') || '레이어'}
    </LayerPanelTabButton>
    <LayerPanelTabButton
      active={activeTab === LAYER_PANEL_TABS.GRID}
      onClick={() => onTabChange(LAYER_PANEL_TABS.GRID)}
    >
      {t('propertiesPanel.tabGrid') || '그리드'}
    </LayerPanelTabButton>
  </div>
);

// ============================================================================
// 레이어 패널 컴포넌트
// ============================================================================

const LayerPanel: React.FC<LayerPanelProps> = ({
  onClose,
  onSwitchToProperty,
  hasSelection = false,
  onSelectionFromPanel,
}) => {
  const { t } = useTranslation();
  const activeTab = usePropertiesPanelStore(
    (state) => state.canvasPanelActiveTab,
  );
  const setActiveTab = usePropertiesPanelStore(
    (state) => state.setCanvasPanelActiveTab,
  );
  const clearSelection = useGridSelectionStore((state) => state.clearSelection);

  // 헤더/탭 영역 빈 공간 클릭 시 선택 해제
  const handleHeaderEmptyClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 버튼, 입력 등 인터랙티브 요소 클릭은 무시
    if (target.closest('button, input')) return;
    // 레이어 리스트 영역은 자체 핸들러가 있으므로 무시
    if (target.closest('.properties-panel-overlay-scroll')) return;
    onSelectionFromPanel?.();
    clearSelection();
  };

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-[220px] bg-elevated border-l border-line flex flex-col z-30 shadow-lg"
      onMouseDown={handleHeaderEmptyClick}
    >
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0 border-b border-line">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-[12px] pb-[8px]">
          <span className="text-fg text-style-2">
            {t('propertiesPanel.canvas') || 'Canvas'}
          </span>
          <div className="flex items-center gap-[4px]">
            {/* 모드 토글 버튼 - hasSelection에 따라 활성/비활성 */}
            <button
              disabled={!hasSelection}
              onClick={hasSelection ? onSwitchToProperty : undefined}
              className={`w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors ${
                hasSelection
                  ? 'hover:bg-surface-hover cursor-pointer'
                  : 'cursor-not-allowed opacity-70'
              }`}
              title={
                t('propertiesPanel.switchToProperty') || 'Switch to Property'
              }
            >
              <ModeToggleIcon mode="property" disabled={!hasSelection} />
            </button>
            {/* 패널 닫기 버튼 */}
            <button
              onClick={onClose}
              className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-hover rounded-[4px] transition-colors"
              title={t('propertiesPanel.closePanel') || 'Close Panel'}
            >
              <SidebarToggleIcon isOpen={true} />
            </button>
          </div>
        </div>

        {/* 탭 */}
        <div className="px-[12px] pb-[12px]">
          <LayerPanelTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            t={t}
          />
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      {activeTab === LAYER_PANEL_TABS.LAYER && (
        <LayerTabContent
          onSwitchToProperty={onSwitchToProperty}
          onSelectionFromPanel={onSelectionFromPanel}
        />
      )}
      {activeTab === LAYER_PANEL_TABS.GRID && <GridTabContent />}
    </div>
  );
};

export default LayerPanel;
