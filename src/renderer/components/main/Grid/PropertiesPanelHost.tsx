import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import PropertiesPanel from '@components/main/Grid/PropertiesPanel';
import { PANEL_HEADER_HEIGHT } from '@components/main/Grid/PropertiesPanel/panelChrome';
import { PanelHostContext } from '@contexts/PanelHostContext';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { panelWindowApi } from '@api/modules/panelWindowApi';
import { flushFocusedEditor } from '@src/renderer/editor/runtime/lifecycleEditorFlush';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';
import {
  detachPropertiesPanel,
  dockPropertiesPanel,
  isTransitionFailure,
  usePanelHostStore,
} from '@stores/grid/usePanelHostStore';
import { isMac } from '@utils/core/platform';
import { readTokenColor } from '@utils/panelWindow/nativeChrome';
import { getPanelChildWindow } from '@utils/panelWindow/panelChildWindow';

import type { PanelHostValue } from '@contexts/PanelHostContext';

// 분리 창 루트 - 창 자체가 패널. 도킹 시엔 레이아웃에 끼어들지 않는 contents 박스로 바뀐다
// (같은 엘리먼트를 유지해야 PropertiesPanel 서브트리가 리마운트되지 않는다)
const DETACHED_ROOT_CLASS =
  'relative w-screen h-screen overflow-hidden rounded-[12px] bg-panel-detached';
const DOCKED_ROOT_CLASS = 'contents';

// 인터랙티브 요소 위에서는 창 드래그를 시작하지 않음
const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a, [role="switch"], [role="listbox"], [contenteditable="true"]';

interface PropertiesPanelHostProps {
  onKeyMappingChange?: (index: number, newKey: string) => void;
  // 분리/도킹 전환이 사용자에게 알릴 만한 이유로 실패했을 때
  onTransitionFailure?: (kind: 'detach' | 'dock') => void;
}

/**
 * 프로퍼티 패널 호스트.
 * 패널 React 서브트리는 하나뿐이고, React 밖에서 만든 호스트 엘리먼트에 portal로 그린다.
 * 분리는 그 호스트 엘리먼트를 자식 창 문서로 adoptNode해 옮기는 것 - 컨테이너가 같으므로
 * React는 리마운트하지 않고, 위임 리스너도 컨테이너에 붙어 있어 문서를 옮겨도 살아 있다
 */
