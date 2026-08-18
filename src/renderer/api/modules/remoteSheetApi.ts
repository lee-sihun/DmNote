import { emitTo } from '@tauri-apps/api/event';
import type { KeyCounterSettings } from '@src/types/key/keys';
import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';
import type { CounterAnimationKeyVisual } from '@utils/core/counterAnimationPreview';
import { subscribe } from './shared';

// 분리 패널이 메인 창에 전면 시트를 대신 띄워 달라고 요청하는 채널.
// 패널 창은 240px 고정이라 시트가 들어갈 자리가 없다. 요청은 패널→메인, 수락·닫힘은 메인→패널.
// 시트가 열려 있는 시간은 사용자에게 달렸으므로 타임아웃이 있는 RPC 대신 이벤트 쌍으로 잇는다

const MAIN_LABEL = 'main';
const PANEL_LABEL = 'panel';

const REQUEST_EVENT = 'panel-sheet:request';
const ACCEPTED_EVENT = 'panel-sheet:accepted';
const CLOSED_EVENT = 'panel-sheet:closed';
const HOST_READY_EVENT = 'panel-sheet:host-ready';

export interface WebFontSheetRequest {
  kind: 'webFont';
  // 편집할 웹폰트 id. null이면 새로 추가. 폰트 목록은 양쪽 창이 같은 설정을 보므로 id면 충분
  editingId: string | null;
}

export interface CounterAnimationSheetRequest {
  kind: 'counterAnimation';
  mode: 'create' | 'edit';
  preset: CounterAnimationPreset | null;
  counterSettings?: KeyCounterSettings;
  keyVisual?: CounterAnimationKeyVisual;
}

export interface SoundTrimEditItem {
  soundPath: string;
  trimStartRatio?: number;
  trimEndRatio?: number;
  displayName?: string;
}

export type SoundTrimSheetRequest = {
  kind: 'soundTrim';
  previewVolume?: number;
} & ({ mode: 'create' } | { mode: 'edit'; item: SoundTrimEditItem });

export type RemoteSheetSpec =
  | WebFontSheetRequest
  | CounterAnimationSheetRequest
  | SoundTrimSheetRequest;

export type RemoteSheetRequest = { requestId: string } & RemoteSheetSpec;

export interface CounterAnimationSavedPayload {
  preset: CounterAnimationPreset;
  mode: 'create' | 'edit';
  affectedUsageCount: number;
}

export type RemoteSheetResult = { requestId: string } & (
  | { status: 'cancelled' }
  | { status: 'failed' }
  | { status: 'saved'; kind: 'webFont' }
  | {
      status: 'saved';
      kind: 'counterAnimation';
      payload: CounterAnimationSavedPayload;
    }
  | { status: 'saved'; kind: 'soundTrim'; soundPath: string }
);

export const remoteSheetApi = {
  // 패널 → 메인
  request: (request: RemoteSheetRequest) =>
    emitTo(MAIN_LABEL, REQUEST_EVENT, request),
  onRequest: (listener: (request: RemoteSheetRequest) => void) =>
    subscribe<RemoteSheetRequest>(REQUEST_EVENT, listener),

  // 메인 → 패널. 패널 창이 이미 사라졌으면 emitTo가 거부하므로 호출부가 흡수한다
  accept: (requestId: string) =>
    emitTo(PANEL_LABEL, ACCEPTED_EVENT, { requestId }),
  onAccepted: (listener: (payload: { requestId: string }) => void) =>
    subscribe<{ requestId: string }>(ACCEPTED_EVENT, listener),
  close: (result: RemoteSheetResult) =>
    emitTo(PANEL_LABEL, CLOSED_EVENT, result),
  onClosed: (listener: (result: RemoteSheetResult) => void) =>
    subscribe<RemoteSheetResult>(CLOSED_EVENT, listener),
  // 호스트가 새로 마운트됐다 - 이전 시트는 이미 없으니 패널의 대기를 정리하라는 신호
  announceHostReady: () => emitTo(PANEL_LABEL, HOST_READY_EVENT, null),
  onHostReady: (listener: () => void) =>
    subscribe<null>(HOST_READY_EVENT, () => listener()),
};
