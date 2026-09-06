import React from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  PANEL_ROOT_CLASS,
  PANEL_HEADER_CLASS,
} from '../navigation/panelChrome';
import { LAYER_PANEL_TABS, type LayerPanelTabType } from '../types';
import LayerTabContent from './LayerTabContent';
import GridTabContent from '../GridTabContent';
import TabSwitch from '@components/main/common/TabSwitch';

// ============================================================================
// 레이어 패널 Props
// ============================================================================

interface LayerPanelProps {
  onSwitchToProperty?: () => void;
  onSelectionFromPanel?: () => void;
}

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
  return (
    <TabSwitch
      tabs={[
        {
          id: LAYER_PANEL_TABS.LAYER,
          label: t('propertiesPanel.tabLayer') || '레이어',
        },
        {
          id: LAYER_PANEL_TABS.GRID,
          label: t('propertiesPanel.tabGrid') || '그리드',
        },
      ]}
      activeTab={activeTab}
      onTabChange={(tab) => onTabChange(tab as LayerPanelTabType)}
      commitStrategy="after-paint"
    />
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
          <span className="text-fg text-label leading-none">
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
