import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUIStore } from '@stores/useUIStore';
import SettingTool from './SettingTool';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@assets/svgs/folder.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/setting.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/chevron-down.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/turn_arrow.svg', () => ({ default: () => null }));
vi.mock('../Modal/FloatingTooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../Modal/TooltipGroup', () => ({
  TooltipGroup: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../Modal/ListPopup', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid="preset-popup" data-open={String(open)} />
  ),
}));
vi.mock('../common/IconSwap', () => ({ default: () => null }));
vi.mock('../common/EyeToggleIcon', () => ({ default: () => null }));
vi.mock('./icons/IconMotion', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@hooks/useIconMotion', () => ({
  useIconMotion: () => ({ motionProps: {} }),
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    status: () => Promise.resolve({ running: false }),
    onStatus: () => () => {},
  },
}));
vi.mock('@api/modules/overlayApi', () => ({
  overlayApi: { setVisible: () => Promise.resolve() },
}));
vi.mock('@api/modules/presetsApi', () => ({
  presetsApi: {},
}));

describe('SettingTool modal lock', () => {
  let host: HTMLDivElement;
  let root: Root;
  let originalApi: PropertyDescriptor | undefined;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    originalApi = Object.getOwnPropertyDescriptor(window, 'api');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        overlay: {
          get: () => Promise.resolve({ visible: true }),
          onVisibility: () => () => {},
        },
      },
    });
    useUIStore.setState({ isExportImportPopupOpen: false });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    if (originalApi) Object.defineProperty(window, 'api', originalApi);
    else delete (window as Partial<Window>).api;
  });

  const render = async (interactionDisabled = false) => {
    await act(async () => {
      root.render(<SettingTool interactionDisabled={interactionDisabled} />);
    });
  };

  it('모달 진입 시 열린 preset 포털 메뉴와 전역 표시 상태를 닫는다', async () => {
    await render();
    const buttons = host.querySelectorAll<HTMLButtonElement>('button');
    await act(async () => buttons[1].click());
    expect(
      host.querySelector<HTMLElement>('[data-testid="preset-popup"]')?.dataset
        .open,
    ).toBe('true');
    expect(useUIStore.getState().isExportImportPopupOpen).toBe(true);

    await render(true);
    expect(
      host.querySelector<HTMLElement>('[data-testid="preset-popup"]')?.dataset
        .open,
    ).toBe('false');
    expect(useUIStore.getState().isExportImportPopupOpen).toBe(false);
  });

  it('FloatingTooltip 버튼은 접근성 이름만 제공하고 native title을 중복하지 않는다', async () => {
    await render();

    for (const label of [
      'tooltip.exportPreset',
      'tooltip.importExport',
      'tooltip.overlayClose',
      'tooltip.settings',
    ]) {
      const button = host.querySelector<HTMLButtonElement>(
        `[aria-label="${label}"]`,
      );
      expect(button, label).not.toBeNull();
      expect(button?.hasAttribute('title')).toBe(false);
    }

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="tooltip.overlayClose"]')
        ?.click();
    });
    const openOverlayButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="tooltip.overlayOpen"]',
    );
    expect(openOverlayButton).not.toBeNull();
    expect(openOverlayButton?.hasAttribute('title')).toBe(false);

    await act(async () => root.render(<SettingTool isSettingsOpen />));
    const backButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="tooltip.back"]',
    );
    expect(backButton).not.toBeNull();
    expect(backButton?.hasAttribute('title')).toBe(false);
  });
});
