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

// 적용된 pushSeq - 순서 역전된 stale push 무시 (패널 창 수명 동안 단조)
let appliedPushSeq = 0;

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
        if (typeof data.pushSeq !== 'number' || data.pushSeq <= appliedPushSeq)
          return;
        appliedPushSeq = data.pushSeq;
        notePluginMirrorRevision(data.modelRevision);
        if (typeof data.authorityGeneration === 'number') {
          setPluginAuthorityGeneration(data.authorityGeneration);
        }
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
