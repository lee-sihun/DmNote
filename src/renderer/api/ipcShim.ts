/**
 * Tauri IPC Shim — OBS 환경에서 invoke/listen을 WebSocket으로 교체
 *
 * obs/index.tsx에서 앱 마운트 전에 initIpcShim()을 호출하면,
 * window.__TAURI_INTERNALS__ 및 __TAURI_EVENT_PLUGIN_INTERNALS__를 설치하여
 * overlay/App.tsx가 코드 변경 없이 동작.
 *
 * 설계 원칙 (§12.4):
 * - 커맨드별 분기 없음. 3단계만: plugin:event → deny → WS RPC
 * - deny 리스트는 hello_ack에서 수신 (백엔드가 유일한 source of truth)
 * - 백엔드 WS RPC 미구현 시 캐시 폴백 (과도기)
 */

import { OBS_PROTOCOL_VERSION } from '@src/types/obs';
import type { ObsEnvelope, HelloAckPayload } from '@src/types/obs';
import type { BootstrapPayload } from '@src/types/app';

// ── 내부 상태 ──

let ws: WebSocket | null = null;
let disposed = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// 연결 정보 (convertFileSrc에서 사용)
let connHost = '127.0.0.1';
let connPort = '34891';
let connToken = '';

// deny 리스트 — hello_ack에서 수신 (백엔드가 source of truth)
// 구 버전 백엔드가 denyList를 보내지 않을 때의 폴백
const DEFAULT_DENY_LIST = [
  // 오버레이 제어 (OBS에서 조작 불가)
  'overlay_resize',
  'overlay_set_visible',
  'overlay_set_lock',
  'overlay_set_anchor',
  'overlay_get',
  // 윈도우/앱 제어
  'window_minimize',
  'window_close',
  'window_show_main',
  'window_open_devtools_all',
  'app_quit',
  'app_restart',
  'app_open_external',
  'app_auto_update',
  // OBS 서버 제어 (자기 자신 종료/재시작 방지)
  'obs_start',
  'obs_stop',
  // 파일 대화상자 / 파일 쓰기 (로컬 파일 시스템 접근)
  'image_load',
  'font_load',
  'sound_load',
  'sound_save_processed_wav',
  'css_load',
  'css_reset',
  'js_load',
  'js_reset',
  'js_reload',
  'preset_load',
  'preset_load_tab',
  // Tauri 플러그인 (네이티브 윈도우/메뉴/리소스)
  'plugin:window|',
  'plugin:menu|',
  'plugin:resources|',
];
let denyList: string[] = DEFAULT_DENY_LIST;

// 콜백 레지스트리 (transformCallback/runCallback)
const callbacks = new Map<number, (data: unknown) => void>();

// 이벤트 리스너 레지스트리 (plugin:event|listen)
// eventId → { event, handlerId }
const eventListeners = new Map<number, { event: string; handlerId: number }>();
// event → Set<eventId>
const eventListenersByName = new Map<string, Set<number>>();

let nextEventId = 1;
let seqCounter = 0;

// WS RPC 대기 중인 요청
const pendingRpc = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>();

// ── [과도기] 캐시 — 백엔드 WS RPC 구현 후 제거 예정 ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let snapshotCache: (BootstrapPayload & Record<string, any>) | null = null;

/**
 * [과도기] 백엔드 WS RPC가 없는 동안 snapshot 캐시에서 응답.
 * §12.11 백엔드 구현 후 이 함수와 snapshotCache를 제거.
 */
