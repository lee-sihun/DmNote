import React from 'react';
import Checkbox from '@components/main/common/Checkbox';
import {
  useOptimisticBooleanCommit,
  type BooleanCommitStrategy,
} from '@hooks/useOptimisticBooleanCommit';
import {
  SETTINGS_CARD_CLASS,
  SETTINGS_ROW_CLASS,
  SETTINGS_LABEL_CLASS,
} from '@utils/cardRecipes';

// 설정 페이지 카드·행 - 설정 페인과 같은 설정 표면 밀도 공유
// 높이/패딩 오버라이드 API를 두지 않음 - 임의 밀도 방지 가드레일

interface SettingCardProps {
  children: React.ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const SettingCard = ({
  children,
  onMouseEnter,
  onMouseLeave,
}: SettingCardProps) => (
  <div
    className={SETTINGS_CARD_CLASS}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {children}
  </div>
);

interface SettingRowProps {
  // 문자열이면 기본 라벨 스타일, 노드면 그대로 렌더
  label: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const SettingRow = ({
  label,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: SettingRowProps) => (
  <div
    className={SETTINGS_ROW_CLASS + (onClick ? ' cursor-pointer' : '')}
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    // 행 전체 클릭도 내부 토글의 직접 클릭으로 인정 (usePressGatedSwap)
    data-dmn-press-scope={onClick ? '' : undefined}
  >
    {typeof label === 'string' ? (
      <p className={SETTINGS_LABEL_CLASS}>{label}</p>
    ) : (
      label
    )}
    <div className="flex items-center gap-[8px] shrink-0">{children}</div>
  </div>
);

interface SettingToggleRowProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
  commitStrategy?: BooleanCommitStrategy;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

// 토글 행 전체가 button role=switch라 키보드로도 조작 가능
// 내부 Checkbox는 장식 - 클릭·포커스는 행 버튼이 소유
export const SettingToggleRow = ({
  label,
  checked,
  onToggle,
  commitStrategy = 'sync',
  onMouseEnter,
  onMouseLeave,
}: SettingToggleRowProps) => {
  const { value: visualChecked, toggle } = useOptimisticBooleanCommit({
    canonicalValue: checked,
    onCommit: onToggle,
    strategy: commitStrategy,
  });

  return (
    <button
      type="button"
      role="switch"
      aria-checked={visualChecked}
      onClick={toggle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-dmn-press-scope=""
      className={`${SETTINGS_ROW_CLASS} cursor-pointer`}
    >
      <span className={SETTINGS_LABEL_CLASS}>{label}</span>
      {/* 토글 자체는 포인터를 받아야 노브 드래그가 산다. 스위치 의미는 행 버튼이
          이미 갖고 있으므로 여기는 aria-hidden으로 남기고, 클릭 이중 발화는
          Checkbox가 stopPropagation으로 끊는다 */}
      <span aria-hidden="true">
        <Checkbox checked={visualChecked} onChange={toggle} />
      </span>
    </button>
  );
};
