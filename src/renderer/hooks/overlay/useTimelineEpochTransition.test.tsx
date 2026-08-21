import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultNoteSettings } from '@src/renderer/defaults';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import { useTimelineEpochTransition } from './useTimelineEpochTransition';

type HookResult = ReturnType<typeof useTimelineEpochTransition>;

const Harness = ({
  settings,
  hydrated,
  onResult,
}: {
  settings: NoteSettings;
  hydrated: boolean;
  onResult: (result: HookResult) => void;
}) => {
  const result = useTimelineEpochTransition({
    target: settings,
    noteEffect: true,
    mode: '4key',
    hydrated,
  });
  React.useEffect(() => onResult(result));
  return null;
};

describe('useTimelineEpochTransition', () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: HookResult;
  const base = {
    ...getDefaultNoteSettings(),
    delayedNoteEnabled: true,
  };

  const render = (settings: NoteSettings, hydrated = true) => {
    act(() => {
      root.render(
        <Harness
          settings={settings}
          hydrated={hydrated}
          onResult={(value) => {
            result = value;
          }}
        />,
      );
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('판정 설정을 페이드아웃 뒤 새 epoch로 교체한다', async () => {
    render(base);
    render({ ...base, shortNoteThresholdMs: 175 });

    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(result.contentFade).toEqual({ opacity: 0, durationMs: 80 });
    expect(result.settings.shortNoteThresholdMs).toBe(
      base.shortNoteThresholdMs,
    );

    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(result.settings.shortNoteThresholdMs).toBe(175);
    expect(result.contentFade).toEqual({ opacity: 1, durationMs: 140 });

    await act(async () => vi.advanceTimersByTimeAsync(160));
    expect(result.contentFade).toBeNull();
  });

  it('타임라인 비활성 상태끼리의 변경은 즉시 적용한다', () => {
    const disabled = { ...base, delayedNoteEnabled: false };
    render(disabled);
    render({ ...disabled, speed: disabled.speed + 100 });

    expect(result.settings.speed).toBe(disabled.speed + 100);
    expect(result.contentFade).toBeNull();
  });

  it('하이드레이션 전 변경은 전환 없이 채택한다', () => {
    render(base, false);
    render({ ...base, trackHeight: base.trackHeight + 100 }, false);

    expect(result.settings.trackHeight).toBe(base.trackHeight + 100);
    expect(result.contentFade).toBeNull();
  });
});