function handleCacheCommand(
  cmd: string,
  _args: Record<string, unknown>,
): unknown | undefined {
  if (!snapshotCache) return undefined;

  switch (cmd) {
    case 'app_bootstrap':
      return snapshotCache;
    case 'settings_get':
      return snapshotCache.settings;
    case 'keys_get':
      return snapshotCache.keys;
    case 'positions_get':
      return snapshotCache.positions;
    case 'stat_positions_get':
      return snapshotCache.statPositions;
    case 'graph_positions_get':
      return snapshotCache.graphPositions;
    case 'custom_tabs_list':
      return snapshotCache.customTabs;
    case 'layer_groups_get':
      return snapshotCache.layerGroups ?? {};
    case 'note_tab_get_all':
      return snapshotCache.tabNoteOverrides ?? {};
    case 'css_get':
      return snapshotCache.settings?.customCSS ?? { content: '', path: null };
    case 'css_get_use':
      return snapshotCache.settings?.useCustomCSS ?? false;
    case 'css_tab_get_all':
      return snapshotCache.tabCssOverrides ?? {};
    case 'js_get':
      return (
        snapshotCache.settings?.customJS ?? {
          content: '',
          path: null,
          plugins: [],
        }
      );
    case 'js_get_use':
      return snapshotCache.settings?.useCustomJS ?? false;
    default:
      return undefined;
  }
}

// ── deny 체크 ──

/** "|"로 끝나면 prefix 매칭, 아니면 exact 매칭 */
function isDenied(cmd: string): boolean {
  return denyList.some((entry) =>
    entry.endsWith('|') ? cmd.startsWith(entry) : cmd === entry,
  );
}

// ── 콜백 관리 (transformCallback / runCallback) ──

function registerCallback(
  callback?: (data: unknown) => void,
  once = false,
): number {
  const id = crypto.getRandomValues(new Uint32Array(1))[0];
  callbacks.set(id, (data: unknown) => {
    if (once) {
      callbacks.delete(id);
    }
    callback?.(data);
  });
  return id;
}

function unregisterCallback(id: number) {
  callbacks.delete(id);
}

function runCallback(id: number, data: unknown) {
  const callback = callbacks.get(id);
  if (callback) {
    callback(data);
  }
}

// ── 이벤트 시스템 (plugin:event|listen/unlisten) ──

function handleEventListen(args: Record<string, unknown>): number {
  const event = args.event as string;
  const handlerId = args.handler as number;
  const eventId = nextEventId++;

  eventListeners.set(eventId, { event, handlerId });

  if (!eventListenersByName.has(event)) {
    eventListenersByName.set(event, new Set());
  }
  eventListenersByName.get(event)!.add(eventId);

  return eventId;
}

function handleEventUnlisten(args: Record<string, unknown>) {
  const event = args.event as string;
  const eventId = args.eventId as number;

  const entry = eventListeners.get(eventId);
  if (entry) {
    unregisterCallback(entry.handlerId);
    eventListeners.delete(eventId);
  }

  const nameSet = eventListenersByName.get(event);
  if (nameSet) {
    nameSet.delete(eventId);
    if (nameSet.size === 0) {
      eventListenersByName.delete(event);
    }
  }
}

function handleEventEmit(args: Record<string, unknown>) {
  const event = args.event as string;
  const payload = args.payload;
  dispatchEvent(event, payload);
}

/** 내부: 등록된 모든 리스너에게 이벤트 디스패치 */
function dispatchEvent(event: string, payload: unknown) {
  const listenerIds = eventListenersByName.get(event);
  if (!listenerIds) return;

  for (const eventId of listenerIds) {
    const entry = eventListeners.get(eventId);
    if (entry) {
      runCallback(entry.handlerId, {
        event,
        id: eventId,
        payload,
      });
    }
  }
}

// ── WS 메시지 수신 → Tauri 이벤트 디스패치 ──

