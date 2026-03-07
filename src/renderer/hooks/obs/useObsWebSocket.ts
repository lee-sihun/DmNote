import { useEffect, useRef, useState } from 'react';
import type { ObsEnvelope, KeyEventPayload } from '@src/types/obs';
import { OBS_PROTOCOL_VERSION } from '@src/types/obs';
import type { BootstrapPayload } from '@src/types/app';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface UseObsWebSocketOptions {
  url: string;
  token?: string;
  onSnapshot: (payload: BootstrapPayload) => void;
  onKeyEvent: (payload: KeyEventPayload) => void;
  onSettingsDiff: (diff: Record<string, unknown>) => void;
  onCounterUpdate: (data: Record<string, unknown>) => void;
}

function useObsWebSocket({
  url,
  token,
  onSnapshot,
  onKeyEvent,
  onSettingsDiff,
  onCounterUpdate,
}: UseObsWebSocketOptions) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected');

  // 모든 상태를 ref로 관리하여 React Compiler 호환성 확보
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const callbacksRef = useRef({
    onSnapshot,
    onKeyEvent,
    onSettingsDiff,
    onCounterUpdate,
  });

  // 콜백 ref 동기화
  useEffect(() => {
    callbacksRef.current = {
      onSnapshot,
      onKeyEvent,
      onSettingsDiff,
      onCounterUpdate,
    };
  }, [onSnapshot, onKeyEvent, onSettingsDiff, onCounterUpdate]);

  useEffect(() => {
    let disposed = false;

    const sendMessage = (type: string, payload: unknown = null) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const envelope: ObsEnvelope = {
        v: OBS_PROTOCOL_VERSION,
        type,
        seq: seqRef.current++,
        ts: Date.now(),
        payload,
      };
      ws.send(JSON.stringify(envelope));
    };

    const connect = () => {
      if (disposed) return;

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setConnectionState('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        sendMessage('hello', {
          client: 'obs-browser',
          protocol: OBS_PROTOCOL_VERSION,
          appVersion: '',
          resumeFromSeq: 0,
          token: token || undefined,
        });
      };

      ws.onmessage = (event) => {
        let envelope: ObsEnvelope;
        try {
          envelope = JSON.parse(event.data as string) as ObsEnvelope;
        } catch {
          return; // JSON 파싱 실패 무시
        }
        switch (envelope.type) {
          case 'hello_ack':
            setConnectionState('connected');
            break;
          case 'snapshot':
            callbacksRef.current.onSnapshot(
              envelope.payload as BootstrapPayload,
            );
            break;
          case 'key_event':
            callbacksRef.current.onKeyEvent(
              envelope.payload as KeyEventPayload,
            );
            break;
          case 'settings_diff':
            callbacksRef.current.onSettingsDiff(
              envelope.payload as Record<string, unknown>,
            );
            break;
          case 'counter_update':
            callbacksRef.current.onCounterUpdate(
              envelope.payload as Record<string, unknown>,
            );
            break;
          case 'ping':
            sendMessage('pong');
            break;
          case 'error': {
            const payload = envelope.payload as Record<string, unknown>;
            if (payload?.code === 'AUTH_FAILED') {
              console.warn('[ObsWS] 토큰 인증 실패, 재연결 중단');
              disposed = true; // 재연결 루프 방지
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        wsRef.current = null;
        if (!disposed) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose에서 재연결 처리
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, token]);

  const requestResync = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const envelope: ObsEnvelope = {
      v: OBS_PROTOCOL_VERSION,
      type: 'resync_request',
      seq: seqRef.current++,
      ts: Date.now(),
      payload: null,
    };
    ws.send(JSON.stringify(envelope));
  };

  return { connectionState, requestResync };
}

export { useObsWebSocket };
export type { ConnectionState };
