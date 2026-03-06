/**
 * 스마트 가이드를 위한 모든 요소의 bounds를 제공하는 훅
 */

import { useKeyStore } from '@stores/useKeyStore';
import { useStatItemStore } from '@stores/useStatItemStore';
import { useGraphItemStore } from '@stores/useGraphItemStore';
import { usePluginDisplayElementStore } from '@stores/usePluginDisplayElementStore';
import { calculateBounds, type ElementBounds } from '@utils/grid/smartGuides';

/**
 * 현재 탭의 모든 요소(키 + 플러그인 요소)의 bounds를 반환하는 함수를 제공하는 훅
 */
export function useSmartGuidesElements() {
  const positions = useKeyStore((state) => state.positions);
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const statPositions = useStatItemStore((state) => state.positions);
  const graphPositions = useGraphItemStore((state) => state.positions);
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );

  /**
   * 특정 요소를 제외한 모든 요소의 bounds를 반환
   * @param excludeIds 제외할 요소의 ID (단일 문자열 또는 문자열 배열)
   */
  const getOtherElements = (excludeIds: string | string[]): ElementBounds[] => {
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
          calculateBounds(
            pos.dx,
            pos.dy,
            pos.width || 60,
            pos.height || 60,
            id,
          ),
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
          calculateBounds(
            pos.dx,
            pos.dy,
            pos.width || 60,
            pos.height || 60,
            id,
          ),
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

    // 플러그인 요소 bounds (현재 탭에 속하는 요소만)
    pluginElements.forEach((el) => {
      if (el.hidden) return;
      // tabId가 없으면 모든 탭에 표시되는 요소로 간주
      // tabId가 있으면 현재 선택된 탭과 일치해야 함
      const belongsToCurrentTab = !el.tabId || el.tabId === selectedKeyType;

      if (
        !excludeSet.has(el.fullId) &&
        el.measuredSize &&
        belongsToCurrentTab
      ) {
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

  return { getOtherElements };
}
