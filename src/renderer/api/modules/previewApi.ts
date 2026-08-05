import { Channel, invoke } from '@tauri-apps/api/core';

import type {
  PreviewEnvelope,
  PreviewPublishRequest,
} from '@src/types/preview';

// OBS 브라우저 소스는 프리뷰 채널 미지원 (읽기 전용 + Tauri Channel 불가)
const isPreviewCapableRuntime = () =>
  typeof window !== 'undefined' && window.__dmn_runtime !== 'obs';

export const previewApi = {
  /**
   * 프리뷰 수신 채널 등록
   * 반환값은 브로커 registration generation, 재구독 시 이전 채널은 교체됨
   */
  subscribe: async (
    onEnvelope: (envelope: PreviewEnvelope) => void,
  ): Promise<number | null> => {
    if (!isPreviewCapableRuntime()) return null;
    const channel = new Channel<PreviewEnvelope>();
    channel.onmessage = onEnvelope;
    return invoke<number>('editor_preview_subscribe', { channel });
  },

  publish: (request: PreviewPublishRequest) =>
    invoke<void>('editor_preview_publish', { request }),

  cancel: (sessionId: string) =>
    invoke<void>('editor_preview_cancel', { sessionId }),
};
