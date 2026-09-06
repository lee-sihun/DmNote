// 캔버스 선택 조합에 대한 속성 패널 라우트 판정
// 플러그인이 섞인 선택은 총요소(native+plugin) 기준으로 배치 패널에 라우트하고
// (native 1개여도 배치), 플러그인 단독 다중은 경량 기하 배치(pluginBatch)

export type SelectionPanelRouteKind =
  | 'batchKeyLike'
  | 'batchKnobOnly'
  | 'batchGraphOnly'
  | 'pluginBatch'
  | 'plugin'
  | 'singleKnob'
  | 'singleGraph'
  | 'singleKeyStat'
  | 'singleSprite'
  | 'none';

export interface SelectionPanelRouteInput {
  keyLikeCount: number;
  graphCount: number;
  knobCount: number;
  spriteCount: number;
  pluginCount: number;
  hasSingleKeyPosition: boolean;
  hasSingleStatPosition: boolean;
  hasSingleGraphPosition: boolean;
  hasSingleKnobPosition: boolean;
  hasSingleSpritePosition: boolean;
}

export interface SelectionPanelRoute {
  kind: SelectionPanelRouteKind;
}

export const resolveSelectionPanelRoute = (
  input: SelectionPanelRouteInput,
): SelectionPanelRoute => {
  const {
    keyLikeCount,
    graphCount,
    knobCount,
    spriteCount,
    pluginCount,
    hasSingleKeyPosition,
    hasSingleStatPosition,
    hasSingleGraphPosition,
    hasSingleKnobPosition,
    hasSingleSpritePosition,
  } = input;
  const nativeCount = keyLikeCount + graphCount + knobCount + spriteCount;

  // native 없음 - 플러그인 단독 경로 (단일 편집 또는 경량 기하 배치)
  if (nativeCount === 0) {
    if (pluginCount >= 2) return { kind: 'pluginBatch' };
    return { kind: pluginCount > 0 ? 'plugin' : 'none' };
  }

  // 플러그인 혼합은 native 1개(위치 미해결 포함)여도 배치로 라우트 -
  // 기하 커밋 경로가 fail-closed라 미해결 대상은 커밋 없이 무시된다
  if (pluginCount > 0 || nativeCount > 1) {
    // 키/통계 포함, 또는 그래프+노브 혼합
    if (keyLikeCount > 0 || (graphCount > 0 && knobCount > 0)) {
      return { kind: 'batchKeyLike' };
    }
    if (knobCount > 0) return { kind: 'batchKnobOnly' };
    if (graphCount > 0) return { kind: 'batchGraphOnly' };
    // 스프라이트 단독 다중(또는 스프라이트+플러그인)은 전용 스타일 배치가 없어
    // 정렬·분배·간격만 있는 경량 기하 배치로
    return { kind: 'pluginBatch' };
  }

  // 단일 스프라이트
  if (
    spriteCount === 1 &&
    hasSingleSpritePosition &&
    keyLikeCount === 0 &&
    graphCount === 0 &&
    knobCount === 0
  ) {
    return { kind: 'singleSprite' };
  }

  // 단일 노브
  if (
    knobCount === 1 &&
    hasSingleKnobPosition &&
    keyLikeCount === 0 &&
    graphCount === 0
  ) {
    return { kind: 'singleKnob' };
  }

  // 단일 그래프
  if (graphCount === 1 && hasSingleGraphPosition && keyLikeCount === 0) {
    return { kind: 'singleGraph' };
  }

  // 단일 키/통계
  if (hasSingleKeyPosition || hasSingleStatPosition) {
    return { kind: 'singleKeyStat' };
  }

  // 위치 미해결 등 과도 상태 - 빈 패널
  return { kind: 'none' };
};
