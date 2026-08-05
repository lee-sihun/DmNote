import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueEditorCompatibilityWrite } from '@src/renderer/editor/runtime/editorCompatibilityQueue';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';

import type { PanelViewState } from '@api/modules/selectionSessionApi';

const viewState: PanelViewState = {
  mode: 'property',
  activeTab: 'grid',
  propertyActiveTab: 'note',
};

const mocks = vi.hoisted(() => ({
  commitPendingAsync: vi.fn<() => Promise<boolean>>(),
  show: vi.fn<(value: PanelViewState) => Promise<void>>(),
  close: vi.fn<(value: PanelViewState) => Promise<void>>(),
  capturePanelViewState: vi.fn<() => PanelViewState>(),
  requestPropertyMode: vi.fn<() => Promise<void>>(),
  drainPluginElements: vi.fn<() => Promise<boolean>>(),
  drainPluginSettings: vi.fn<() => Promise<boolean>>(),
  flushSelectionSync: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('@api/modules/selectionSessionApi', () => ({
  panelWindowApi: {
    show: mocks.show,
    close: mocks.close,
    requestPropertyMode: mocks.requestPropertyMode,
  },
}));

vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
  editGestureController: {
    commitPendingAsync: mocks.commitPendingAsync,
  },
}));

vi.mock('@stores/grid/panelViewHandoff', () => ({
  capturePanelViewState: mocks.capturePanelViewState,
}));

vi.mock('@plugins/rpc/pluginElementActions', () => ({
  drainPendingPluginElementWrites: mocks.drainPluginElements,
}));

vi.mock('@plugins/rpc/pluginSettingsMirror', () => ({
  drainPendingPluginSettingsWrites: mocks.drainPluginSettings,
}));

vi.mock('@src/renderer/editor/runtime/selectionSync', () => ({
  flushSelectionSync: mocks.flushSelectionSync,
}));

import {
  detachPropertiesPanel,
  hasInlinePropertiesPanelLease,
  openPropertiesPanelForSelection,
  reattachPropertiesPanel,
  usePanelWindowStore,
} from './usePanelWindowStore';

