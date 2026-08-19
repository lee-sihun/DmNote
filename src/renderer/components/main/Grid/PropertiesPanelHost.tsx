import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import PanelDragGhost from '@components/main/Grid/PanelDragGhost';
import PropertiesPanel from '@components/main/Grid/PropertiesPanel';
import { PanelHostContext } from '@contexts/PanelHostContext';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { usePanelHeaderDrag } from '@hooks/panel/usePanelHeaderDrag';
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
import {
  getPanelChildWindow,
  openPanelChildWindow,
} from '@utils/panelWindow/panelChildWindow';

import type { PanelHostValue } from '@contexts/PanelHostContext';

// 분리 창 루트 - 창 자체가 패널. 도킹 시엔 레이아웃에 끼어들지 않는 contents 박스로 바뀐다
// (같은 엘리먼트를 유지해야 PropertiesPanel 서브트리가 리마운트되지 않는다)
const DETACHED_ROOT_CLASS =
  'relative w-screen h-screen overflow-hidden rounded-[12px] bg-panel-detached';
const DOCKED_ROOT_CLASS = 'contents';

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
  const slotRef = useRef<HTMLDivElement | null>(null);
  // 도킹 자리(그리드 영역) - 헤더 드래그의 도크 존 기준
  const dockAreaRef = useRef<HTMLElement | null>(null);
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'contents';
    element.dataset.dmnPanelHost = '';
    return element;
  });
  // 자식 창은 detached일 때만 유효 - 배치가 바뀌면 다시 읽는다
  const child = detached ? getPanelChildWindow() : null;
  const childWindow = child?.window ?? null;

  // 슬롯 ref는 패널 서브트리의 layout effect보다 먼저 붙는다(형제 순서) -
  // 첫 마운트에서 패널이 문서 밖 호스트에서 실측되는 일이 없게 여기서 즉시 끼운다
  const attachSlot = (slot: HTMLDivElement | null) => {
    slotRef.current = slot;
    dockAreaRef.current = slot?.parentElement ?? null;
    if (slot && !detached && host.parentNode !== slot) {
      slot.appendChild(host);
    }
  };

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

  // 자식 창은 프로세스당 한 번 만든다 - 첫 tear-off가 드래그 도중 창 생성으로 끊기지 않게
  // 한가할 때 미리 만들어(숨김) 둔다. 실패해도 조용히 - 제스처 때 다시 시도한다
  useEffect(() => {
    if (getPanelChildWindow()) return undefined;
    const idle =
      window.requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => {
      void openPanelChildWindow().catch(() => {});
    });
    return () => cancel(handle);
  }, []);

  // 헤더 배경 드래그: 도킹 상태에선 고스트를 끌다 놓으면 분리, 분리 상태에선 창을 끌고
  // 메인의 도크 존에 놓으면 도킹. 리스너는 패널이 사는 문서에 건다
  const { ghost, dockHint } = usePanelHeaderDrag({
    hostDocument: hostValue.document,
    hostWindow: hostValue.window,
    dockAreaRef,
  });

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
      <div ref={attachSlot} className="contents" data-dmn-panel-slot="" />
      {/* 분리 창을 도크 존 위로 끌고 있을 때 도킹 자리를 비춘다 */}
      {dockHint && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-[240px] z-40 rounded-l-[12px] bg-white/[0.06] shadow-[inset_0_0_0_1px_var(--ui-line)]"
        />
      )}
      {ghost && createPortal(<PanelDragGhost ghost={ghost} />, document.body)}
      {createPortal(
        <PanelHostContext.Provider value={hostValue}>
          <div
            className={detached ? DETACHED_ROOT_CLASS : DOCKED_ROOT_CLASS}
            // 고스트를 끄는 동안 원래 자리의 패널은 흐려진다 (contents 박스라 프레임에 CSS로 건다)
            data-dmn-panel-ghosting={ghost && !detached ? '' : undefined}
          >
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
