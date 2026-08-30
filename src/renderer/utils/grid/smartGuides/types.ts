export interface ElementBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface GuideLine {
  type: 'vertical' | 'horizontal';
  position: number; // 가이드라인의 x 또는 y 위치
  alignType: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
}

/**
 * 간격 가이드 인터페이스
 * 요소 사이의 간격을 시각화
 */
export interface SpacingGuide {
  type: 'spacing';
  direction: 'horizontal' | 'vertical';
  value: number; // 간격 값 (px)
  // 간격 표시 위치
  startPos: number; // 간격 시작 위치 (x 또는 y)
  endPos: number; // 간격 끝 위치 (x 또는 y)
  crossAxisPos: number; // 교차 축 위치 (라벨 표시용)
  // 관련 요소
  fromElementId: string;
  toElementId: string;
  // 이 간격이 다른 간격과 일치하여 스냅됐는지
  isMatched: boolean;
}

/**
 * 크기 일치 가이드 인터페이스
 * 리사이즈 시 다른 요소와 동일한 크기로 스냅
 */
export interface SizeMatchGuide {
  type: 'size-match';
  dimension: 'width' | 'height';
  value: number; // 일치하는 크기 값
  position: { x: number; y: number }; // 표시 위치
  matchedElementId: string;
  // 일치하는 요소의 bounds (테두리 표시용)
  matchedElementBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface SnapResult {
  snappedX: number;
  snappedY: number;
  guides: GuideLine[];
  spacingGuides: SpacingGuide[];
  didSnapX: boolean;
  didSnapY: boolean;
  // 간격 스냅 여부
  didSpacingSnapX: boolean;
  didSpacingSnapY: boolean;
}

export interface SizeSnapResult {
  snappedWidth: number;
  snappedHeight: number;
  sizeMatchGuides: SizeMatchGuide[];
  didSnapWidth: boolean;
  didSnapHeight: boolean;
}

/**
 * calculateSnapPoints 옵션 인터페이스
 */
export interface SnapPointsOptions {
  /** 그룹 선택 시 전체 그룹의 bounds (캔버스 중앙 스냅에 사용) */
  groupBounds?: ElementBounds | null;

  /** 간격(Spacing) 가이드/스냅 계산을 비활성화 */
  disableSpacing?: boolean;

  /** 캔버스 중앙 스냅 결과를 맞출 그리드 크기, 0이면 반올림 없음 */
  gridSnapSize?: number;
}
