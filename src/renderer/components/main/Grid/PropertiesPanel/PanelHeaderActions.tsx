import React from 'react';
import { useTranslation } from '@contexts/useTranslation';
import IconSwap from '@components/main/common/IconSwap';
import { ModeToggleIcon } from './PropertyInputs';

interface PanelHeaderActionsProps {
  // 실제 표시 중인 패널 기준 모드 (panelMode가 property여도 선택이 없으면 layer 뷰)
  mode: 'layer' | 'property';
  // 플러그인 설정 패널에서는 모드 전환 숨김
  modeToggleHidden?: boolean;
  modeToggleDisabled?: boolean;
  onToggleMode: () => void;
}

// 패널 헤더 우측 액션 — 패널 본문(루트 페이지 콘텐츠)이 통째로 교체되어도
// 버튼 노드가 유지되도록 프레임의 루트 페이지 레이어에서 렌더.
// 아이콘 스왑 전환이 발동하고, 리마운트로 인한 hover 깜빡임도 없음.
// 닫기 토글은 프레임 밖의 PanelToggleButton이 담당 — 오른쪽 40px 비워둠
const PanelHeaderActions = ({
  mode,
  modeToggleHidden = false,
  modeToggleDisabled = false,
  onToggleMode,
}: PanelHeaderActionsProps) => {
  const { t } = useTranslation();
  const modeToggleLabel =
    mode === 'property'
      ? t('propertiesPanel.switchToLayer') || 'Switch to Layer'
      : t('propertiesPanel.switchToProperty') || 'Switch to Property';

  if (modeToggleHidden) return null;

  return (
    <div className="absolute top-0 right-0 h-[48px] pl-[12px] pr-[40px] flex items-center pointer-events-none">
      <button
        disabled={modeToggleDisabled}
        onClick={modeToggleDisabled ? undefined : onToggleMode}
        className={`pointer-events-auto w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors ${
          modeToggleDisabled
            ? 'text-fg-disabled cursor-not-allowed'
            : 'text-white/45 hover:text-white/90 cursor-pointer'
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
    </div>
  );
};

export default PanelHeaderActions;
