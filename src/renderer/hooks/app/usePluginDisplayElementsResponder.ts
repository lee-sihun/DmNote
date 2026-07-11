import { useEffect } from 'react';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  clearPluginMenuRuntimeState,
  normalizeStateKeys,
  setPluginMenuRuntimeState,
} from '@utils/plugin/pluginMenuRuntimeState';

// 다중 OBS 클라이언트 동시 재연결 시 요청 버스트를 응답 1회로 코얼레싱
const RESPOND_DEBOUNCE_MS = 100;

// 오버레이(네이티브/OBS)의 플러그인 요소 상태 요청에 응답
// Grid 언마운트(설정 화면) 중에도 응답 가능하도록 main App 레벨에 상시 마운트
export function usePluginDisplayElementsResponder() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = window.api.bridge.on(
      'plugin:displayElements:request',
      () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          const elements = usePluginDisplayElementStore.getState().elements;
          window.api.bridge
            .sendTo('overlay', 'plugin:displayElements:sync', { elements })
            .catch(() => {
              // OBS 모드 전환 찰나에 overlay 윈도우 부재로 실패 가능 — 무시
            });
        }, RESPOND_DEBOUNCE_MS);
      },
    );

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // 오버레이의 메뉴 predicate용 상태 동기화 수신 (contextMenuStateKeys)
  // Grid와 함께 언마운트되는 렌더러가 아닌 여기서 상시 수신 —
  // 설정 화면에 있는 동안의 상태 변경도 유실되지 않음
  useEffect(() => {
    const unsubscribe = window.api.bridge.on<{
      fullId: string;
      state: Record<string, unknown>;
    }>('plugin:displayElement:syncMenuState', (data) => {
      if (!data?.fullId || !data.state || typeof data.state !== 'object') {
        return;
      }
      // payload를 신뢰하지 않고 현재 정의의 허용 키와 재교집합
      const { elements, definitions } = usePluginDisplayElementStore.getState();
      const target = elements.find((el) => el.fullId === data.fullId);
      const definition = target?.definitionId
        ? definitions.get(target.definitionId)
        : undefined;
      const allowedKeys = normalizeStateKeys(definition?.contextMenuStateKeys);
      setPluginMenuRuntimeState(data.fullId, data.state, allowedKeys);
    });

    // 요소가 제거되면 메뉴 런타임 상태도 정리
    let knownIds = new Set(
      usePluginDisplayElementStore.getState().elements.map((el) => el.fullId),
    );
    const unsubscribeStore = usePluginDisplayElementStore.subscribe((state) => {
      const currentIds = new Set(state.elements.map((el) => el.fullId));
      knownIds.forEach((fullId) => {
        if (!currentIds.has(fullId)) clearPluginMenuRuntimeState(fullId);
      });
      knownIds = currentIds;
    });

    return () => {
      unsubscribe();
      unsubscribeStore();
    };
  }, []);
}
