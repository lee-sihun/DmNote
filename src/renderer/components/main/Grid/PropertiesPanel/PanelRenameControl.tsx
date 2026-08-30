import React from 'react';

interface PanelRenameControlProps {
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

const RenameIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 20H21"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16.5 3.5C17.3284 2.67157 18.6716 2.67157 19.5 3.5V3.5C20.3284 4.32843 20.3284 5.67157 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PanelRenameControl = ({
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
}: PanelRenameControlProps) => {
  return isRenaming ? (
    <input
      ref={renameInputRef}
      type="text"
      className="text-fg text-label leading-none bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
      value={renameValue}
      onChange={(event) => setRenameValue(event.target.value)}
      onBlur={() => {
        if (!renameCancelledRef.current) handleRenameCommit(renameValue);
        renameCancelledRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
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
  );
};

export default PanelRenameControl;
