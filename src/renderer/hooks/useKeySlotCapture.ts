import { useEffect, useRef, useState } from 'react';
import { getKeyInfoByGlobalKey } from '@utils/input/KeyMaps';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock';

interface UseKeySlotCaptureOptions {
  // 캡처 완료 콜백. listenIndex가 number면 해당 멤버 교체, null이면 추가
  onCapture: (globalKey: string, listenIndex: number | null) => void;
  // Escape로 리스닝 취소 (속성 패널 기존 동작)
  escapeCancels?: boolean;
}

// 키 슬롯 캡처 리스닝 공통 훅
// 전역 리스닝 플래그, 브라우저 이벤트 차단, raw input 구독을 관리
export function useKeySlotCapture({
  onCapture,
  escapeCancels = false,
}: UseKeySlotCaptureOptions) {
  const [isListening, setIsListening] = useState(false);
  const [listenIndex, setListenIndex] = useState<number | null>(null);
  const justAssignedRef = useRef(false);
  const flagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCaptureRef = useRef(onCapture);

  useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  // 키 리스닝 플래그를 전역으로 노출 (Grid 단축키 등에서 체크)
  useEffect(() => {
    if (flagTimerRef.current !== null) {
      clearTimeout(flagTimerRef.current);
      flagTimerRef.current = null;
    }

    if (isListening) {
      window.__dmn_isKeyListening = true;
    } else {
      // macOS: raw input이 브라우저 keydown보다 먼저 도착할 수 있어 지연 해제
      flagTimerRef.current = setTimeout(() => {
        window.__dmn_isKeyListening = false;
        flagTimerRef.current = null;
      }, 150);
    }

    return () => {
      if (flagTimerRef.current !== null) {
        clearTimeout(flagTimerRef.current);
        flagTimerRef.current = null;
      }
    };
  }, [isListening]);

  // 언마운트 시 반드시 플래그 해제
  useEffect(() => {
    return () => {
      window.__dmn_isKeyListening = false;
      if (flagTimerRef.current !== null) {
        clearTimeout(flagTimerRef.current);
        flagTimerRef.current = null;
      }
    };
  }, []);

  // 리스닝 중 브라우저 기본 동작 차단
  useEffect(() => {
    if (!isListening) return undefined;

    const blockKeyboardEvents = (e: KeyboardEvent) => {
      if (
        escapeCancels &&
        e.key === 'Escape' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        setIsListening(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const blockMouseEvents = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const blockContextMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', blockKeyboardEvents, true);
    window.addEventListener('keyup', blockKeyboardEvents, true);
    window.addEventListener('keypress', blockKeyboardEvents, true);
    window.addEventListener('mousedown', blockMouseEvents, true);
    window.addEventListener('contextmenu', blockContextMenu, true);

    return () => {
      window.removeEventListener('keydown', blockKeyboardEvents, true);
      window.removeEventListener('keyup', blockKeyboardEvents, true);
      window.removeEventListener('keypress', blockKeyboardEvents, true);
      window.removeEventListener('mousedown', blockMouseEvents, true);
      window.removeEventListener('contextmenu', blockContextMenu, true);
    };
  }, [isListening, escapeCancels]);

  // raw input 구독
  useEffect(() => {
    if (!isListening) return undefined;
    if (typeof window === 'undefined' || !window.api?.keys?.onRawInput) {
      return undefined;
    }

    const unsubscribe = window.api.keys.onRawInput((payload) => {
      if (isHistoryEditorFlushLocked()) return;
      if (!payload || payload.state !== 'DOWN') return;
      const targetLabel =
        payload.label ||
        (Array.isArray(payload.labels) ? payload.labels[0] : null);
      if (!targetLabel) return;

      const info = getKeyInfoByGlobalKey(targetLabel);

      if (escapeCancels && info.globalKey === 'ESCAPE') {
        setIsListening(false);
        return;
      }

      // 마우스 클릭으로 할당 시 버튼 재클릭 방지를 위한 플래그
      justAssignedRef.current = true;
      setTimeout(() => {
        justAssignedRef.current = false;
      }, 100);

      setIsListening(false);
      onCaptureRef.current(info.globalKey, listenIndex);
    });

    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.error('Failed to unsubscribe raw input listener', error);
      }
    };
  }, [isListening, listenIndex, escapeCancels]);

  // 리스닝 시작. index가 number면 해당 멤버 교체, null이면 추가
  const startListen = (index: number | null) => {
    if (justAssignedRef.current) return;
    setListenIndex(index);
    setIsListening(true);
  };

  const stopListen = () => {
    setIsListening(false);
  };

  return { isListening, listenIndex, startListen, stopListen };
}
