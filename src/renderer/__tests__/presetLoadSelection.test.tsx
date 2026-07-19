// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingTool from '@components/main/Tool/SettingTool';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

const popup = vi.hoisted(() => ({
  onSelect: null as null | ((id: string) => Promise<void>),
}));

const history = vi.hoisted(() => ({
  pushState: vi.fn(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    status: vi.fn().mockResolvedValue({ running: false }),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@stores/data/useHistoryStore', () => ({
  useHistoryStore: (selector: (state: { pushState: () => void }) => unknown) =>
    selector({ pushState: history.pushState }),
}));

vi.mock('@components/main/Modal/ListPopup', () => ({
  default: (props: { onSelect: (id: string) => Promise<void> }) => {
    popup.onSelect = props.onSelect;
    return null;
  },
}));

vi.mock('@components/main/Modal/FloatingTooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@components/main/Modal/TooltipGroup', () => ({
  TooltipGroup: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@assets/svgs/folder.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/setting.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/chevron-down.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/turn_arrow.svg', () => ({ default: () => null }));

describe('프리셋 로드 선택 수명', () => {
  const originalApi = window.api;
  const load = vi.fn();
  const loadTab = vi.fn();
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    load.mockReset().mockResolvedValue({ success: true });
    loadTab.mockReset().mockResolvedValue({ success: true });
    window.api = {
      overlay: {
        get: vi.fn().mockResolvedValue({ visible: true }),
        onVisibility: vi.fn(() => vi.fn()),
      },
      presets: {
        load,
        loadTab,
      },
      keys: {
        getCounters: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Window['api'];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    popup.onSelect = null;
    history.pushState.mockReset();
    useGridSelectionStore.getState().clearSelection();
    await act(async () => root.render(<SettingTool />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.api = originalApi;
    useGridSelectionStore.getState().clearSelection();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const selectKey = () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
  };

  const invokePopup = async (id: string) => {
    if (!popup.onSelect) throw new Error('popup handler not captured');
    await act(async () => popup.onSelect?.(id));
  };

  it('전체 프리셋 로드 성공 시 선택을 해제한다', async () => {
    selectKey();

    await invokePopup('import-all');

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
    expect(history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({ invalidatesGridSelection: true }),
    );
  });

  it('탭 프리셋 로드 성공 시 선택을 해제한다', async () => {
    selectKey();

    await invokePopup('import-tab');

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
    expect(history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({ invalidatesGridSelection: true }),
    );
  });

  it('프리셋 로드 실패 시 선택을 보존한다', async () => {
    load.mockResolvedValueOnce({ success: false });
    selectKey();

    await invokePopup('import-all');

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: 'key-0', index: 0 },
    ]);
  });

  it('프리셋 로드 예외 시에도 선택을 보존한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    load.mockRejectedValueOnce(new Error('injected failure'));
    selectKey();

    await invokePopup('import-all');

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: 'key-0', index: 0 },
    ]);
  });
});
