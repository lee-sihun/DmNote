import React from 'react';
import type { PropertyRowProps } from '../types';
import {
  FORM_LABEL_CLASS,
  FORM_ROW_CLASS,
  SECTION_CARD_CLASS,
} from '@utils/cardRecipes';

// ============================================================================
// 속성 행
// ============================================================================

export const PropertyRow: React.FC<PropertyRowProps> = ({
  label,
  children,
}) => (
  <div className={FORM_ROW_CLASS}>
    <p className={FORM_LABEL_CLASS}>{label}</p>
    <div className="flex items-center gap-[8px]">{children}</div>
  </div>
);

// 그룹 카드 — 관련 속성 행을 하나의 면으로 묶는 섹션 컨테이너.
// data 표식은 분리 창 피커가 좌우 정렬·폭을 맞추는 기준
export const PropertySection: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div data-dmn-section="true" className={SECTION_CARD_CLASS}>
    {children}
  </div>
);
