/**
 * 전역 키 이벤트 버스
 * 백엔드에서 한 번만 구독하고, 플러그인들은 이 버스를 통해 이벤트 수신
 */

type KeyStatePayload = {
  key: string;
  state: string;
  mode: string;
};

type KeyEventListener = (payload: KeyStatePayload) => void;

class KeyEventBus {
  private listeners: Set<KeyEventListener> = new Set();
  private initialized = false;

  /**
   * 백엔드 키 이벤트 구독 초기화 (한 번만 호출)
   */
  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // 백엔드에서 한 번만 구독
    window.api.keys.onKeyState((payload) => {
      // 모든 리스너에게 브로드캐스트
      this.listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error('[KeyEventBus] Listener error:', error);
        }
      });
    });
  }

  /**
   * 키 이벤트 리스너 등록
   */
  subscribe(listener: KeyEventListener): () => void {
    this.listeners.add(listener);

    // unsubscribe 함수 반환
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 등록된 리스너 수 (디버깅용)
   */
  getListenerCount(): number {
    return this.listeners.size;
  }
}

// 싱글톤 인스턴스
export const keyEventBus = new KeyEventBus();
