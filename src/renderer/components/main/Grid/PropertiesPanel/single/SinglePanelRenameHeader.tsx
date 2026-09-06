import React from 'react';
import PanelRenameControl from '../navigation/PanelRenameControl';
import { PANEL_HEADER_CLASS } from '../navigation/panelChrome';

interface SinglePanelRenameHeaderProps {
  title: string;
  titleClassName: string;
  renameButtonTitle: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
}

const SinglePanelRenameHeader = ({
  title,
  titleClassName,
  renameButtonTitle,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
}: SinglePanelRenameHeaderProps) => {
  return (
    <div className={PANEL_HEADER_CLASS}>
      <PanelRenameControl
        title={title}
        titleClassName={titleClassName}
        renameButtonTitle={renameButtonTitle}
        isRenaming={isRenaming}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameCancelledRef={renameCancelledRef}
        handleRenameCommit={handleRenameCommit}
        handleRenameCancel={handleRenameCancel}
        handleRenameStart={handleRenameStart}
      />
    </div>
  );
};

export default SinglePanelRenameHeader;
