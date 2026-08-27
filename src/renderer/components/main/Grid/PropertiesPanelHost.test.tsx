import React, { act, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  childWindow: null as null | { window: Window; document: Document },
  panelProps: [] as Array<Record<string, unknown>>,
  panelLayoutDocuments: [] as Document[],
  popupLayoutDocuments: [] as Array<{
    panel: Document;
    popup: Document | null;
  }>,
  mountCount: 0,
  applyNativeChrome: vi.fn(() =>
    Promise.resolve({ webRadius: 12, webRing: true }),
  ),
  readTokenColor: vi.fn((): [number, number, number, number] | null => null),
  startDragging: vi.fn((_x: number, _y: number) => Promise.resolve()),
  moveTo: vi.fn((_x: number, _y: number) => Promise.resolve()),
  dragContext: {
    mainFrame: null,
    mainContentOrigin: { x: 0, y: 0 },
  } as {
    mainFrame: null;
    mainContentOrigin: { x: number; y: number } | null;
  },
  dock: vi.fn(() => Promise.resolve()),
  setDragCursor: vi.fn((_active: boolean) => Promise.resolve()),
  flushResult: true,
}));

vi.mock('@utils/panelWindow/panelChildWindow', () => ({
  getPanelChildWindow: () => mocks.childWindow,
}));
vi.mock('@api/modules/panelWindowApi', () => ({
  panelWindowApi: {
    applyNativeChrome: () => mocks.applyNativeChrome(),
    startDragging: (x: number, y: number) => mocks.startDragging(x, y),
    dragContext: () => Promise.resolve(mocks.dragContext),
    moveTo: (x: number, y: number) => mocks.moveTo(x, y),
    presentAt: () => Promise.resolve(),
    dock: () => mocks.dock(),
    setDragCursor: (active: boolean) => mocks.setDragCursor(active),
  },
}));
vi.mock('@src/renderer/editor/runtime/lifecycleEditorFlush', () => ({
  flushFocusedEditor: () => Promise.resolve(mocks.flushResult),
}));
vi.mock('@src/renderer/editor/runtime/historyEditorFlushLock', () => ({
  isHistoryEditorFlushLocked: () => false,
}));
vi.mock('@utils/core/platform', () => ({
  isMac: () => false,
  isWindows: () => false,
}));
vi.mock('@utils/panelWindow/nativeChrome', () => ({
  readTokenColor: () => mocks.readTokenColor(),
}));
// 실제 패널 대신 로컬 state를 가진 스텁 - 이동 중 리마운트 여부를 state로 판별
vi.mock('@components/main/Grid/PropertiesPanel', () => ({
  default: function PanelStub(props: Record<string, unknown>) {
    const { document: ownerDocument } = usePanelHost();
    mocks.panelProps.push(props);
    const [count, setCount] = useState(0);
    const [popupOpen, setPopupOpen] = useState(false);
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const previousVariantRef = React.useRef(props.frameVariant);
    React.useEffect(() => {
      mocks.mountCount += 1;
    }, []);
    React.useLayoutEffect(() => {
      if (viewportRef.current) {
        mocks.panelLayoutDocuments.push(viewportRef.current.ownerDocument);
        if (popupOpen) {
          const popup = ownerDocument.querySelector(
            '[data-testid="panel-popup"]',
          );
          mocks.popupLayoutDocuments.push({
            panel: viewportRef.current.ownerDocument,
            popup: popup?.ownerDocument ?? null,
          });
        }
      }
      if (previousVariantRef.current !== props.frameVariant) {
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        previousVariantRef.current = props.frameVariant;
      }
    }, [ownerDocument, popupOpen, props.frameVariant]);
    return (
      <div
        data-testid="panel-stub"
        data-variant={String(props.frameVariant)}
        data-dmn-panel-frame=""
      >
        <div className="dmn-panel-header" data-testid="drag-header" />
        <div ref={viewportRef} className="properties-panel-overlay-viewport">
          <div style={{ height: 1200 }} />
        </div>
        <button
          type="button"
          data-testid="bump"
          onClick={() => setCount((value) => value + 1)}
        >
          {count}
        </button>
        <button
          type="button"
          data-testid="detach-action"
          onClick={() => (props.onDetachAction as () => void)()}
        >
          {String(props.detachAction)}
        </button>
        <button
          type="button"
          data-testid="popup-action"
          onClick={() => setPopupOpen((open) => !open)}
        >
          popup
        </button>
        {popupOpen &&
          createPortal(
            <div data-testid="panel-popup">popup</div>,
            ownerDocument.body,
          )}
      </div>
    );
  },
}));

