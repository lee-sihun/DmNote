/**
 * 스마트 가이드를 위한 모든 요소의 bounds를 제공하는 훅
 */

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { calculateBounds, type ElementBounds } from '@utils/grid/smartGuides';

/**
 * 특정 요소를 제외한 모든 요소의 bounds를 반환
 * 드래그 시점에만 호출되므로 최신 스냅샷을 getState()로 읽는다 —
 * 반응형 구독을 걸면 임의 요소 하나의 변경이 이 훅을 쓰는 모든
 * 요소(Key·PluginElement·KnobItem·GraphItem)의 리렌더로 번짐
 * @param excludeIds 제외할 요소의 ID (단일 문자열 또는 문자열 배열)
 */
const getOtherElementsSnapshot = (
  excludeIds: string | string[],
): ElementBounds[] => {
  const { positions, selectedKeyType } = useKeyStore.getState();
  const statPositions = useStatItemStore.getState().positions;
  const graphPositions = useGraphItemStore.getState().positions;
  const knobPositions = useKnobItemStore.getState().positions;
  const pluginElements = usePluginDisplayElementStore.getState().elements;

  const bounds: ElementBounds[] = [];
  // 배열로 정규화
  const excludeSet = new Set(
    Array.isArray(excludeIds) ? excludeIds : [excludeIds],
  );

  // 키 요소 bounds
  const keyPositions = positions[selectedKeyType] || [];
  keyPositions.forEach((pos, index) => {
    if (pos.hidden) return;
    const id = `key-${index}`;
    if (!excludeSet.has(id)) {
      bounds.push(
        calculateBounds(pos.dx, pos.dy, pos.width || 60, pos.height || 60, id),
      );
    }
  });

  // 통계 요소 bounds
  const stats = statPositions[selectedKeyType] || [];
  stats.forEach((pos, index) => {
    if (!pos || pos.hidden) return;
    const id = `stat-${index}`;
    if (!excludeSet.has(id)) {
      bounds.push(
        calculateBounds(pos.dx, pos.dy, pos.width || 60, pos.height || 60, id),
      );
    }
  });

  // 그래프 요소 bounds
  const graphs = graphPositions[selectedKeyType] || [];
  graphs.forEach((pos, index) => {
    if (!pos || pos.hidden) return;
    const id = `graph-${index}`;
    if (!excludeSet.has(id)) {
      bounds.push(
        calculateBounds(
          pos.dx,
          pos.dy,
          pos.width || 200,
          pos.height || 100,
          id,
        ),
      );
    }
  });

  // 노브 요소 bounds
  const knobs = knobPositions[selectedKeyType] || [];
  knobs.forEach((pos, index) => {
    if (!pos || pos.hidden) return;
    const id = `knob-${index}`;
    if (!excludeSet.has(id)) {
      bounds.push(
        calculateBounds(pos.dx, pos.dy, pos.width || 60, pos.height || 60, id),
      );
    }
  });

  // 플러그인 요소 bounds (현재 탭에 속하는 요소만)
  pluginElements.forEach((el) => {
    if (el.hidden) return;
    // tabId가 없으면 모든 탭에 표시되는 요소로 간주
    // tabId가 있으면 현재 선택된 탭과 일치해야 함
    const belongsToCurrentTab = !el.tabId || el.tabId === selectedKeyType;

    if (!excludeSet.has(el.fullId) && el.measuredSize && belongsToCurrentTab) {
      bounds.push(
        calculateBounds(
          el.position.x,
          el.position.y,
          el.measuredSize.width,
          el.measuredSize.height,
          el.fullId,
        ),
      );
    }
  });

  return bounds;
};

// 구독 없는 훅 — 함수 참조 안정
export function useSmartGuidesElements() {
  return { getOtherElements: getOtherElementsSnapshot };
}
