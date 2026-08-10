import { useEffect, useState } from 'react';

import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { useCustomCssInjection } from '@hooks/app/useCustomCssInjection';
import { useHistoryShortcuts } from '@hooks/Grid/useHistoryShortcuts';
import { isMac } from '@utils/core/platform';
import { usePluginPanelModelMirror } from '@hooks/app/usePluginPanelModelMirror';
import { useKeyManager } from '@hooks/useKeyManager';
import PropertiesPanel from '@components/main/Grid/PropertiesPanel';
import PanelDialogHost from './PanelDialogHost';
import { panelWindowApi } from '@api/modules/selectionSessionApi';
import { reattachPropertiesPanel } from '@stores/grid/usePanelWindowStore';
import { initPluginSettingsMirror } from '@plugins/rpc/pluginSettingsMirror';
import { startPluginRpcClient } from '@plugins/rpc/pluginRpcClient';
import { onSelectionSyncReady } from '@src/renderer/editor/runtime/selectionSync';
import { flushFocusedEditor } from '@src/renderer/editor/runtime/lifecycleEditorFlush';
import { applyPanelViewState } from '@stores/grid/panelViewHandoff';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';

import type { PanelViewState } from '@api/modules/selectionSessionApi';

// 인터랙티브 요소 위에서는 창 드래그를 시작하지 않음
const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a, [role="switch"], [role="listbox"], [contenteditable="true"]';

// 분리 패널 창 호스트
// 편집 경로는 메인과 동일 (coordinator 커밋 + 프리뷰 채널 + 백엔드 undo)라 창 위치와 무관하게 동작
interface AppProps {
  initialViewState: PanelViewState | null;
}

