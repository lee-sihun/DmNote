import { create } from 'zustand';
import { windowApi } from '@api/modules/appApi';
import {
  remoteSheetApi,
  type RemoteSheetRequest,
  type RemoteSheetResult,
  type RemoteSheetSpec,
} from '@api/modules/remoteSheetApi';

// 메인이 요청을 받았다는 수락이 이 안에 안 오면 실패로 접는다. emitTo는 상대 창에
// 리스너가 없으면 조용히 버려지므로, 이게 없으면 패널이 영영 잠긴 채로 남는다
const ACCEPT_TIMEOUT_MS = 3000;

interface RemoteSheetState {
  // 메인 창에서 열려 있는(또는 열리길 기다리는) 시트. 있으면 패널은 잠긴다
  active: RemoteSheetRequest | null;
  setActive: (active: RemoteSheetRequest | null) => void;
}

export const useRemoteSheetStore = create<RemoteSheetState>((set) => ({
  active: null,
  setActive: (active) => set({ active }),
}));

export const isRemoteSheetActive = () =>
  useRemoteSheetStore.getState().active !== null;

interface PendingRequest {
  requestId: string;
  accepted: boolean;
  acceptTimer: number;
  resolve: (result: RemoteSheetResult) => void;
}

// 창당 하나. 잠금 중에는 새 요청을 받지 않으므로 큐가 필요 없다
let pending: PendingRequest | null = null;
let notifyFailed: (() => void) | null = null;

const settle = (result: RemoteSheetResult) => {
  if (!pending || pending.requestId !== result.requestId) return;
  const current = pending;
  pending = null;
  window.clearTimeout(current.acceptTimer);
  useRemoteSheetStore.getState().setActive(null);
  current.resolve(result);
};

// 메인에 닿지 못한 경우만 여기서 알린다. 메인 쪽 실패는 메인이 이미 안내했다
const failLocally = (requestId: string) => {
  settle({ requestId, status: 'failed' });
  notifyFailed?.();
};

/**
 * 메인 창에 시트를 열어 달라고 요청하고 닫힐 때까지 기다린다.
 * 요청 중에는 패널이 잠기므로 이미 하나가 떠 있으면 새 요청은 곧바로 취소로 끝난다.
 * 메인이 수락하지 않으면 실패, 메인 호스트가 새로 마운트되면 취소로 정리된다
 */
export const openRemoteSheet = (
  spec: RemoteSheetSpec,
): Promise<RemoteSheetResult> => {
  const requestId = crypto.randomUUID();
  if (pending) return Promise.resolve({ requestId, status: 'cancelled' });
  const request: RemoteSheetRequest = { requestId, ...spec };
  return new Promise((resolve) => {
    pending = {
      requestId,
      accepted: false,
      acceptTimer: window.setTimeout(() => {
        if (pending?.requestId === requestId && !pending.accepted) {
          failLocally(requestId);
        }
      }, ACCEPT_TIMEOUT_MS),
      resolve,
    };
    useRemoteSheetStore.getState().setActive(request);
    void (async () => {
      // 메인이 숨겨져 있거나 뒤에 있으면 앞으로 가져온다. 실패해도 요청은 보낸다 -
      // 수락 여부는 타임아웃이 판정한다
      try {
        await windowApi.showMain();
      } catch (error) {
        console.error('Failed to bring main window forward', error);
      }
      // 메인을 앞으로 가져오는 사이 타임아웃이 잠금을 풀었다면 요청을 내보내지 않는다.
      // 보내면 풀린 패널과 메인 시트가 동시에 편집을 받는다
      if (pending?.requestId !== requestId) return;
      try {
        await remoteSheetApi.request(request);
      } catch (error) {
        console.error('Failed to request remote sheet', error);
        failLocally(requestId);
      }
    })();
  });
};

/**
 * 메인이 보내는 수락·닫힘·호스트 재시작 신호를 받는다. 패널 App이 마운트에서 한 번 건다.
 * onFailed는 메인이 요청을 받지 못했을 때 사용자에게 알리는 훅
 */
export const listenRemoteSheetHost = (onFailed: () => void): (() => void) => {
  notifyFailed = onFailed;
  const offAccepted = remoteSheetApi.onAccepted(({ requestId }) => {
    if (!pending || pending.requestId !== requestId) return;
    pending.accepted = true;
    window.clearTimeout(pending.acceptTimer);
  });
  const offClosed = remoteSheetApi.onClosed(settle);
  const offHostReady = remoteSheetApi.onHostReady(() => {
    if (pending) settle({ requestId: pending.requestId, status: 'cancelled' });
  });
  return () => {
    notifyFailed = null;
    offAccepted();
    offClosed();
    offHostReady();
  };
};

// 테스트 격리용
export const resetRemoteSheetForTests = () => {
  if (pending) window.clearTimeout(pending.acceptTimer);
  pending = null;
  notifyFailed = null;
  useRemoteSheetStore.setState({ active: null });
};
