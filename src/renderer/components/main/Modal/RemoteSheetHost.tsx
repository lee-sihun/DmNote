import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import RenderErrorBoundary from '@components/main/common/RenderErrorBoundary';
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

// 패널 창이 없으면 emitTo는 조용히 버린다. 거부는 직렬화 같은 예외 상황뿐이라 삼킨다
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
  // 구독 핸들러가 최신 요청을 보려고 쓴다. 이벤트 두 개가 같은 틱에 잇달아 오면 커밋 전이라
  // state로는 못 보므로 렌더 밖(핸들러)에서 state와 함께 동기로 맞춘다
  const activeRef = useRef<RemoteSheetRequest | null>(null);
  const setActiveRequest = (next: RemoteSheetRequest | null) => {
    activeRef.current = next;
    setActive(next);
  };
  // 모션 편집 시트는 저장 결과를 onSaved로 먼저 주므로 붙잡았다가 닫힘에서 보낸다
  const counterSavedRef = useRef<CounterAnimationSavedPayload | null>(null);
  const panelDetached = usePanelWindowStore(
    (state) => state.status === 'detached',
  );

  // 지금 떠 있는 요청의 결과만 인정한다. 시트는 저장 뒤 onClose를 따로 부르고, 내려간 시트의
  // 비동기 저장 완료 콜백이 한참 뒤에 올 수도 있다 - 첫 결과가 active를 비우므로 둘 다 여기서 끊긴다
  const finish = (result: RemoteSheetResult) => {
    if (activeRef.current?.requestId !== result.requestId) return;
    setActiveRequest(null);
    counterSavedRef.current = null;
    sendToPanel(() => remoteSheetApi.close(result));
  };

  // 결과를 보내지 않고 시트만 내린다
  const dismissActive = () => {
    if (!activeRef.current) return;
    counterSavedRef.current = null;
    setActiveRequest(null);
  };

  useEffect(() => {
    const offRequest = remoteSheetApi.onRequest((request) => {
      // 새 요청이 오면 이전 시트는 취소로 정리하고 교체한다
      const previous = activeRef.current;
      if (previous && previous.requestId !== request.requestId) {
        dismissActive();
        sendToPanel(() =>
          remoteSheetApi.close({
            requestId: previous.requestId,
            status: 'cancelled',
          }),
        );
      }
      counterSavedRef.current = null;
      setActiveRequest(request);
      sendToPanel(() => remoteSheetApi.accept(request.requestId));
    });
    // 패널이 기다리기를 그만뒀다(수락 지연·전송 실패) - 늦게 뜬 시트를 내려 두 창 동시 편집을 막는다
    const offAbort = remoteSheetApi.onAbort(({ requestId }) => {
      if (activeRef.current?.requestId === requestId) dismissActive();
    });
    // 패널 창이 사라지면 결과를 받을 곳이 없다 - 시트를 내린다
    const offVisibility = panelWindowApi.onVisibility(({ visible }) => {
      if (!visible) dismissActive();
    });
    // 이 호스트가 새로 떴다는 신호. 패널이 이전 요청을 기다리고 있었다면 정리한다
    sendToPanel(() => remoteSheetApi.announceHostReady());
    return () => {
      offRequest();
      offAbort();
      offVisibility();
    };
    // 헬퍼는 ref와 setState만 닫아 마운트마다 같다 - 구독은 한 번만 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 패널이 분리돼 있으면 웹폰트 편집기 청크를 미리 당겨 둔다. 첫 요청에 빈 시트가 비치지 않게
  useEffect(() => {
    if (panelDetached) preloadWebFontEditor();
  }, [panelDetached]);

  if (!active) return null;
  const { requestId } = active;

  const renderSheet = () => {
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
              finish({
                requestId,
                status: 'saved',
                kind: 'soundTrim',
                soundPath,
              })
            }
            onClose={() => finish({ requestId, status: 'cancelled' })}
          />
        );
    }
  };

  // 시트의 렌더 예외를 여기서 끊는다. 창 루트에 경계가 없어 그대로 두면 메인 창이 통째로 비고,
  // 호스트까지 사라져 패널이 풀리지 않는다. 요청마다 새로 마운트해 이전 실패가 남지 않게 한다
  return (
    <RenderErrorBoundary
      key={requestId}
      onError={(error) => {
        console.error('Remote sheet crashed', error);
        finish({ requestId, status: 'failed' });
      }}
    >
      {renderSheet()}
    </RenderErrorBoundary>
  );
};

export default RemoteSheetHost;
