import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import {
  remoteSheetApi,
  type CounterAnimationSavedPayload,
  type RemoteSheetRequest,
  type RemoteSheetResult,
} from '@api/modules/remoteSheetApi';
import { panelWindowApi } from '@api/modules/selectionSessionApi';
import { usePanelWindowStore } from '@stores/grid/usePanelWindowStore';
import WebFontEditorSheet from './content/pickers/WebFontEditorSheet';
import { preloadWebFontEditor } from './content/pickers/webFontEditorLoader';
import CounterAnimationEditorModal from './content/editors/CounterAnimationEditorModal';
import SoundTrimModal from './content/managers/SoundTrimModal';
import { soundTrimEditProps } from './content/managers/soundTrimEditProps';

// 패널 창이 이미 사라졌으면 emitTo가 거부한다. 결과를 받을 상대가 없을 뿐이니 삼킨다
const sendToPanel = (send: () => Promise<void>) => {
  send().catch(() => {});
};

/**
 * 분리 패널이 요청한 전면 시트를 메인 창에서 대신 띄운다.
 * 시트 자체는 도킹 경로와 같은 컴포넌트를 쓰고, 저장 결과만 패널에 돌려준다
 */
const RemoteSheetHost = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState<RemoteSheetRequest | null>(null);
  // 구독 effect가 최신 요청을 보려고 쓴다. 렌더 중 쓰지 않고 커밋 뒤 맞춘다
  const activeRef = useRef<RemoteSheetRequest | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  // 시트는 저장 뒤 onClose를 따로 부른다. 결과는 한 번만 보내야 하므로 끝낸 요청을 기억한다
  const finishedRequestIdRef = useRef<string | null>(null);
  // 모션 편집 시트는 저장 결과를 onSaved로 먼저 주므로 붙잡았다가 닫힘에서 보낸다
  const counterSavedRef = useRef<CounterAnimationSavedPayload | null>(null);
  const panelDetached = usePanelWindowStore(
    (state) => state.status === 'detached',
  );

  const finish = (result: RemoteSheetResult) => {
    if (finishedRequestIdRef.current === result.requestId) return;
    finishedRequestIdRef.current = result.requestId;
    setActive(null);
    counterSavedRef.current = null;
    sendToPanel(() => remoteSheetApi.close(result));
  };

  useEffect(() => {
    const offRequest = remoteSheetApi.onRequest((request) => {
      // 새 요청이 오면 이전 시트는 취소로 정리하고 교체한다
      const previous = activeRef.current;
      if (previous && previous.requestId !== request.requestId) {
        // 언마운트되는 이전 시트가 onClose를 불러도 새 시트를 내리지 못하게 먼저 끝낸 것으로 표시
        finishedRequestIdRef.current = previous.requestId;
        sendToPanel(() =>
          remoteSheetApi.close({
            requestId: previous.requestId,
            status: 'cancelled',
          }),
        );
      }
      counterSavedRef.current = null;
      setActive(request);
      sendToPanel(() => remoteSheetApi.accept(request.requestId));
    });
    // 패널 창이 사라지면 결과를 받을 곳이 없다 - 시트를 내린다
    const offVisibility = panelWindowApi.onVisibility(({ visible }) => {
      if (!visible) setActive(null);
    });
    // 이 호스트가 새로 떴다는 신호. 패널이 이전 요청을 기다리고 있었다면 정리한다
    sendToPanel(() => remoteSheetApi.announceHostReady());
    return () => {
      offRequest();
      offVisibility();
    };
  }, []);

  // 패널이 분리돼 있으면 웹폰트 편집기 청크를 미리 당겨 둔다. 첫 요청에 빈 시트가 비치지 않게
  useEffect(() => {
    if (panelDetached) preloadWebFontEditor();
  }, [panelDetached]);

  if (!active) return null;
  const { requestId } = active;

  switch (active.kind) {
    case 'webFont':
      return (
        <WebFontEditorSheet
          editingId={active.editingId}
          onDone={(outcome) =>
            finish(
              outcome === 'saved'
                ? { requestId, status: 'saved', kind: 'webFont' }
                : { requestId, status: outcome },
            )
          }
        />
      );
    case 'counterAnimation':
      return (
        <CounterAnimationEditorModal
          isOpen
          mode={active.mode}
          initialPreset={active.preset}
          counterSettings={active.counterSettings}
          keyVisual={active.keyVisual}
          onSaved={(payload) => {
            counterSavedRef.current = payload;
          }}
          onClose={() => {
            const saved = counterSavedRef.current;
            finish(
              saved
                ? {
                    requestId,
                    status: 'saved',
                    kind: 'counterAnimation',
                    payload: saved,
                  }
                : { requestId, status: 'cancelled' },
            );
          }}
          t={t}
        />
      );
    case 'soundTrim':
      return (
        <SoundTrimModal
          isOpen
          previewVolume={active.previewVolume}
          {...soundTrimEditProps(active.mode === 'edit' ? active.item : null)}
          // 파일은 창을 넘지 못한다. 시트 안의 불러오기 버튼으로 고른다
          initialFile={null}
          onSaved={(soundPath) =>
            finish({ requestId, status: 'saved', kind: 'soundTrim', soundPath })
          }
          onClose={() => finish({ requestId, status: 'cancelled' })}
        />
      );
  }
};

export default RemoteSheetHost;
