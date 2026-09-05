import React from 'react';

interface LayerRenameInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  cancelledRef: React.MutableRefObject<boolean>;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

const LayerRenameInput = ({
  inputRef,
  value,
  cancelledRef,
  onChange,
  onCommit,
  onCancel,
}: LayerRenameInputProps) => {
  return (
    <input
      ref={inputRef}
      type="text"
      className="flex-1 text-body bg-transparent border-none p-0 outline-none text-fg min-w-0 caret-accent"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        if (!cancelledRef.current) {
          onCommit(value);
        }
        cancelledRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
};

export default LayerRenameInput;
