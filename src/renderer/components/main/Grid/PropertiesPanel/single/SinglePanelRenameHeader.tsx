import React from 'react';
import { PANEL_HEADER_CLASS } from '../panelChrome';
import RenameIcon from './RenameIcon';

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
      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          className="text-fg text-label leading-none bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => {
            if (!renameCancelledRef.current) {
              handleRenameCommit(renameValue);
            }
            renameCancelledRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              handleRenameCancel();
            }
          }}
        />
      ) : (
        <div className="flex items-center gap-[4px] min-w-0">
          <span
            className={titleClassName}
            onDoubleClick={handleRenameStart}
            title={title}
          >
            {title}
          </span>
          <button
            onClick={handleRenameStart}
            className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0"
            title={renameButtonTitle}
          >
            <RenameIcon />
          </button>
        </div>
      )}
    </div>
  );
};

export default SinglePanelRenameHeader;
