import React from 'react';
import { PANEL_ROOT_CLASS } from '../panelChrome';
import { PropertySection, TABS, type TabType } from '../index';
import BatchGeometrySection from './BatchGeometrySection';
import EditSessionBoundary from '../EditSessionBoundary';
import BatchPanelHeader from './BatchPanelHeader';
import type { MixedValueResult } from './batchPanelShared';

interface BatchPluginOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // 플러그인 단독 다중 선택 개수
  totalCount: number;
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  t: (key: string) => string | undefined;
}

// 플러그인 크기는 content-driven이라 resize 없이 정렬·분배·간격만 노출.
// 스타일 필드는 플러그인 스키마 소유라 배치 편집 대상이 아니다
const BatchPluginOnlyPanel: React.FC<BatchPluginOnlyPanelProps> = ({
  setPanelElement,
  totalCount,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  batchScrollRefFor,
  t,
}) => {
  const batchPluginSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          t={t}
        />
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <PropertySection>
              <BatchGeometrySection
                totalCount={totalCount}
                handleBatchAlign={handleBatchAlign}
                handleBatchDistribute={handleBatchDistribute}
                handleBatchSpacing={handleBatchSpacing}
                handleBatchSpacingCommit={handleBatchSpacingCommit}
                batchSpacing={batchPluginSpacing}
                t={t}
              />
            </PropertySection>
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};

export default BatchPluginOnlyPanel;