import PropertiesPanelHost from './PropertiesPanelHost';
import {
  reapplyPanelHostScroll,
  usePanelHostStore,
} from '@stores/grid/usePanelHostStore';
import { registerPopupLayer } from '@components/main/Modal/popupLayer';
import { usePanelHost } from '@contexts/PanelHostContext';

const createChild = () => {
  const doc = document.implementation.createHTMLDocument('child');
  const win = {
    document: doc,
    closed: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  } as unknown as Window;
  return { window: win, document: doc };
};

describe('PropertiesPanelHost', () => {
  let container: HTMLDivElement;
  let root: Root;
  let dockAreaRef: React.RefObject<HTMLElement | null>;
  const layerCleanups: Array<() => void> = [];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    dockAreaRef = { current: container };
    mocks.childWindow = null;
    mocks.panelProps = [];
    mocks.panelLayoutDocuments = [];
    mocks.popupLayoutDocuments = [];
    mocks.mountCount = 0;
    mocks.applyNativeChrome.mockClear();
    mocks.moveTo.mockClear();
    mocks.readTokenColor.mockReturnValue(null);
    mocks.dock.mockReset();
    mocks.dock.mockResolvedValue(undefined);
    mocks.flushResult = true;
    usePanelHostStore.setState({
      placement: 'docked',
      attachedPlacement: null,
      transition: 'idle',
    });
  });

  afterEach(async () => {
    await act(async () =>
      layerCleanups
        .splice(0)
        .reverse()
        .forEach((cleanup) => cleanup()),
    );
    await act(async () => root.unmount());
    container.remove();
    document
      .querySelectorAll('[data-dmn-modal-backdrop="true"]')
      .forEach((element) => element.remove());
  });

  const render = async () => {
    await act(async () => {
      root.render(<PropertiesPanelHost dockAreaRef={dockAreaRef} />);
    });
  };

  const hostElement = () =>
    document.querySelector('[data-dmn-panel-host]') ??
    mocks.childWindow?.document.querySelector('[data-dmn-panel-host]') ??
    null;

  it('mounts the panel into a host element inside the slot while docked', async () => {
    await render();
    const slot = container.querySelector('[data-dmn-panel-slot]')!;
    const host = hostElement()!;
    expect(host.parentElement).toBe(slot);
    expect(host.querySelector('[data-testid="panel-stub"]')).not.toBeNull();
    expect(mocks.panelProps.at(-1)).toMatchObject({
      frameVariant: 'inline',
      detachAction: 'detach',
    });
  });

  it('moves the same host element into the child document without remounting the panel', async () => {
    await render();
    const bump = () =>
      hostElement()!.querySelector('[data-testid="bump"]') as HTMLButtonElement;
    await act(async () => bump().click());
    expect(bump().textContent).toBe('1');
    const hostBefore = hostElement();

    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });

    const hostAfter = mocks.childWindow.document.querySelector(
      '[data-dmn-panel-host]',
    );
    expect(hostAfter).toBe(hostBefore);
    expect(hostAfter!.parentElement).toBe(mocks.childWindow.document.body);
    expect(hostAfter!.ownerDocument).toBe(mocks.childWindow.document);
    // 로컬 state가 살아 있고 마운트는 한 번뿐
    expect(bump().textContent).toBe('1');
    expect(mocks.mountCount).toBe(1);
    expect(mocks.panelProps.at(-1)).toMatchObject({
      frameVariant: 'window',
      detachAction: 'reattach',
    });
    // 옮겨간 뒤에도 React 이벤트가 동작한다
    await act(async () => bump().click());
    expect(bump().textContent).toBe('2');

    await act(async () => {
      usePanelHostStore.getState().setPlacement('docked');
    });
    const slot = container.querySelector('[data-dmn-panel-slot]')!;
    expect(hostElement()!.parentElement).toBe(slot);
    expect(hostElement()!.ownerDocument).toBe(document);
    expect(bump().textContent).toBe('2');
    expect(mocks.mountCount).toBe(1);
  });

  it('removes the external host and child-body popup after final unmount', async () => {
    await render();
    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    const popupButton = hostElement()!.querySelector<HTMLButtonElement>(
      '[data-testid="popup-action"]',
    )!;
    await act(async () => popupButton.click());
    const childDocument = mocks.childWindow.document;
    expect(childDocument.querySelector('[data-dmn-panel-host]')).not.toBeNull();
    expect(
      childDocument.querySelector('[data-testid="panel-popup"]'),
    ).not.toBeNull();

    await act(async () => {
      root.render(null);
    });

    expect(childDocument.querySelector('[data-dmn-panel-host]')).toBeNull();
    expect(
      childDocument.querySelector('[data-testid="panel-popup"]'),
    ).toBeNull();
  });

  it('invalidates a calculated dock zone when the grid area disappears', async () => {
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 800,
      bottom: 600,
      left: 0,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    await render();
    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    const childDocument = mocks.childWindow.document;
    const header = childDocument.querySelector<HTMLElement>(
      '[data-testid="drag-header"]',
    )!;

    header.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        screenX: 900,
        screenY: 100,
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      // mousedown 때 계산된 영역이 있어도 설정 전환으로 그리드가 사라지면 무효
      dockAreaRef.current = null;
      childDocument.dispatchEvent(
        new MouseEvent('mousemove', {
          screenX: 700,
          screenY: 100,
        }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      childDocument.dispatchEvent(
        new MouseEvent('mouseup', {
          screenX: 700,
          screenY: 100,
        }),
      );
    });

    expect(mocks.moveTo).toHaveBeenCalled();
    expect(mocks.dock).not.toHaveBeenCalled();
    expect(usePanelHostStore.getState().placement).toBe('detached');
  });

  it('keeps the explicit reattach action while drag docking is disabled', async () => {
    dockAreaRef.current = null;
    await render();
    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    const action = hostElement()!.querySelector<HTMLButtonElement>(
      '[data-testid="detach-action"]',
    )!;

    await act(async () => {
      action.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.dock).toHaveBeenCalledTimes(1);
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('keeps the close shortcut while drag docking is disabled', async () => {
    dockAreaRef.current = null;
    await render();
    mocks.childWindow = createChild();
    const add = mocks.childWindow.window
      .addEventListener as unknown as ReturnType<typeof vi.fn>;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    const keydown = add.mock.calls
      .filter((call) => call[0] === 'keydown')
      .at(-1)?.[1] as ((event: KeyboardEvent) => void) | undefined;
    const event = new KeyboardEvent('keydown', {
      key: 'w',
      ctrlKey: true,
      cancelable: true,
    });

    await act(async () => {
      keydown?.(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.dock).toHaveBeenCalledTimes(1);
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('reattaches the host before panel layout effects run for docked mode', async () => {
    await render();
    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    mocks.panelLayoutDocuments = [];

    await act(async () => {
      usePanelHostStore.getState().setPlacement('docked');
    });

    expect(mocks.panelLayoutDocuments.at(-1)).toBe(document);
  });

  it('preserves the latest scroll position across document moves', async () => {
    await render();
    const viewport = hostElement()!.querySelector<HTMLElement>(
      '.properties-panel-overlay-viewport',
    )!;
    viewport.scrollTop = 420;

    mocks.childWindow = createChild();
    const childAdopt = mocks.childWindow.document.adoptNode.bind(
      mocks.childWindow.document,
    );
    vi.spyOn(mocks.childWindow.document, 'adoptNode').mockImplementation(
      (node) => {
        const adopted = childAdopt(node);
        (adopted as Element)
          .querySelectorAll<HTMLElement>('.properties-panel-overlay-viewport')
          .forEach((element) => {
            element.scrollTop = 0;
          });
        return adopted;
      },
    );
    const mainAdopt = document.adoptNode.bind(document);
    const mainAdoptSpy = vi
      .spyOn(document, 'adoptNode')
      .mockImplementation((node) => {
        const adopted = mainAdopt(node);
        (adopted as Element)
          .querySelectorAll<HTMLElement>('.properties-panel-overlay-viewport')
          .forEach((element) => {
            element.scrollTop = 0;
          });
        return adopted;
      });

    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    expect(viewport.scrollTop).toBe(420);

    viewport.scrollTop = 85;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('docked');
    });
    expect(viewport.scrollTop).toBe(85);

    viewport.scrollTop = 310;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    expect(viewport.scrollTop).toBe(310);
    mainAdoptSpy.mockRestore();
  });

  // 숨긴 자식 창에서 복원한 스크롤은 Lenis limit 0에 잘릴 수 있다 - present 뒤 재적용
  it('present 뒤 재적용은 잘린 스크롤만 저장값으로 되돌린다', async () => {
    await render();
    const viewport = hostElement()!.querySelector<HTMLElement>(
      '.properties-panel-overlay-viewport',
    )!;
    viewport.scrollTop = 420;
    mocks.childWindow = createChild();
    (
      mocks.childWindow as unknown as {
        requestAnimationFrame?: (cb: FrameRequestCallback) => number;
      }
    ).requestAnimationFrame = (cb) => {
      cb(0);
      return 1;
    };

    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    viewport.scrollTop = 0;

    await act(async () => {
      reapplyPanelHostScroll();
    });
    expect(viewport.scrollTop).toBe(420);
  });

  it('moves an open panel popup to the child document with the panel', async () => {
    await render();
    const popupButton = hostElement()!.querySelector<HTMLButtonElement>(
      '[data-testid="popup-action"]',
    )!;
    await act(async () => popupButton.click());
    expect(
      document.querySelector('[data-testid="panel-popup"]'),
    ).not.toBeNull();

    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });

    expect(document.querySelector('[data-testid="panel-popup"]')).toBeNull();
    expect(
      mocks.childWindow.document.querySelector('[data-testid="panel-popup"]'),
    ).not.toBeNull();
    expect(
      mocks.childWindow.document.querySelector('[data-testid="panel-stub"]'),
    ).not.toBeNull();

    mocks.popupLayoutDocuments = [];
    await act(async () => {
      usePanelHostStore.getState().setPlacement('docked');
    });

    expect(mocks.popupLayoutDocuments.at(-1)).toEqual({
      panel: document,
      popup: document,
    });
  });

  it('falls back to docked when the child window is gone', async () => {
    await render();
    mocks.childWindow = null;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    expect(usePanelHostStore.getState().placement).toBe('docked');
    const slot = container.querySelector('[data-dmn-panel-slot]')!;
    expect(hostElement()!.parentElement).toBe(slot);
  });

  it('wires child-window keyboard and blur listeners only while detached', async () => {
    await render();
    mocks.childWindow = createChild();
    const add = mocks.childWindow.window
      .addEventListener as unknown as ReturnType<typeof vi.fn>;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    const events = add.mock.calls.map((call) => call[0]);
    expect(events).toEqual(expect.arrayContaining(['keydown', 'blur']));
    const remove = mocks.childWindow.window
      .removeEventListener as unknown as ReturnType<typeof vi.fn>;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('docked');
    });
    expect(remove.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['keydown', 'blur']),
    );
  });

  it('활성 모달 동안 분리 문서 전체를 잠그고 종료 후 복원한다', async () => {
    await render();
    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });

    const modal = document.createElement('div');
    modal.dataset.dmnModalBackdrop = 'true';
    document.body.appendChild(modal);
    let unregister = () => {};
    await act(async () => {
      unregister = registerPopupLayer(modal);
      layerCleanups.push(unregister);
    });

    const childBody = mocks.childWindow.document.body;
    const panelRoot = childBody.querySelector<HTMLElement>(
      '[data-dmn-panel-host] > div',
    )!;
    expect(childBody.inert).toBe(true);
    expect(childBody.dataset.dmnModalLocked).toBe('true');
    // 딤은 body가 아니라 덮개가 소유해야 한다. body opacity는 backdrop root를
    // 만들어 이 창 안 모든 글래스의 블러를 죽인다
    expect(childBody.style.opacity).toBe('');
    expect(childBody.querySelector('[data-dmn-modal-dim]')).not.toBeNull();
    expect(panelRoot.hasAttribute('inert')).toBe(true);

    await act(async () => unregister());

    expect(childBody.inert).toBeUndefined();
    expect(childBody.dataset.dmnModalLocked).toBeUndefined();
    expect(childBody.style.opacity).toBe('');
    expect(panelRoot.hasAttribute('inert')).toBe(false);
  });

  describe('네이티브 창 크롬', () => {
    const detachedRoot = () =>
      mocks.childWindow!.document.querySelector<HTMLElement>(
        '[data-dmn-panel-host] > div',
      )!;
    const ring = () =>
      mocks.childWindow!.document.querySelector(
        '[data-dmn-panel-host] [aria-hidden="true"]',
      );
    // head MutationObserver → rAF 코얼레싱을 태워 sync를 한 번 돌린다
    const pokeCustomCss = async () => {
      await act(async () => {
        document.head.appendChild(document.createElement('style'));
      });
      await act(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });
    };

    it('백엔드가 정한 반경·링을 그대로 반영한다', async () => {
      mocks.readTokenColor.mockReturnValue([0.1, 0.1, 0.12, 1]);
      mocks.applyNativeChrome.mockResolvedValue({
        webRadius: 0,
        webRing: false,
      });
      await render();
      mocks.childWindow = createChild();
      await act(async () => {
        usePanelHostStore.getState().setPlacement('detached');
      });

      expect(mocks.applyNativeChrome).toHaveBeenCalledTimes(1);
      expect(
        detachedRoot().style.getPropertyValue('--dmn-panel-window-radius'),
      ).toBe('0px');
      // 네이티브가 라인을 그리므로 CSS 링은 없어야 한다 (겹치면 진해짐)
      expect(ring()).toBeNull();
    });

    it('토큰을 못 읽으면 CSS 링으로 물러나고, 색이 돌아오면 다시 요청한다', async () => {
      const color: [number, number, number, number] = [0.1, 0.1, 0.12, 1];
      mocks.readTokenColor.mockReturnValue(color);
      mocks.applyNativeChrome.mockResolvedValue({
        webRadius: 0,
        webRing: false,
      });
      await render();
      mocks.childWindow = createChild();
      await act(async () => {
        usePanelHostStore.getState().setPlacement('detached');
      });
      expect(mocks.applyNativeChrome).toHaveBeenCalledTimes(1);

      // 커스텀 CSS를 타이핑하다 토큰이 잠깐 색으로 해석되지 않는 구간
      mocks.readTokenColor.mockReturnValue(null);
      await pokeCustomCss();
      expect(
        detachedRoot().style.getPropertyValue('--dmn-panel-window-radius'),
      ).toBe('12px');
      expect(ring()).not.toBeNull();

      // 같은 색으로 되돌아왔다 - 시그니처가 같아도 재요청해야 한다 (dedupe 고착 방지)
      mocks.readTokenColor.mockReturnValue(color);
      await pokeCustomCss();
      expect(mocks.applyNativeChrome).toHaveBeenCalledTimes(2);
      expect(
        detachedRoot().style.getPropertyValue('--dmn-panel-window-radius'),
      ).toBe('0px');
      expect(ring()).toBeNull();
    });
  });
});
