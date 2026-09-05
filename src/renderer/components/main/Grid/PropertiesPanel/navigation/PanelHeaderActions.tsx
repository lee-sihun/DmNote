import { usePressAction } from '@hooks/usePressAction';
import { useTranslation } from '@contexts/useTranslation';
import IconSwap from '@components/main/common/IconSwap';
import { ModeToggleIcon } from '../controls/PropertyInputs';

interface PanelHeaderActionsProps {
  // 실제 표시 중인 패널 기준 모드 (panelMode가 property여도 선택이 없으면 layer 뷰)
  mode: 'layer' | 'property';
  // 플러그인 설정 패널에서는 모드 전환 숨김
  modeToggleHidden?: boolean;
  modeToggleDisabled?: boolean;
  onToggleMode: () => void;
  // 분리 창 전환 - 메인은 detach, 분리 창은 reattach
  detachAction?: 'detach' | 'reattach';
  onDetachAction?: () => void;
  // 분리 창은 접기 토글이 없으므로 우측 예약 공간(40px) 없이 가장자리 정렬
  edgeAligned?: boolean;
}

// 분리/결합은 헤더 드래그로만 제공 — 버튼 UI 임시 비노출
const SHOW_DETACH_ACTION = false;

const DetachIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M6 3H3.5C2.67157 3 2 3.67157 2 4.5V12.5C2 13.3284 2.67157 14 3.5 14H11.5C12.3284 14 13 13.3284 13 12.5V10"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <path
      d="M9 2H14V7"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 2L8 8"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

const ReattachIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M10 13H12.5C13.3284 13 14 12.3284 14 11.5V3.5C14 2.67157 13.3284 2 12.5 2H4.5C3.67157 2 3 2.67157 3 3.5V6"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <path
      d="M7 14H2V9"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2 14L8 8"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

interface DetachActionButtonProps {
  detachAction: 'detach' | 'reattach';
  onDetachAction: () => void;
}

const DetachActionButton = ({
  detachAction,
  onDetachAction,
}: DetachActionButtonProps) => {
  const { t } = useTranslation();
  const label =
    detachAction === 'reattach'
      ? t('propertiesPanel.attachPanel') || 'Attach panel'
      : t('propertiesPanel.detachPanel') || 'Detach panel';
  // 입력 blur 커밋 리렌더와의 경합으로 첫 click이 유실되는 것을 방어
  const press = usePressAction(onDetachAction);

  return (
    <button
      {...press}
      onMouseDown={(event) => event.preventDefault()}
      className="pointer-events-auto w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors text-fg-faint hover:text-fg cursor-pointer"
      title={label}
      aria-label={label}
    >
      {detachAction === 'reattach' ? <ReattachIcon /> : <DetachIcon />}
    </button>
  );
};

// 패널 헤더 우측 액션 — 패널 본문(루트 페이지 콘텐츠)이 통째로 교체되어도
// 버튼 노드가 유지되도록 프레임의 루트 페이지 레이어에서 렌더.
// 아이콘 스왑 전환이 발동하고, 리마운트로 인한 hover 깜빡임도 없음.
// 닫기 토글은 프레임 밖의 PanelToggleButton이 담당 — 오른쪽 40px 비워둠
const PanelHeaderActions = ({
  mode,
  modeToggleHidden = false,
  modeToggleDisabled = false,
  onToggleMode,
  detachAction,
  onDetachAction,
  edgeAligned = false,
}: PanelHeaderActionsProps) => {
  const { t } = useTranslation();
  const modeToggleLabel =
    mode === 'property'
      ? t('propertiesPanel.switchToLayer') || 'Switch to Layer'
      : t('propertiesPanel.switchToProperty') || 'Switch to Property';

  const showDetach =
    SHOW_DETACH_ACTION &&
    detachAction !== undefined &&
    onDetachAction !== undefined;
  if (modeToggleHidden && !showDetach) return null;

  return (
    <div
      className={`absolute top-0 right-0 h-[48px] pl-[12px] ${
        edgeAligned ? 'pr-[12px]' : 'pr-[40px]'
      } flex items-center gap-[2px] ${
        edgeAligned ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      onMouseDown={edgeAligned ? (event) => event.stopPropagation() : undefined}
    >
      {showDetach && detachAction && onDetachAction && (
        <DetachActionButton
          detachAction={detachAction}
          onDetachAction={onDetachAction}
        />
      )}
      {!modeToggleHidden && (
        <button
          disabled={modeToggleDisabled}
          onClick={modeToggleDisabled ? undefined : onToggleMode}
          className={`pointer-events-auto w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors ${
            modeToggleDisabled
              ? 'text-fg-disabled cursor-not-allowed'
              : 'text-fg-faint hover:text-fg cursor-pointer'
          }`}
          title={modeToggleLabel}
          aria-label={modeToggleLabel}
        >
          <IconSwap
            active={mode === 'property'}
            activeIcon={<ModeToggleIcon mode="layer" />}
            inactiveIcon={
              <ModeToggleIcon mode="property" disabled={modeToggleDisabled} />
            }
          />
        </button>
      )}
    </div>
  );
};

export default PanelHeaderActions;
