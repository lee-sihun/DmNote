import React from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
import { LAYER_PANEL_TABS, type LayerPanelTabType } from '../types';
import LayerTabContent from './LayerTabContent';
import GridTabContent from '../GridTabContent';

// ============================================================================
// 레이어 패널 Props
// ============================================================================

interface LayerPanelProps {
  onSwitchToProperty?: () => void;
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
    className={`relative z-10 w-full h-full rounded-[8px] text-body transition-colors duration-base ${
      active ? 'text-fg' : 'text-fg-muted hover:text-fg'
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
}) => {
  const activeIndex = activeTab === LAYER_PANEL_TABS.GRID ? 1 : 0;

  return (
    <div className="relative flex w-full h-[30px] bg-inset rounded-surface items-center p-[2px]">
      <div
        aria-hidden
        className="absolute top-[2px] bottom-[2px] left-[2px] rounded-[8px] bg-fill-active shadow-elevation-chrome transition-transform duration-base ease-out-expo"
        style={{
          width: 'calc((100% - 4px) / 2)',
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
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
};

// ============================================================================
// 레이어 패널 컴포넌트
// ============================================================================

const LayerPanel: React.FC<LayerPanelProps> = ({
  onSwitchToProperty,
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
    <div className={PANEL_ROOT_CLASS} onMouseDown={handleHeaderEmptyClick}>
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0">
        {/* 헤더 */}
        <div className={PANEL_HEADER_CLASS}>
          <span className="text-fg text-style-2 leading-none">
            {t('propertiesPanel.canvas') || 'Canvas'}
          </span>
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
