import React from 'react';
import PanelRenameControl from '../navigation/PanelRenameControl';
import { PANEL_HEADER_CLASS } from '../navigation/panelChrome';

interface BatchPanelHeaderProps {
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
  t: (key: string) => string | undefined;
}

const BatchPanelHeader = ({
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
  t,
}: BatchPanelHeaderProps) => (
  <div className={PANEL_HEADER_CLASS}>
    <div className="flex items-center gap-[8px]">
      {selectedGroupInfo ? (
        <PanelRenameControl
          title={selectedGroupInfo.name}
          titleClassName="text-fg text-label leading-none cursor-default truncate max-w-[110px]"
          renameButtonTitle={
            isRenaming ? '' : t('contextMenu.rename') || 'Rename'
          }
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
        />
      ) : (
        <span className="text-fg text-label leading-none">
          {t('propertiesPanel.multiSelection') || '다중 선택'}
        </span>
      )}
      {!selectedGroupInfo && (
        <span className="text-fg-faint text-body">({totalCount})</span>
      )}
    </div>
  </div>
);

export default BatchPanelHeader;
