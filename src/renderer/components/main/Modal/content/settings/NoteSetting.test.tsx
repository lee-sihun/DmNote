import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultNoteSettings } from '@src/renderer/defaults';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import { INPUT_TIMELINE_PRESENTATION_BUFFER_MS } from '@constants/inputTimeline';

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
vi.mock('@components/main/Grid/PropertiesPanel/PropertyInputs', () => ({
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
}));
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

  const renderAdvanced = (
    overrides: Partial<NoteSettings>,
    props: Pick<
      React.ComponentProps<typeof NoteSetting>,
      'onClose' | 'onSave'
    > = {},
  ) => {
    const settings = {
      ...getDefaultNoteSettings(),
      ...overrides,
    };
    act(() => {
      root.render(<NoteSetting settings={settings} {...props} />);
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

  it('자동 계산에 이동 시간과 timeline 명목 지연을 합산한다', () => {
    renderAdvanced({
      delayedNoteEnabled: true,
      speed: 70,
      trackHeight: 20,
      shortNoteThresholdMs: 300,
      shortNoteMinLengthPx: 9999,
    });

    const expectedDelay = Math.round(
      (20 / 70) * 1000 + 300 + INPUT_TIMELINE_PRESENTATION_BUFFER_MS,
    );
    expect(container.textContent).toContain(
      `laboratory.keyDelayAuto:${expectedDelay}`,
    );
  });

  it('최대 허용 조합의 추천 지연과 30000ms 입력 상한을 노출한다', () => {
    renderAdvanced({
      delayedNoteEnabled: true,
      speed: 70,
      trackHeight: 2000,
      shortNoteThresholdMs: 2000,
      shortNoteMinLengthPx: 1,
    });

    const expectedDelay = Math.round(
      (2000 / 70) * 1000 + 2000 + INPUT_TIMELINE_PRESENTATION_BUFFER_MS,
    );
    expect(container.textContent).toContain(
      `laboratory.keyDelayAuto:${expectedDelay}`,
    );
    const input = container.querySelector(
      '[data-label="laboratory.keyDelay"] input',
    ) as HTMLInputElement;
    expect(input.max).toBe('30000');
  });

  it('내부 화면 버퍼를 사용자 단노트 구분 시간에 저장하지 않는다', async () => {
    let resolveSave!: () => void;
    const savePending = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onSave = vi.fn(() => savePending);
    const onClose = vi.fn();

    renderAdvanced(
      {
        delayedNoteEnabled: true,
        speed: 500,
        trackHeight: 32,
        shortNoteThresholdMs: 137,
        keyDisplayDelayMs: 0,
      },
      { onSave, onClose },
    );

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'noteSetting.save',
    );
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        shortNoteThresholdMs: 137,
      }),
    );
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave();
      await savePending;
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('저장 실패 시 모달을 유지하고 재시도 안내를 표시한다', async () => {
    const error = new Error('save failed');
    const onSave = vi.fn().mockRejectedValue(error);
    const onClose = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAdvanced({}, { onSave, onClose });

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'noteSetting.save',
    );
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'noteSetting.saveFailed',
    );
  });
});