const PropertiesPanelHost = ({
  onKeyMappingChange,
  onTransitionFailure,
}: PropertiesPanelHostProps) => {
  const placement = usePanelHostStore((state) => state.placement);
  const detached = placement === 'detached';
  const slotRef = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'contents';
    element.dataset.dmnPanelHost = '';
    return element;
  });
  // 자식 창은 detached일 때만 유효 - 배치가 바뀌면 다시 읽는다
  const child = detached ? getPanelChildWindow() : null;
  const childWindow = child?.window ?? null;

  // 호스트 엘리먼트 이동. 자식 창이 사라졌으면 도킹으로 되돌린다
  useLayoutEffect(() => {
    if (detached) {
      const target = getPanelChildWindow();
      if (!target) {
        usePanelHostStore.getState().setPlacement('docked');
        return;
      }
      if (host.parentNode !== target.document.body) {
        target.document.body.appendChild(target.document.adoptNode(host));
      }
      return;
    }
    const slot = slotRef.current;
    if (slot && host.parentNode !== slot) {
      slot.appendChild(document.adoptNode(host));
    }
  }, [detached, host]);

  const hostValue = useMemo<PanelHostValue>(
    () => ({
      placement,
      window: childWindow ?? window,
      document: childWindow?.document ?? document,
    }),
    [placement, childWindow],
  );

  const onTransitionFailureRef = useRef(onTransitionFailure);
  useEffect(() => {
    onTransitionFailureRef.current = onTransitionFailure;
  }, [onTransitionFailure]);

  const requestDetach = async () => {
    const outcome = await detachPropertiesPanel();
    if (isTransitionFailure(outcome))
      onTransitionFailureRef.current?.('detach');
  };
  const requestDock = async () => {
    const outcome = await dockPropertiesPanel();
    if (isTransitionFailure(outcome)) onTransitionFailureRef.current?.('dock');
  };

  // 자식 창: Cmd+R 등 브라우저 단축키 차단 - 문서 reload는 여기 그려둔 DOM을 통째로 잃는다
  useBlockBrowserShortcuts({
    target: childWindow,
    allowCloseKeyPropagation: true,
  });

  // 자식 창이 포커스를 잃으면 편집을 지금 대상에 확정한다 (메인 창에는 걸지 않는다 -
  // alt-tab만 해도 편집 중인 입력이 풀린다)
  useEffect(() => {
    if (!childWindow) return undefined;
    const settle = () => {
      void flushFocusedEditor();
    };
    childWindow.addEventListener('blur', settle);
    return () => childWindow.removeEventListener('blur', settle);
  }, [childWindow]);

  // 프레임리스라 네이티브 닫기 수단이 없음 - 창 닫기 단축키를 도킹으로 배선
  // 플랫폼 primary modifier만 인정(macOS Cmd, 그 외 Ctrl), 다른 수식키·반복 제외
  useEffect(() => {
    if (!childWindow) return undefined;
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
      void requestDock();
    };
    childWindow.addEventListener('keydown', handleKeyDown);
    return () => childWindow.removeEventListener('keydown', handleKeyDown);
  }, [childWindow]);

  // 프레임리스 창 이동: 패널 헤더의 빈 영역에서만 드래그 시작
  // 제목 span(더블클릭 이름 변경)·버튼 등 자식 요소 위에서는 시작하지 않음
  useEffect(() => {
    if (!childWindow) return undefined;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target || typeof target.closest !== 'function') return;
      const isHeaderSelf = target.classList.contains('dmn-panel-header');
      const isHeaderRowGap =
        !isHeaderSelf &&
        target.parentElement?.classList.contains('dmn-panel-header') === true &&
        target.childElementCount === 0 &&
        target.textContent === '';
      if (!isHeaderSelf && !isHeaderRowGap) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      if (event.clientY > PANEL_HEADER_HEIGHT) return;
      if (isHistoryEditorFlushLocked()) return;
      event.preventDefault();
      void panelWindowApi
        .startDragging(event.clientX, event.clientY)
        .catch(() => {});
    };
    childWindow.addEventListener('mousedown', handleMouseDown);
    return () => childWindow.removeEventListener('mousedown', handleMouseDown);
  }, [childWindow]);

  // 창 가장자리 표면을 네이티브 레이어에 위임 - 리사이즈 중 웹 페인트가 못 따라오는 구간을
  // 컴포지터가 같은 색으로 그린다. macOS는 적용을 전제하고 시작 - 첫 페인트에 CSS 링이
  // 한 프레임 겹쳐 진해지는 것 방지
  const [nativeChrome, setNativeChrome] = useState(() => isMac());
  useEffect(() => {
    if (!childWindow) return undefined;
    let sent = '';
    let scheduled = 0;
    const sync = () => {
      const fill = readTokenColor('--ui-bg-panel-detached');
      const line = readTokenColor('--ui-line');
      if (!fill || !line) {
        setNativeChrome(false);
        return;
      }
      const signature = `${fill.join()}|${line.join()}`;
      if (signature === sent) return;
      sent = signature;
      void panelWindowApi
        .applyNativeChrome(fill, line)
        .then((applied) => setNativeChrome(applied))
        .catch(() => setNativeChrome(false));
    };
    sync();
    // 커스텀 CSS가 토큰을 덮으면 네이티브 색도 따라가야 함 - 주입은 메인 head를 건드린다
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(sync);
    });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(scheduled);
    };
  }, [childWindow]);

  return (
    <>
      <div ref={slotRef} className="contents" data-dmn-panel-slot="" />
      {createPortal(
        <PanelHostContext.Provider value={hostValue}>
          <div className={detached ? DETACHED_ROOT_CLASS : DOCKED_ROOT_CLASS}>
            <PropertiesPanel
              onKeyMappingChange={onKeyMappingChange}
              detachAction={detached ? 'reattach' : 'detach'}
              onDetachAction={() =>
                void (detached ? requestDock() : requestDetach())
              }
              frameVariant={detached ? 'window' : 'inline'}
            />
            {/* 프레임리스 창 가장자리 링 - 메인 창의 네이티브 엣지에 대응하는 인셋 라인.
                네이티브 레이어가 같은 라인을 그리면 겹쳐서 진해지므로 그땐 생략 */}
            {detached && !nativeChrome && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[12px] shadow-[inset_0_0_0_1px_var(--ui-line)] z-50"
              />
            )}
          </div>
        </PanelHostContext.Provider>,
        host,
      )}
    </>
  );
};

export default PropertiesPanelHost;
