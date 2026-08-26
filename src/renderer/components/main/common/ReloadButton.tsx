import ReloadIcon from './ReloadIcon';

interface ReloadButtonProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  // 진행 중: 아이콘 회전 + 흐림, 클릭 차단
  busy?: boolean;
}

// 23px 정사각 리로드 버튼 - 플러그인 리로드와 OBS 토큰 재생성이 같은 외형을 쓴다
const ReloadButton = ({
  onClick,
  title,
  disabled = false,
  busy = false,
}: ReloadButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    title={title}
    aria-busy={busy || undefined}
    className={
      'flex items-center justify-center w-[23px] h-[23px] rounded-md transition-colors duration-fast ' +
      (disabled || busy
        ? 'bg-fill-faint text-fg-disabled cursor-not-allowed'
        : 'bg-fill text-fg hover:bg-fill-hover')
    }
    style={busy ? { opacity: 0.65 } : undefined}
  >
    <ReloadIcon spinning={busy} />
  </button>
);

export default ReloadButton;
