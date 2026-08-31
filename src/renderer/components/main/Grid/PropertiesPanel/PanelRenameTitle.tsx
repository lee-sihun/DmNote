import React from 'react';

import { RenameIcon } from './PanelIcons';

// 패널 헤더의 제목과 인라인 이름 변경. 단일 선택 패널 3종·키 계열 패널·
// 배치 그룹 헤더가 같은 규약을 쓴다 (더블클릭 또는 연필 버튼으로 시작,
// Enter는 blur로 커밋, Escape는 취소. blur·Escape 경합은 호출부 ref가 가른다)

// 계열별 제목 규격 - 그래프·노브·스프라이트는 좁고, 키 계열·배치 그룹은 넓다
const TITLE_CLASS = {
  compact: 'text-fg text-label truncate max-w-[100px] cursor-default',
  wide: 'text-fg text-label leading-none cursor-default truncate max-w-[110px]',
} as const;

interface PanelRenameTitleProps {
  title: string;
  isRenaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameInputRef: React.RefObject<HTMLInputElement>;
  /** Escape 취소가 뒤따르는 blur 커밋을 삼키게 하는 공유 플래그 */
  renameCancelledRef: React.MutableRefObject<boolean>;
  onRenameCommit: (value: string) => void;
  onRenameCancel: () => void;
  onRenameStart: () => void;
  renameLabel: string;
  variant?: keyof typeof TITLE_CLASS;
}

const PanelRenameTitle = ({
  title,
  isRenaming,
  renameValue,
  setRenameValue,
  renameInputRef,
  renameCancelledRef,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
  renameLabel,
  variant = 'compact',
}: PanelRenameTitleProps) => {
  if (isRenaming) {
    return (
      <input
        ref={renameInputRef}
        type="text"
        className="text-fg text-label leading-none bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onBlur={() => {
          if (!renameCancelledRef.current) {
            onRenameCommit(renameValue);
          }
          renameCancelledRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onRenameCancel();
          }
        }}
      />
    );
  }

  return (
    <div className="flex items-center gap-[4px] min-w-0">
      <span
        className={TITLE_CLASS[variant]}
        onDoubleClick={onRenameStart}
        title={title}
      >
        {title}
      </span>
      <button
        onClick={onRenameStart}
        className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0"
        title={renameLabel}
      >
        <RenameIcon />
      </button>
    </div>
  );
};

export default PanelRenameTitle;