const App = ({ initialViewState }: AppProps) => {
  useAppBootstrap();
  useCustomCssInjection();
  // Cmd+R/F5 등 브라우저 기본 단축키 차단 - 문서 reload는 뷰 상태를 잃음
  useBlockBrowserShortcuts({ allowCloseKeyPropagation: true });
  // main이 push하는 플러그인 read-model 미러 수신
  usePluginPanelModelMirror();

  // authority-changed를 첫 요청 전에 수신하도록 eager 구독
  useEffect(() => startPluginRpcClient(), []);
  // main 소유 설정 세션의 descriptor 미러 - 입력은 RPC로 왕복
  useEffect(() => initPluginSettingsMirror(), []);

  // 이 창이 포커스를 잃으면 편집을 지금 대상에 확정한다.
  //
  // 메인 창을 클릭해도 이 창의 입력은 커서를 놓지 않는다. 그 뒤 선택만 메인에서
  // 넘어오면 콜백은 새 대상을 가리키는데 draft는 옛 대상 것이라, 다음 blur가
  // 옛 값을 새 대상에 저장한다.
  // 창 blur는 로컬 이벤트고 선택 반영은 백엔드 왕복이라 정산이 항상 먼저 도착한다.
  // 메인 창에는 걸지 않는다 - alt-tab만 해도 편집 중인 입력이 풀린다
  useEffect(() => {
    const settle = () => {
      void flushFocusedEditor();
    };
    window.addEventListener('blur', settle);
    return () => window.removeEventListener('blur', settle);
  }, []);
  useEffect(
    () =>
      panelWindowApi.onPropertyModeRequested(() => {
        usePropertiesPanelStore.getState().setCanvasPanelMode('property');
      }),
    [],
  );

  // 초기 선택 동기화 전에는 본문을 숨김 - 빈 선택의 레이어 뷰가
  // 한 프레임 그려졌다가 속성 뷰로 바뀌는 깜빡임 방지
  const [showPanel, setShowPanel] = useState(false);
  const [selectionSyncReady, setSelectionSyncReady] = useState(false);

  // 선택 동기화가 초기 store를 정산한 뒤 뷰 상태 적용
  useEffect(() => {
    let viewApplied = false;
    const applyInitialView = () => {
      if (viewApplied || !initialViewState) return;
      viewApplied = true;
      applyPanelViewState(initialViewState);
    };
    const unsubscribe = onSelectionSyncReady(() => {
      applyInitialView();
      setSelectionSyncReady(true);
      setShowPanel(true);
    });
    // 동기화 지연·실패 시에도 패널이 영영 숨겨지지 않게 상한
    const fallback = setTimeout(() => {
      applyInitialView();
      setShowPanel(true);
    }, 600);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [initialViewState]);
  const {
    handlePositionChange,
    handleKeyStyleUpdate,
    handleKeyBatchStyleUpdate,
    handleKeyPreview,
    handleKeyBatchPreview,
    handleKeyMappingChange,
    handleUndo,
    handleRedo,
  } = useKeyManager();

  useHistoryShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
  });

  // X 버튼은 닫기가 아니라 재부착 - ack로 백엔드 fallback을 해제하고 게스처 커밋 후 창 반납
  useEffect(() => {
    const unsubscribe = panelWindowApi.onCloseRequested(({ requestId }) => {
      void panelWindowApi
        .ackClose(requestId)
        .catch(() => {})
        .then(() => reattachPropertiesPanel());
    });
    return unsubscribe;
  }, []);

  // 프레임리스라 네이티브 닫기 수단이 없음 - 창 닫기 단축키를 재부착으로 배선
  // 플랫폼 primary modifier만 인정(macOS Cmd, 그 외 Ctrl), 다른 수식키·반복 제외
  useEffect(() => {
    const primaryOnly = (event: KeyboardEvent) =>
      isMac()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (event.repeat || event.shiftKey || event.altKey) return;
      if (!primaryOnly(event)) return;
      if (event.key.toLowerCase() !== 'w') return;
      event.preventDefault();
      void reattachPropertiesPanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 프레임리스 창 이동: 패널 헤더의 빈 영역에서만 드래그 시작
  // 제목 span(더블클릭 이름 변경)·버튼 등 자식 요소 위에서는 시작하지 않음
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const isHeaderSelf = target.classList.contains('dmn-panel-header');
      const isHeaderRowGap =
        !isHeaderSelf &&
        target.parentElement?.classList.contains('dmn-panel-header') === true &&
        target.childElementCount === 0 &&
        target.textContent === '';
      if (!isHeaderSelf && !isHeaderRowGap) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      event.preventDefault();
      void panelWindowApi
        .startDragging(event.clientX, event.clientY)
        .catch(() => {});
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden rounded-[12px] bg-[rgb(14,14,17)]">
      <div
        className="absolute inset-0 transition-opacity duration-fast"
        style={{ opacity: showPanel ? 1 : 0 }}
      >
        {/* 초기 선택 동기화 전 마운트하면 빈 선택 구간에 "빈 선택→layer 정규화"
            effect가 발화해 핸드오프의 property 모드를 덮음 - 동기화 후 마운트 */}
        {showPanel && (
          <PropertiesPanel
            onPositionChange={handlePositionChange}
            onKeyUpdate={(data) => {
              const { index, ...updates } = data;
              handleKeyStyleUpdate(index, updates);
            }}
            onKeyBatchUpdate={handleKeyBatchStyleUpdate}
            onKeyPreview={handleKeyPreview}
            onKeyBatchPreview={handleKeyBatchPreview}
            onKeyMappingChange={handleKeyMappingChange}
            detachAction="reattach"
            onDetachAction={() => void reattachPropertiesPanel()}
            frameVariant="window"
            selectionSyncReady={selectionSyncReady}
          />
        )}
      </div>
      <PanelDialogHost />
      {/* 프레임리스 창 가장자리 링 - 메인 창의 네이티브 엣지에 대응하는 인셋 라인 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[12px] shadow-[inset_0_0_0_1px_var(--ui-line)] z-50"
      />
    </div>
  );
};

export default App;
