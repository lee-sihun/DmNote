/**
 * 탭 삭제 정산
 *
 * 삭제 응답을 기다리는 사이 프리셋이나 다른 창의 undo가 들어올 수 있다.
 * 그러면 낙관 적용 전에 떠둔 previousTabs도, 응답이 실어 온 선택도 이미 과거다.
 * 세대가 그대로일 때만 정산해야 한다
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ delete: vi.fn() }));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@api/modules/keysApi', () => ({
  keysApi: { customTabs: { delete: api.delete } },
}));
vi.mock('../Modal/content/editors/TabNameModal', () => ({
  default: () => null,
}));
// 확인창은 확인 버튼만 남긴다
vi.mock('../Modal/content/dialogs/Alert.jsx', () => ({
  default: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) => (isOpen ? <button data-testid="confirm" onClick={onConfirm} /> : null),
}));

import { TabActionsProvider } from './tabActions';
import { useTabActions } from './tabActionsContext';
import { useKeyStore } from '@stores/data/useKeyStore';

const TABS = [
  { id: 'custom-a', name: 'A' },
  { id: 'custom-b', name: 'B' },
];
const ORDER = ['custom-a', 'custom-b', '4key', '5key', '6key', '8key'];

const Trigger = () => {
  const { requestDelete } = useTabActions();
  return (
    <button
      data-testid="ask"
      onClick={() => requestDelete({ id: 'custom-a', name: 'A' })}
    />
  );
};

let container: HTMLDivElement;
let root: Root;

const click = (testId: string) => {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
      .click();
  });
};

beforeEach(() => {
  api.delete.mockReset();
  useKeyStore.setState({
    customTabs: TABS,
    tabOrder: ORDER,
    barCount: 4,
    selectedKeyType: 'custom-a',
    // setSelectedKeyType의 백엔드 호출 경로를 끈다. 여기서 볼 것은 세대뿐이다
    isBootstrapped: false,
    pendingTabPlacements: 0,
    deferredTabPlacement: null,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <TabActionsProvider>
        <Trigger />
      </TabActionsProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 다른 창의 프리셋이나 undo가 도착한 상황 */
const authoritativeEventArrives = () => {
  useKeyStore.getState().adoptTabMetadataEvent({
    customTabs: [{ id: 'custom-z', name: '프리셋이 만든 탭' }],
    tabOrder: ['custom-z', '4key', '5key', '6key', '8key'],
    barCount: 4,
    selectedKeyType: '6key',
  });
};

describe('탭 삭제 정산', () => {
  it('실패하면 원래 목록으로 되돌린다', async () => {
    api.delete.mockResolvedValue({ success: false, error: 'nope' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    click('ask');
    click('confirm');
    await act(async () => {});

    expect(useKeyStore.getState().customTabs).toEqual(TABS);
    warn.mockRestore();
  });

  it('기다리는 사이 권위 이벤트가 왔으면 롤백하지 않는다', async () => {
    let settle: (value: unknown) => void = () => {};
    api.delete.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    click('ask');
    click('confirm');
    authoritativeEventArrives();

    await act(async () => {
      settle({ success: false, error: 'nope' });
    });

    // 프리셋이 만든 탭이 살아 있어야 한다
    expect(useKeyStore.getState().customTabs.map((tab) => tab.id)).toEqual([
      'custom-z',
    ]);
    warn.mockRestore();
  });

  it('customTabs 이벤트가 유실돼도 모드 이벤트만으로 선택을 지킨다', async () => {
    // custom_tabs_select는 keys:mode-changed만 낸다. 순서 세대는 그대로다
    let settle: (value: unknown) => void = () => {};
    api.delete.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    click('ask');
    click('confirm');
    useKeyStore.getState().commitSelectedKeyType('6key');

    await act(async () => {
      settle({ success: true, selected: '4key' });
    });

    expect(useKeyStore.getState().selectedKeyType).toBe('6key');
  });

  it('기다리는 사이 사용자가 직접 고른 탭도 덮지 않는다', async () => {
    // 이벤트가 아니라 사용자의 즉시 선택이다. 이것도 세대를 올려야 한다
    let settle: (value: unknown) => void = () => {};
    api.delete.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    click('ask');
    click('confirm');
    useKeyStore.getState().setSelectedKeyType('6key');

    await act(async () => {
      settle({ success: true, selected: '4key' });
    });

    expect(useKeyStore.getState().selectedKeyType).toBe('6key');
  });

  it('성공해도 그사이 온 이벤트의 선택을 덮지 않는다', async () => {
    let settle: (value: unknown) => void = () => {};
    api.delete.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    click('ask');
    click('confirm');
    authoritativeEventArrives();

    await act(async () => {
      settle({ success: true, selected: '4key' });
    });

    expect(useKeyStore.getState().selectedKeyType).toBe('6key');
  });
});