function onWsMessage(envelope: ObsEnvelope) {
  switch (envelope.type) {
    // 범용 이벤트 포워딩 (§12.12)
    case 'tauri_event': {
      const { event, data } = envelope.payload as {
        event: string;
        data: unknown;
      };
      dispatchEvent(event, data);
      break;
    }

    // WS RPC 응답
    case 'invoke_response': {
      const resp = envelope.payload as {
        requestId: string;
        result?: unknown;
        error?: string;
      };
      const pending = pendingRpc.get(resp.requestId);
      if (pending) {
        pendingRpc.delete(resp.requestId);
        if (resp.error) {
          pending.reject(new Error(resp.error));
        } else {
          pending.resolve(resp.result);
        }
      }
      break;
    }

    // [과도기] 기존 WS 메시지 → Tauri 이벤트 매핑
    // 백엔드가 tauri_event로 통합하면 아래 case들 제거
    case 'key_event':
      dispatchEvent('keys:state', envelope.payload);
      break;

    case 'settings_diff': {
      const patch = envelope.payload as Record<string, unknown>;
      dispatchEvent('settings:changed', { changed: patch });
      if (snapshotCache) {
        Object.assign(snapshotCache.settings, patch);
      }
      break;
    }

    case 'counter_update': {
      const counters = envelope.payload as Record<
        string,
        Record<string, number>
      >;
      dispatchEvent('keys:counters', counters);
      if (snapshotCache) {
        snapshotCache.keyCounters = counters;
      }
      break;
    }

    case 'snapshot': {
      const snapshot = envelope.payload as BootstrapPayload;
      const prev = snapshotCache;
      snapshotCache = snapshot;

      // 개별 이벤트 디스패치 (useAppBootstrap이 구독)
      dispatchEvent('keys:changed', snapshot.keys);
      dispatchEvent('positions:changed', snapshot.positions);
      dispatchEvent('statPositions:changed', snapshot.statPositions);
      dispatchEvent('graphPositions:changed', snapshot.graphPositions);
      dispatchEvent('keys:mode-changed', {
        mode: snapshot.selectedKeyType,
      });
      dispatchEvent('keys:counters', snapshot.keyCounters);

      dispatchEvent('customTabs:changed', {
        customTabs: snapshot.customTabs,
        selectedKeyType: snapshot.selectedKeyType,
      });

      dispatchEvent('tabNote:changed_all', snapshot.tabNoteOverrides ?? {});

      dispatchEvent('layerGroups:changed', snapshot.layerGroups ?? {});

      // preset:snapshot (프리셋 로드 시)
      if (prev) {
        dispatchEvent('preset:snapshot', {
          keys: snapshot.keys,
          positions: snapshot.positions,
          statPositions: snapshot.statPositions,
          graphPositions: snapshot.graphPositions,
          customTabs: snapshot.customTabs,
          selectedKeyType: snapshot.selectedKeyType,
          tabNoteOverrides: snapshot.tabNoteOverrides ?? {},
        });
      }

      if (snapshot.settings) {
        dispatchEvent('settings:changed', {
          changed: snapshot.settings,
        });
      }
      break;
    }
  }
}

// ── WS 전송 ──

function sendWsMessage(type: string, payload: unknown = null) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const envelope: ObsEnvelope = {
    v: OBS_PROTOCOL_VERSION,
    type,
    seq: seqCounter++,
    ts: Date.now(),
    payload,
  };
  ws.send(JSON.stringify(envelope));
}

// ── invoke 핸들러 ──

async function shimInvoke(
  cmd: string,
  args: Record<string, unknown> = {},
  _options?: unknown,
): Promise<unknown> {
  // 1. 이벤트 플러그인 커맨드 (프론트엔드 로컬)
  if (cmd === 'plugin:event|listen') {
    return handleEventListen(args);
  }
  if (cmd === 'plugin:event|unlisten') {
    handleEventUnlisten(args);
    return;
  }
  if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
    handleEventEmit(args);
    return;
  }

  // 2. deny 체크 (hello_ack에서 수신한 리스트)
  if (isDenied(cmd)) {
    return;
  }

  // 3-a. [과도기] 캐시 폴백 — 백엔드 WS RPC 구현 후 제거
  const cached = handleCacheCommand(cmd, args);
  if (cached !== undefined) {
    return cached;
  }

  // 3-b. WS RPC (백엔드가 처리)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`[IPC Shim] WS not connected: ${cmd}`));
  }

  const requestId = `rpc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    pendingRpc.set(requestId, { resolve, reject });
    sendWsMessage('invoke_request', { requestId, command: cmd, args });

    // 타임아웃 10초
    setTimeout(() => {
      if (pendingRpc.has(requestId)) {
        pendingRpc.delete(requestId);
        reject(new Error(`[IPC Shim] RPC timeout: ${cmd}`));
      }
    }, 10000);
  });
}

// ── convertFileSrc shim ──

function shimConvertFileSrc(filePath: string, _protocol = 'asset'): string {
  // OBS HTTP 서버의 /media/ 엔드포인트로 변환
  // 백엔드가 base64url(no-pad)을 기대하므로 표준 base64 → base64url 변환
  const bytes = new TextEncoder().encode(filePath);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const encoded = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const tokenParam = connToken ? `?token=${connToken}` : '';
  return `http://${connHost}:${connPort}/media/${encoded}${tokenParam}`;
}

