import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultNoteSettings } from '@src/renderer/defaults';
import type { NoteSettings } from '@src/types/settings/noteSettings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { value?: number }) =>
      values?.value === undefined ? key : `${key}:${values.value}`,
  }),
}));
vi.mock('@hooks/usePressAction', () => ({
  usePressAction: (action?: () => void) => ({ onClick: action }),
}));
vi.mock('@components/main/common/Checkbox', () => ({
  default: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button type="button" aria-pressed={checked} onClick={onChange}>
      checkbox
    </button>
  ),
}));
vi.mock('@components/main/common/TabSwitch', () => ({
  default: ({
    tabs,
    onTabChange,
  }: {
    tabs: { id: string; label: string }[];
    onTabChange: (id: string) => void;
  }) => (
    <div>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          data-tab={tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock(
  '@components/main/Grid/PropertiesPanel/controls/PropertyInputs',
  () => ({
    PropertyRow: ({
      label,
      children,
    }: {
      label: React.ReactNode;
      children: React.ReactNode;
    }) => (
      <label data-label={typeof label === 'string' ? label : undefined}>
        {label}
        {children}
      </label>
    ),
    PropertySection: ({ children }: { children: React.ReactNode }) => (
      <section>{children}</section>
    ),
  }),
);
vi.mock('../../Modal', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import NoteSetting from './NoteSetting';

describe('NoteSetting 단노트 정책 안내', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

  const renderAdvanced = (overrides: Partial<NoteSettings>) => {
    const settings = {
      ...getDefaultNoteSettings(),
      ...overrides,
    };
    act(() => {
      root.render(<NoteSetting settings={settings} />);
    });
    act(() => {
      (
        container.querySelector('[data-tab="advanced"]') as HTMLButtonElement
      ).click();
    });
  };

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
    globalThis.requestAnimationFrame =
      originalRequestAnimationFrame as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame =
      originalCancelAnimationFrame as typeof cancelAnimationFrame;
    vi.restoreAllMocks();
  });

  it('자동 계산에 트랙 높이로 제한한 최소 길이를 쓴다', () => {
    renderAdvanced({
      delayedNoteEnabled: true,
      speed: 70,
      trackHeight: 20,
      shortNoteThresholdMs: 300,
      shortNoteMinLengthPx: 9999,
    });

    // 9999px가 아니라 트랙 높이 20px 기준 -> 이동 285.7 + 지연 7.1
    expect(container.textContent).toContain('laboratory.keyDelayAuto:293');
  });

  it('최대 허용 조합의 추천 지연과 30000ms 입력 상한을 노출한다', () => {
    renderAdvanced({
      delayedNoteEnabled: true,
      speed: 70,
      trackHeight: 2000,
      shortNoteThresholdMs: 2000,
      shortNoteMinLengthPx: 1,
    });

    expect(container.textContent).toContain('laboratory.keyDelayAuto:29564');
    const input = container.querySelector(
      '[data-label="laboratory.keyDelay"] input',
    ) as HTMLInputElement;
    expect(input.max).toBe('30000');
  });
});
