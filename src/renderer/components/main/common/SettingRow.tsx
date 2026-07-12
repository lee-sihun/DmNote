import React from 'react';
import {
  SECTION_CARD_CLASS_COMFORTABLE,
  FORM_ROW_CLASS_COMFORTABLE,
} from '@utils/cardRecipes';

// 설정 페이지 전용 comfortable 밀도 카드·행
// 높이/패딩 오버라이드 API를 두지 않음 — 제3 밀도 방지 가드레일

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
    className={SECTION_CARD_CLASS_COMFORTABLE}
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
    className={FORM_ROW_CLASS_COMFORTABLE + (onClick ? ' cursor-pointer' : '')}
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {typeof label === 'string' ? (
      <p className="text-label text-fg">{label}</p>
    ) : (
      label
    )}
    <div className="flex items-center gap-[8px] shrink-0">{children}</div>
  </div>
);