// ── 공개 API ──

/**
 * IPC shim 초기화. WS 연결 → hello_ack(denyList 수신) → snapshot 수신 → 글로벌 설치.
 * 반드시 dmnoteApi import 전에 호출.
 */
export function initIpcShim(wsUrl: string, token: string): Promise<void> {
  disposed = false;

  // 연결 정보 파싱 (convertFileSrc에서 사용)
  try {
    const url = new URL(wsUrl);
    connHost = url.hostname || '127.0.0.1';
    connPort = url.port || '34891';
  } catch {
    connHost = '127.0.0.1';
    connPort = '34891';
  }
  connToken = token;

  return new Promise((resolve, reject) => {
    let resolved = false;

    const connect = () => {
      if (disposed) return;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        sendWsMessage('hello', {
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
          return;
        }

        if (envelope.type === 'hello_ack') {
          // deny 리스트 수신 (없으면 기본값 유지)
          const payload = envelope.payload as HelloAckPayload;
          if (payload.denyList) {
            denyList = payload.denyList;
          }
          return;
        }

        if (envelope.type === 'ping') {
          sendWsMessage('pong');
          return;
        }

        if (envelope.type === 'error') {
          const payload = envelope.payload as Record<string, unknown>;
          if (payload?.code === 'AUTH_FAILED') {
            disposed = true;
            if (!resolved) {
              resolved = true;
              reject(new Error('OBS auth failed'));
            }
          }
          return;
        }

        // snapshot 수신 시 글로벌 설치 후 resolve
        if (envelope.type === 'snapshot' && !resolved) {
          snapshotCache = envelope.payload as BootstrapPayload;
          installGlobals();
          resolved = true;
          resolve();
          return;
        }

        // 이후 메시지는 이벤트로 디스패치
        onWsMessage(envelope);
      };

      ws.onclose = () => {
        ws = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose에서 처리
      };
    };

    // 초기 연결 타임아웃 15초
    const initTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('[IPC Shim] Connection timeout'));
      }
    }, 15000);

    const originalResolve = resolve;
    resolve = (value) => {
      clearTimeout(initTimeout);
      originalResolve(value);
    };

    connect();
  });
}

/** 글로벌 객체에 shim 설치 */
function installGlobals() {
  // __TAURI_INTERNALS__
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__ = {
    invoke: shimInvoke,
    transformCallback: registerCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc: shimConvertFileSrc,
    metadata: {
      currentWindow: { label: 'obs-overlay' },
      currentWebview: { windowLabel: 'obs-overlay', label: 'obs-overlay' },
    },
  };

  // __TAURI_EVENT_PLUGIN_INTERNALS__
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event: string, eventId: number) => {
      handleEventUnlisten({ event, eventId });
    },
  };

  // isTauri 플래그 (isTauri() 함수가 참조)
  (globalThis as Record<string, unknown>).isTauri = true;
}

/** shim 해제 */
export function disposeIpcShim() {
  disposed = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  // 대기 중인 RPC 전부 reject
  for (const [id, pending] of pendingRpc) {
    pending.reject(new Error('[IPC Shim] Disposed'));
    pendingRpc.delete(id);
  }

  callbacks.clear();
  eventListeners.clear();
  eventListenersByName.clear();
  denyList = DEFAULT_DENY_LIST;
  snapshotCache = null;
}
