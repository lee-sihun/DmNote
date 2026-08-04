import { useEffect } from 'react';

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { notePluginMirrorRevision } from '@plugins/rpc/pluginElementActions';
import { setPluginAuthorityGeneration } from '@plugins/rpc/pluginRpcClient';
import { pluginRpcApi } from '@api/modules/pluginRpcApi';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import {
  PANEL_MODEL_REQUEST_MESSAGE,
  PANEL_MODEL_SYNC_MESSAGE,
} from '@utils/plugin/panelModelSync';
import type { PluginPanelModelSnapshot } from '@src/types/plugin/api';

export interface PanelModelCursor {
  authorityGeneration: number;
  pushSeq: number;
}

export const advancePanelModelCursor = (
  current: PanelModelCursor,
  authorityGeneration: number,
  pushSeq: number,
): PanelModelCursor | null => {
  if (
    !Number.isSafeInteger(authorityGeneration) ||
    authorityGeneration < 0 ||
    !Number.isSafeInteger(pushSeq) ||
    pushSeq < 0 ||
    authorityGeneration < current.authorityGeneration ||
    (authorityGeneration === current.authorityGeneration &&
      pushSeq <= current.pushSeq)
  ) {
    return null;
  }
  return { authorityGeneration, pushSeq };
};

// main renderer 재시작 시 generation이 전진하므로 낮아진 pushSeq도 새 세대에서 허용
let appliedCursor: PanelModelCursor = {
  authorityGeneration: 0,
  pushSeq: 0,
};

// 분리 패널에서 main이 push하는 플러그인 read-model 스냅샷 수신
// 패널은 플러그인 런타임을 실행하지 않으므로 스토어는 읽기 미러로만 사용
export function usePluginPanelModelMirror() {
  useEffect(() => {
    const unsubscribe = window.api.bridge.on<PluginPanelModelSnapshot>(
      PANEL_MODEL_SYNC_MESSAGE,
      (data) => {
        if (
          !data ||
          typeof data.modelRevision !== 'number' ||
          !Array.isArray(data.elements) ||
          !Array.isArray(data.definitions)
        ) {
          return;
        }
        const nextCursor = advancePanelModelCursor(
          appliedCursor,
          data.authorityGeneration,
          data.pushSeq,
        );
        if (!nextCursor) return;
        appliedCursor = nextCursor;
        notePluginMirrorRevision(data.modelRevision);
        setPluginAuthorityGeneration(data.authorityGeneration);
        usePluginDisplayElementStore
          .getState()
          .applyPanelModel(
            data.elements,
            data.definitions,
            data.elementVisibility ?? {},
          );
      },
    );

    // authority 교체(runtime 재주입) 시 미러를 전체 스냅샷으로 재구성 (C2)
    const unsubscribeAuthority = pluginRpcApi.onAuthorityChanged(
      ({ authorityGeneration, modelRevision }) => {
        setPluginAuthorityGeneration(authorityGeneration);
        if (
          Number.isSafeInteger(authorityGeneration) &&
          authorityGeneration > appliedCursor.authorityGeneration
        ) {
          appliedCursor = { authorityGeneration, pushSeq: 0 };
        }
        if (typeof modelRevision === 'number') {
          notePluginMirrorRevision(modelRevision);
        }
        sendBridgeMessageBestEffort('main', PANEL_MODEL_REQUEST_MESSAGE, {});
      },
    );

    // 구독 직후 최신 전체 스냅샷 요청 - 창 생성 전 push 유실 복구
    sendBridgeMessageBestEffort('main', PANEL_MODEL_REQUEST_MESSAGE, {});

    return () => {
      unsubscribe();
      unsubscribeAuthority?.();
    };
  }, []);
}
