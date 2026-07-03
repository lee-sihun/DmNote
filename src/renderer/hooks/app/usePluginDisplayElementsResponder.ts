import { useEffect } from 'react';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';

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
}
