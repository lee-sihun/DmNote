/**
 * 바 칩 우클릭 메뉴
 *
 * 바에 올린 커스텀 탭은 팝업 목록에 없다. 이름 변경과 삭제가 여기 말고는 없어서,
 * 메뉴가 안 열리면 그 탭은 관리할 길이 사라진다
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  requestRename: vi.fn(),
  requestDelete: vi.fn(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@hooks/useIconMotion', () => ({
  useIconMotion: () => ({ motionProps: {} }),
}));
vi.mock('@api/modules/keysApi', () => ({
  keysApi: { tabs: { swap: vi.fn(() => Promise.resolve({})) } },
}));
vi.mock('@hooks/useLenis', () => ({ scrollLenisBy: vi.fn() }));
vi.mock('./icons/TabGridIcon', () => ({ default: () => null }));
vi.mock('../Modal/FloatingPopup', () => ({ default: () => null }));
vi.mock('../Modal/content/settings/TabList', () => ({ default: () => null }));
vi.mock('../Modal/FloatingTooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../Modal/TooltipGroup', () => ({
  TooltipGroup: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./tabActions', () => ({
  TabActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./tabActionsContext', () => ({ useTabActions: () => actions }));
// 메뉴 항목을 눌러볼 수 있게 평평한 버튼으로 편다
vi.mock('../Modal/ListPopup', () => ({
  default: ({
    open,
    items,
    onSelect,
  }: {
    open: boolean;
    items: { id: string; label: string }[];
    onSelect?: (id: string) => void;
  }) =>
    open ? (
      <div data-testid="menu">
        {items.map((item) => (
          <button
            key={item.id}
            data-testid={`menu-${item.id}`}
            onClick={() => onSelect?.(item.id)}
          />
        ))}
      </div>
    ) : null,
}));

import TabTool from './TabTool';
import { useKeyStore } from '@stores/data/useKeyStore';

const CUSTOM = { id: 'custom-a', name: '연습' };

let container: HTMLDivElement;
let root: Root;

const chipByLabel = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );

const rightClick = (element: Element) => {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
  });
};

beforeEach(() => {
  actions.requestRename.mockClear();
  actions.requestDelete.mockClear();
  useKeyStore.setState({
    customTabs: [CUSTOM],
    // 커스텀 탭을 바 첫 칸에 올린 상태. 팝업 목록에서는 빠져 있다
    tabOrder: [CUSTOM.id, '4key', '5key', '6key', '8key'],
    barCount: 4,
    selectedKeyType: '4key',
    isBootstrapped: true,
    pendingTabPlacements: 0,
    deferredTabPlacement: null,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<TabTool />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('바 칩 우클릭 메뉴', () => {
  it('커스텀 탭에서 이름 변경을 부른다', () => {
    rightClick(chipByLabel(CUSTOM.name)!);
    expect(container.querySelector('[data-testid="menu"]')).not.toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="menu-rename"]')!
        .click();
    });

    expect(actions.requestRename).toHaveBeenCalledWith({
      id: CUSTOM.id,
      name: CUSTOM.name,
    });
  });

  it('커스텀 탭에서 삭제를 부른다', () => {
    rightClick(chipByLabel(CUSTOM.name)!);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="menu-delete"]')!
        .click();
    });

    expect(actions.requestDelete).toHaveBeenCalledWith({
      id: CUSTOM.id,
      name: CUSTOM.name,
    });
  });

  it('내장 탭에서는 메뉴가 열리지 않는다', () => {
    // 내장 탭은 이름도 못 바꾸고 지울 수도 없다
    rightClick(chipByLabel('mode.button4')!);

    expect(container.querySelector('[data-testid="menu"]')).toBeNull();
  });

  it('메뉴 대상 탭이 사라지면 메뉴를 닫는다', () => {
    rightClick(chipByLabel(CUSTOM.name)!);
    expect(container.querySelector('[data-testid="menu"]')).not.toBeNull();

    act(() => {
      useKeyStore.setState({
        customTabs: [],
        tabOrder: ['4key', '5key', '6key', '8key'],
      });
    });

    expect(container.querySelector('[data-testid="menu"]')).toBeNull();
    expect(actions.requestRename).not.toHaveBeenCalled();
    expect(actions.requestDelete).not.toHaveBeenCalled();
  });
});