describe('panel window transition flush', () => {
  beforeEach(() => {
    mocks.commitPendingAsync.mockReset().mockResolvedValue(true);
    mocks.show.mockReset().mockResolvedValue(undefined);
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.capturePanelViewState.mockReset().mockReturnValue(viewState);
    mocks.requestPropertyMode.mockReset().mockResolvedValue(undefined);
    mocks.drainPluginElements.mockReset().mockResolvedValue(true);
    mocks.drainPluginSettings.mockReset().mockResolvedValue(true);
    mocks.flushSelectionSync.mockReset().mockResolvedValue(true);
    usePanelWindowStore.setState({ status: 'attached', statusRevision: 0 });
    usePropertiesPanelStore.setState({
      canvasPanelMode: 'layer',
      isCanvasPanelOpen: false,
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('초기 상태 확인 전에는 렌더 lease를 어느 창에도 주지 않는다', () => {
    usePanelWindowStore.setState({ status: 'unknown', statusRevision: 0 });

    expect(usePanelWindowStore.getState().status).toBe('unknown');
    expect(hasInlinePropertiesPanelLease('unknown')).toBe(false);
    expect(hasInlinePropertiesPanelLease('detached')).toBe(false);
    expect(hasInlinePropertiesPanelLease('attached')).toBe(true);
  });

  it('초기 조회 중 도착한 visibility 상태를 늦은 조회 응답이 덮지 않는다', () => {
    usePanelWindowStore.setState({ status: 'unknown', statusRevision: 0 });
    const expectedRevision = usePanelWindowStore.getState().statusRevision;

    usePanelWindowStore.getState().setStatus('detached');
    usePanelWindowStore
      .getState()
      .resolveInitialStatus('attached', expectedRevision);

    expect(usePanelWindowStore.getState().status).toBe('detached');
  });

  it('분리 중 더블클릭 편집 요청을 패널 창으로 전달한다', () => {
    usePanelWindowStore.setState({ status: 'detached' });

    openPropertiesPanelForSelection();

    expect(usePropertiesPanelStore.getState()).toEqual(
      expect.objectContaining({
        canvasPanelMode: 'property',
        isCanvasPanelOpen: true,
      }),
    );
    expect(mocks.requestPropertyMode).toHaveBeenCalledTimes(1);
  });

  it('Cmd+W 경로에서 focused input blur 정산 뒤 재부착한다', async () => {
    const order: string[] = [];
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.addEventListener('blur', () => {
      order.push('blur');
      queueMicrotask(() => order.push('blur-settled'));
    });
    input.focus();
    mocks.commitPendingAsync.mockImplementation(async () => {
      order.push('commit');
      return true;
    });
    mocks.capturePanelViewState.mockImplementation(() => {
      order.push('handoff');
      return viewState;
    });
    mocks.close.mockImplementation(async () => {
      order.push('close');
    });

    await reattachPropertiesPanel();

    expect(order).toEqual([
      'blur',
      'blur-settled',
      'commit',
      'handoff',
      'close',
    ]);
    expect(mocks.close).toHaveBeenCalledWith(viewState);
  });

  it('focused textarea도 blur 정산 뒤 분리한다', async () => {
    const order: string[] = [];
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.addEventListener('blur', () => order.push('blur'));
    textarea.focus();
    mocks.commitPendingAsync.mockImplementation(async () => {
      order.push('commit');
      return true;
    });
    mocks.show.mockImplementation(async () => {
      order.push('show');
    });

    await detachPropertiesPanel();

    expect(order).toEqual(['blur', 'commit', 'show']);
    expect(mocks.show).toHaveBeenCalledWith(viewState);
    expect(usePanelWindowStore.getState().status).toBe('detached');
  });

  it('blur 뒤 pending commit이 실패하면 창 전환을 중단한다', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    mocks.commitPendingAsync.mockResolvedValue(false);

    await reattachPropertiesPanel();

    expect(document.activeElement).not.toBe(input);
    expect(mocks.capturePanelViewState).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('blur에서 시작된 compatibility write 완료까지 창을 유지한다', async () => {
    let resolveWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.addEventListener('blur', () => {
      void enqueueEditorCompatibilityWrite(
        () => write,
        () => undefined,
      );
    });
    input.focus();

    const transition = reattachPropertiesPanel();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.close).not.toHaveBeenCalled();
    resolveWrite();
    await transition;
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('blur compatibility write가 빠르게 실패해도 창을 닫지 않는다', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.addEventListener('blur', () => {
      void enqueueEditorCompatibilityWrite(
        () => Promise.reject(new Error('rename failed')),
        () => undefined,
      ).catch(() => {});
    });
    input.focus();

    await reattachPropertiesPanel();

    expect(mocks.capturePanelViewState).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('plugin 요소와 설정 쓰기 완료까지 재부착을 기다린다', async () => {
    let resolveElements!: (value: boolean) => void;
    let resolveSettings!: (value: boolean) => void;
    mocks.drainPluginElements.mockReturnValue(
      new Promise((resolve) => {
        resolveElements = resolve;
      }),
    );
    mocks.drainPluginSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );

    const transition = reattachPropertiesPanel();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.close).not.toHaveBeenCalled();

    resolveElements(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.close).not.toHaveBeenCalled();

    resolveSettings(true);
    await transition;
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('편집과 plugin 정산 뒤 선택 publish를 마지막으로 비운다', async () => {
    let resolveSettings!: (value: boolean) => void;
    mocks.drainPluginSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );

    const transition = detachPropertiesPanel();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.flushSelectionSync).not.toHaveBeenCalled();

    resolveSettings(true);
    await transition;

    expect(mocks.flushSelectionSync).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  it('plugin 쓰기 ACK 실패 시 패널을 유지한다', async () => {
    mocks.drainPluginSettings.mockResolvedValue(false);

    await reattachPropertiesPanel();

    expect(mocks.capturePanelViewState).not.toHaveBeenCalled();
    expect(mocks.flushSelectionSync).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('최신 선택 publish가 실패하면 창 전환을 중단한다', async () => {
    mocks.flushSelectionSync.mockResolvedValue(false);

    await detachPropertiesPanel();

    expect(mocks.capturePanelViewState).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(usePanelWindowStore.getState().status).toBe('attached');
  });
});
