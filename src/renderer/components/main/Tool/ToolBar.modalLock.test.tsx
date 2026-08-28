import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPopupLayer } from '../Modal/popupLayer';
import ToolBar from './ToolBar';

const settingsState = vi.hoisted(() => ({ noteEffect: false }));

vi.mock('./CanvasTool', () => ({
  default: ({ interactionDisabled }: { interactionDisabled?: boolean }) => (
    <button data-testid="canvas" disabled={interactionDisabled} />
  ),
}));
vi.mock('./SettingTool', () => ({
  default: ({ interactionDisabled }: { interactionDisabled?: boolean }) => (
    <button data-testid="settings" disabled={interactionDisabled} />
  ),
}));
vi.mock('./TabTool', () => ({
  default: () => <button data-testid="tabs" />,
}));
vi.mock('@assets/svgs/github.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/code.svg', () => ({ default: () => null }));
vi.mock('./icons/FaderIcon', () => ({ default: () => null }));
vi.mock('../Modal/TooltipGroup', () => ({
  TooltipGroup: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../Modal/FloatingTooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: () => settingsState,
}));
vi.mock('@hooks/useSingleFlightAction', () => ({
  useSingleFlightAction: () => ({ run: vi.fn(), pending: false }),
}));

const props = {
  onAddItem: vi.fn(),
  onTogglePalette: vi.fn(),
  onClosePalette: vi.fn(),
  isPaletteOpen: false,
  onResetCurrentMode: vi.fn(),
  activeTool: 'move',
  setActiveTool: vi.fn(),
};

describe('ToolBar modal lock', () => {
  let host: HTMLDivElement;
  let root: Root;
  const layerCleanups: Array<() => void> = [];

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    settingsState.noteEffect = false;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<ToolBar {...props} />));
  });

  afterEach(async () => {
    await act(async () =>
      layerCleanups
        .splice(0)
        .reverse()
        .forEach((cleanup) => cleanup()),
    );
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
  });

  const registerLayer = async (kind: 'modal' | 'popup') => {
    const layer = document.createElement('div');
    layer.setAttribute(
      kind === 'modal' ? 'data-dmn-modal-backdrop' : 'data-dmn-popup-layer',
      'true',
    );
    document.body.appendChild(layer);
    await act(async () => layerCleanups.push(registerPopupLayer(layer)));
    return layer;
  };

  const dimOf = (toolbar: HTMLElement) =>
    toolbar.querySelector<HTMLElement>('[data-dmn-modal-dim]');

  it('활성 모달 동안 툴바 전체를 inert와 비활성 색으로 표시한다', async () => {
    await registerLayer('modal');
    const toolbar = host.querySelector<HTMLElement>('[data-dmn-toolbar]')!;

    expect(toolbar.hasAttribute('inert')).toBe(true);
    expect(toolbar.getAttribute('aria-disabled')).toBe('true');
    expect(toolbar.dataset.dmnModalLocked).toBe('true');
    // 딤은 조상이 아니라 형제 오버레이가 소유해야 한다. 조상 opacity는
    // backdrop root를 만들어 툴바 안 글래스 팝업의 블러를 죽인다
    expect(toolbar.className).not.toMatch(/\bopacity-/);
    expect(dimOf(toolbar)?.className).toContain('opacity-60');
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="canvas"]')?.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="settings"]')
        ?.disabled,
    ).toBe(true);
  });

  it('비모달 팝업만 열리면 툴바를 잠그지 않는다', async () => {
    await registerLayer('popup');
    const toolbar = host.querySelector<HTMLElement>('[data-dmn-toolbar]')!;

    expect(toolbar.hasAttribute('inert')).toBe(false);
    expect(toolbar.dataset.dmnModalLocked).toBeUndefined();
    expect(toolbar.className).not.toMatch(/\bopacity-/);
    expect(dimOf(toolbar)?.className).toContain('opacity-0');
  });

  it('모달 진입 시 툴바 포털 팔레트를 닫도록 요청한다', async () => {
    await act(async () =>
      root.render(<ToolBar {...props} isPaletteOpen={true} />),
    );
    await registerLayer('modal');

    expect(props.onClosePalette).toHaveBeenCalledOnce();
  });

  it('FloatingTooltip 버튼은 번역된 접근성 이름만 제공한다', async () => {
    settingsState.noteEffect = true;
    await act(async () => root.render(<ToolBar {...props} />));

    const trackButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="tooltip.trackSettings"]',
    );
    expect(trackButton).not.toBeNull();
    expect(trackButton?.hasAttribute('title')).toBe(false);

    await act(async () => root.render(<ToolBar {...props} isSettingsOpen />));
    const githubButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="tooltip.github"]',
    );
    expect(githubButton).not.toBeNull();
    expect(githubButton?.hasAttribute('title')).toBe(false);
  });
});
