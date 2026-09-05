import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const soundTrimMocks = vi.hoisted(() => ({
  createAudioContext: vi.fn(),
  decodeAudioFromArrayBuffer: vi.fn(),
  drawWaveform: vi.fn(),
  extractWaveformPeaks: vi.fn(),
  schedulerPush: vi.fn(),
  schedulerFlush: vi.fn(),
  schedulerCancel: vi.fn(),
  beginDragCursor: vi.fn(),
  endDragCursor: vi.fn(),
  setCustomCursorHover: vi.fn(),
  lockCustomCursor: vi.fn(),
  unlockCustomCursor: vi.fn(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@api/modules/resources/resourceApi', () => ({
  soundApi: {},
}));
vi.mock('@utils/dom/dragCursor', () => ({
  beginDragCursor: soundTrimMocks.beginDragCursor,
  endDragCursor: soundTrimMocks.endDragCursor,
}));
vi.mock('@utils/grid/cursorUtils', () => ({
  getCursor: () => 'ew-resize',
  setCustomCursorHover: soundTrimMocks.setCustomCursorHover,
  lockCustomCursor: soundTrimMocks.lockCustomCursor,
  unlockCustomCursor: soundTrimMocks.unlockCustomCursor,
}));
vi.mock('@utils/animation/rafLatestScheduler', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@utils/animation/rafLatestScheduler')
  >();
  return {
    ...original,
    createRafLatestScheduler: <T,>(
      apply: (value: T) => void,
      strategy?: import('@utils/animation/rafLatestScheduler').ContinuousInputStrategy,
      frames?: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>,
    ) => {
      const scheduler = original.createRafLatestScheduler(
        apply,
        strategy,
        frames,
      );
      return {
        push: (value: T) => {
          soundTrimMocks.schedulerPush(value);
          scheduler.push(value);
        },
        flush: () => {
          soundTrimMocks.schedulerFlush();
          scheduler.flush();
        },
        cancel: () => {
          soundTrimMocks.schedulerCancel();
          scheduler.cancel();
        },
      };
    },
  };
});
vi.mock('./soundTrimModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./soundTrimModel')>()),
  createAudioContext: soundTrimMocks.createAudioContext,
  decodeAudioFromArrayBuffer: soundTrimMocks.decodeAudioFromArrayBuffer,
  drawWaveform: soundTrimMocks.drawWaveform,
  extractWaveformPeaks: soundTrimMocks.extractWaveformPeaks,
}));

import SoundTrimModal from './SoundTrimModal';

interface FakeAudioSource {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeAudioContext {
  currentTime: number;
  destination: object;
  gain: { gain: { value: number }; connect: ReturnType<typeof vi.fn> };
  source: FakeAudioSource;
  createGain: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const AUDIO_BUFFER = {
  duration: 10,
  length: 1000,
} as AudioBuffer;

const INITIAL_FILE = {
  name: 'sample.wav',
  arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
} as unknown as File;

describe('SoundTrimModal playback·waveform runtime', () => {
  let host: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let rafId: number;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let lifecycle: string[];
  let contexts: FakeAudioContext[];
  let resizeObservers: Array<{
    target: Element | null;
    disconnect: ReturnType<typeof vi.fn>;
  }>;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let windowAddEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let windowRemoveEventListenerSpy: ReturnType<typeof vi.spyOn>;

  const createContext = (): AudioContext => {
    const id = contexts.length + 1;
    const source: FakeAudioSource = {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      start: vi.fn((...args: unknown[]) => {
        lifecycle.push(`source${id}.start:${args.join(',')}`);
      }),
      stop: vi.fn(() => lifecycle.push(`source${id}.stop`)),
    };
    const gain = {
      gain: { value: -1 },
      connect: vi.fn(),
    };
    const context: FakeAudioContext = {
      currentTime: 0,
      destination: {},
      gain,
      source,
      createGain: vi.fn(() => gain),
      createBufferSource: vi.fn(() => source),
      close: vi.fn(() => {
        lifecycle.push(`context${id}.close`);
        return Promise.resolve();
      }),
    };
    contexts.push(context);
    return context as unknown as AudioContext;
  };

  const runRaf = (id: number) => {
    const callback = rafCallbacks.get(id);
    expect(callback).toBeTypeOf('function');
    rafCallbacks.delete(id);
    callback!(performance.now());
  };

  const settleDeferredContent = async () => {
    const frame = [...rafCallbacks.keys()][0];
    expect(frame).toBeDefined();
    act(() => runRaf(frame));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const renderOpen = async (
    previewVolume = 100,
    continuousInputStrategy: 'legacy' | 'frame' = 'legacy',
  ) => {
    await act(async () => {
      root.render(
        <SoundTrimModal
          isOpen
          onClose={() => undefined}
          onSaved={() => undefined}
          previewVolume={previewVolume}
          initialFile={INITIAL_FILE}
          continuousInputStrategy={continuousInputStrategy}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleDeferredContent();
  };

  const playbackButton = (): HTMLButtonElement => {
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      candidate.querySelector('svg'),
    );
    expect(button).toBeDefined();
    return button!;
  };

  const waveformHost = (): HTMLDivElement =>
    document.querySelector('[data-sound-waveform="true"]')!;

  const setWaveformRect = (waveform: HTMLDivElement) => {
    vi.spyOn(waveform, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 224,
      bottom: 100,
      width: 224,
      height: 100,
      toJSON: () => ({}),
    });
  };

  const dispatchMouse = (
    target: EventTarget,
    type: string,
    init: MouseEventInit,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => target.dispatchEvent(event));
    return event;
  };

  const dispatchWheel = (
    target: EventTarget,
    init: WheelEventInit,
  ): WheelEvent => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => target.dispatchEvent(event));
    return event;
  };

  const runLatestRaf = () => {
    const frame = [...rafCallbacks.keys()].at(-1);
    expect(frame).toBeDefined();
    act(() => runRaf(frame!));
  };

  const expectCalledBefore = (
    before: ReturnType<typeof vi.fn>,
    after: ReturnType<typeof vi.fn>,
  ) => {
    expect(before.mock.invocationCallOrder.at(-1)).toBeLessThan(
      after.mock.invocationCallOrder.at(0) ?? Number.POSITIVE_INFINITY,
    );
  };

  const eventCallCount = (
    spy: ReturnType<typeof vi.spyOn>,
    target: EventTarget,
    type: string,
  ): number =>
    spy.mock.calls.filter(
      (call, index) => spy.mock.instances[index] === target && call[0] === type,
    ).length;

  const firstEventCallOrder = (
    spy: ReturnType<typeof vi.spyOn>,
    types: string[],
  ): number => {
    const orders = spy.mock.calls.flatMap((call, index) =>
      types.includes(String(call[0]))
        ? [spy.mock.invocationCallOrder[index]]
        : [],
    );
    expect(orders.length).toBeGreaterThan(0);
    return Math.min(...orders);
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mounted = true;
    rafId = 0;
    rafCallbacks = new Map();
    lifecycle = [];
    contexts = [];
    resizeObservers = [];

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      lifecycle.push(`raf.cancel:${id}`);
      rafCallbacks.delete(id);
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly record = {
          target: null as Element | null,
          disconnect: vi.fn(),
        };

        constructor() {
          resizeObservers.push(this.record);
        }

        observe(target: Element) {
          this.record.target = target;
        }

        disconnect() {
          this.record.disconnect();
        }
      },
    );

    soundTrimMocks.createAudioContext.mockImplementation(createContext);
    soundTrimMocks.decodeAudioFromArrayBuffer.mockResolvedValue(AUDIO_BUFFER);
    soundTrimMocks.extractWaveformPeaks.mockReturnValue(
      new Float32Array([0.1, 0.5, 0.25]),
    );
    soundTrimMocks.drawWaveform.mockClear();
    INITIAL_FILE.arrayBuffer = vi.fn(async () => new ArrayBuffer(8));

    addEventListenerSpy = vi.spyOn(EventTarget.prototype, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(
      EventTarget.prototype,
      'removeEventListener',
    );
    windowAddEventListenerSpy = vi.spyOn(window, 'addEventListener');
    windowRemoveEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(async () => {
    if (mounted) {
      await act(async () => root.unmount());
    }
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('play→pause→resume→natural end와 volume·RAF·audio 해제 순서를 유지한다', async () => {
    await renderOpen(250);

    act(() => playbackButton().click());
    const first = contexts[0];
    expect(first.gain.gain.value).toBe(2);
    expect(first.source.start).toHaveBeenCalledWith(0, 0, 10);

    first.currentTime = 2;
    const firstPlaybackFrame = [...rafCallbacks.keys()][0];
    act(() => runRaf(firstPlaybackFrame));
    expect(soundTrimMocks.drawWaveform).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(Float32Array),
      0,
      1,
      0.2,
      0,
      1,
    );

    lifecycle = [];
    act(() => playbackButton().click());
    expect(first.source.onended).toBeNull();
    expect(first.source.stop).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(lifecycle[0]).toMatch(/^raf\.cancel:/);
    expect(lifecycle).toEqual([
      expect.stringMatching(/^raf\.cancel:/),
      'source1.stop',
      'context1.close',
    ]);
    expect(soundTrimMocks.drawWaveform.mock.calls.at(-1)?.[4]).toBe(0.2);

    await act(async () => {
      root.render(
        <SoundTrimModal
          isOpen
          onClose={() => undefined}
          onSaved={() => undefined}
          previewVolume={-20}
          initialFile={INITIAL_FILE}
          continuousInputStrategy="legacy"
        />,
      );
    });
    act(() => playbackButton().click());
    const resumed = contexts[1];
    expect(resumed.gain.gain.value).toBe(0);
    expect(resumed.source.start).toHaveBeenCalledWith(0, 2, 8);

    lifecycle = [];
    const naturalEnd = resumed.source.onended;
    expect(naturalEnd).not.toBeNull();
    act(() => naturalEnd?.());
    expect(resumed.source.onended).toBeNull();
    expect(lifecycle).toEqual([
      expect.stringMatching(/^raf\.cancel:/),
      'source2.stop',
      'context2.close',
    ]);
    expect(soundTrimMocks.drawWaveform.mock.calls.at(-1)?.[4]).toBeNull();
  });

  it('canvas·observer·wheel·pointer listener를 열 때 설치하고 close reset에서 해제한다', async () => {
    await renderOpen();
    const waveform = waveformHost();
    const canvas = waveform.querySelector('canvas')!;

    expect(resizeObservers.some(({ target }) => target === waveform)).toBe(
      true,
    );
    expect(eventCallCount(addEventListenerSpy, waveform, 'wheel')).toBe(1);
    expect(eventCallCount(addEventListenerSpy, waveform, 'mousedown')).toBe(1);
    expect(eventCallCount(addEventListenerSpy, canvas, 'mousemove')).toBe(1);
    expect(eventCallCount(addEventListenerSpy, canvas, 'mouseleave')).toBe(1);

    const pointerListenerStart = windowAddEventListenerSpy.mock.calls.length;
    act(() => {
      waveform.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
        }),
      );
    });
    const pointerListeners = windowAddEventListenerSpy.mock.calls
      .slice(pointerListenerStart)
      .filter(([type]) =>
        ['pointermove', 'pointerup', 'pointercancel', 'blur'].includes(type),
      );
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'blur']) {
      expect(
        pointerListeners.some(([registeredType]) => registeredType === type),
      ).toBe(true);
    }

    await act(async () => {
      root.render(
        <SoundTrimModal
          isOpen={false}
          onClose={() => undefined}
          onSaved={() => undefined}
          initialFile={INITIAL_FILE}
          continuousInputStrategy="legacy"
        />,
      );
    });

    expect(eventCallCount(removeEventListenerSpy, waveform, 'wheel')).toBe(1);
    expect(eventCallCount(removeEventListenerSpy, waveform, 'mousedown')).toBe(
      1,
    );
    expect(eventCallCount(removeEventListenerSpy, canvas, 'mousemove')).toBe(1);
    expect(eventCallCount(removeEventListenerSpy, canvas, 'mouseleave')).toBe(
      1,
    );
    for (const [type, listener] of pointerListeners) {
      expect(windowRemoveEventListenerSpy).toHaveBeenCalledWith(type, listener);
    }
    expect(
      resizeObservers.some(({ disconnect }) =>
        disconnect.mock.calls.some(() => true),
      ),
    ).toBe(true);
  });

  it('frame 휠 입력은 delta를 누적하고 anchor 기준으로 zoom·pan을 min/max에 고정한다', async () => {
    await renderOpen(100, 'frame');
    const waveform = waveformHost();
    setWaveformRect(waveform);
    soundTrimMocks.schedulerPush.mockClear();

    const first = dispatchWheel(waveform, {
      clientX: 112,
      deltaY: -2_000,
    });
    const second = dispatchWheel(waveform, {
      clientX: 112,
      deltaY: -3_000,
    });
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(soundTrimMocks.schedulerPush).toHaveBeenCalledTimes(2);

    runLatestRaf();
    expect(soundTrimMocks.drawWaveform).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(Float32Array),
      0,
      1,
      null,
      0.46875,
      0.53125,
    );

    dispatchWheel(waveform, { clientX: 12, deltaY: 10_000 });
    runLatestRaf();
    expect(soundTrimMocks.drawWaveform).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(Float32Array),
      0,
      1,
      null,
      0,
      1,
    );
  });

  it('middle pan 종료는 최종 frame을 flush한 뒤 cancel·cursor unlock·listener 해제를 수행한다', async () => {
    await renderOpen(100, 'frame');
    const waveform = waveformHost();
    setWaveformRect(waveform);

    dispatchWheel(waveform, { clientX: 112, deltaY: -10_000 });
    runLatestRaf();
    soundTrimMocks.schedulerPush.mockClear();
    soundTrimMocks.schedulerFlush.mockClear();
    soundTrimMocks.schedulerCancel.mockClear();
    soundTrimMocks.endDragCursor.mockClear();
    removeEventListenerSpy.mockClear();
    windowRemoveEventListenerSpy.mockClear();

    dispatchMouse(waveform, 'mousedown', { button: 1, clientX: 112 });
    expect(soundTrimMocks.beginDragCursor).toHaveBeenLastCalledWith('grabbing');
    expect(waveform.style.cursor).toBe('grabbing');
    dispatchMouse(document, 'mousemove', { clientX: 162 });
    dispatchMouse(document, 'mouseup', {});

    expect(soundTrimMocks.drawWaveform.mock.calls.at(-1)?.[5]).toBeCloseTo(
      0.453125,
    );
    expect(waveform.style.cursor).toBe('');
    expectCalledBefore(
      soundTrimMocks.schedulerFlush,
      soundTrimMocks.schedulerCancel,
    );
    expectCalledBefore(
      soundTrimMocks.schedulerCancel,
      soundTrimMocks.endDragCursor,
    );
    expect(
      soundTrimMocks.endDragCursor.mock.invocationCallOrder[0],
    ).toBeLessThan(
      firstEventCallOrder(removeEventListenerSpy, ['mousemove', 'mouseup']),
    );
    expect(
      soundTrimMocks.endDragCursor.mock.invocationCallOrder[0],
    ).toBeLessThan(
      firstEventCallOrder(windowRemoveEventListenerSpy, [
        'blur',
        'pointercancel',
      ]),
    );
  });

  it.each(['pointerup', 'pointercancel', 'blur'])(
    '%s 종료는 보류 중인 handle frame을 flush한 뒤 cursor와 listener를 정리한다',
    async (terminalEvent) => {
      await renderOpen(100, 'frame');
      const waveform = waveformHost();
      setWaveformRect(waveform);
      soundTrimMocks.schedulerFlush.mockClear();
      soundTrimMocks.schedulerCancel.mockClear();
      soundTrimMocks.unlockCustomCursor.mockClear();
      windowRemoveEventListenerSpy.mockClear();

      dispatchMouse(waveform, 'pointerdown', { button: 0, clientX: 12 });
      expect(soundTrimMocks.lockCustomCursor).toHaveBeenCalledWith(
        'ew-resize',
        expect.any(MouseEvent),
      );
      dispatchMouse(window, 'pointermove', { clientX: 150 });
      dispatchMouse(window, terminalEvent, {});

      expect(soundTrimMocks.drawWaveform.mock.calls.at(-1)?.[2]).toBeCloseTo(
        0.69,
      );
      expectCalledBefore(
        soundTrimMocks.schedulerFlush,
        soundTrimMocks.schedulerCancel,
      );
      expectCalledBefore(
        soundTrimMocks.schedulerCancel,
        soundTrimMocks.unlockCustomCursor,
      );
      expect(
        soundTrimMocks.unlockCustomCursor.mock.invocationCallOrder[0],
      ).toBeLessThan(
        firstEventCallOrder(windowRemoveEventListenerSpy, [
          'pointermove',
          'pointerup',
          'pointercancel',
          'blur',
        ]),
      );
      for (const type of [
        'pointermove',
        'pointerup',
        'pointercancel',
        'blur',
      ]) {
        expect(eventCallCount(windowRemoveEventListenerSpy, window, type)).toBe(
          1,
        );
      }
    },
  );

  it('handle press는 가까운 핸들을 고르고 이동 ratio를 trim 범위에 clamp한다', async () => {
    await renderOpen();
    const waveform = waveformHost();
    setWaveformRect(waveform);

    dispatchMouse(waveform, 'pointerdown', { button: 0, clientX: 100 });
    dispatchMouse(window, 'pointermove', { clientX: 300 });
    dispatchMouse(window, 'pointerup', {});

    expect(soundTrimMocks.drawWaveform).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(Float32Array),
      1,
      1,
      null,
      0,
      1,
    );
  });

  it('두 handle hit 영역이 겹치면 midpoint 동률은 end, 왼쪽은 start를 고른다', async () => {
    await renderOpen();
    const waveform = waveformHost();
    setWaveformRect(waveform);

    dispatchMouse(waveform, 'pointerdown', { button: 0, clientX: 12 });
    dispatchMouse(window, 'pointermove', { clientX: 204 });
    dispatchMouse(window, 'pointerup', {});

    dispatchMouse(waveform, 'pointerdown', { button: 0, clientX: 208 });
    dispatchMouse(window, 'pointermove', { clientX: 150 });
    dispatchMouse(window, 'pointerup', {});
    expect(soundTrimMocks.drawWaveform.mock.calls.at(-1)?.slice(2, 4)).toEqual([
      0.96, 0.96,
    ]);

    dispatchMouse(waveform, 'pointerdown', { button: 0, clientX: 204 });
    dispatchMouse(window, 'pointermove', { clientX: 212 });
    dispatchMouse(window, 'pointerup', {});
    dispatchMouse(waveform, 'pointerdown', { button: 0, clientX: 207 });
    dispatchMouse(window, 'pointermove', { clientX: 150 });
    dispatchMouse(window, 'pointerup', {});
    expect(soundTrimMocks.drawWaveform.mock.calls.at(-1)?.slice(2, 4)).toEqual([
      0.69, 1,
    ]);
  });

  it('close reset 뒤 재오픈은 기존 host listener를 해제하고 새 host의 view·trim 기본값을 사용한다', async () => {
    await renderOpen(100, 'frame');
    const firstWaveform = waveformHost();
    setWaveformRect(firstWaveform);
    dispatchWheel(firstWaveform, { clientX: 112, deltaY: -10_000 });
    runLatestRaf();
    dispatchMouse(firstWaveform, 'pointerdown', {
      button: 0,
      clientX: 100,
    });
    dispatchMouse(window, 'pointerup', {});

    await act(async () => {
      root.render(
        <SoundTrimModal
          isOpen={false}
          onClose={() => undefined}
          onSaved={() => undefined}
          initialFile={INITIAL_FILE}
          continuousInputStrategy="frame"
        />,
      );
    });
    expect(eventCallCount(removeEventListenerSpy, firstWaveform, 'wheel')).toBe(
      1,
    );

    await renderOpen(100, 'frame');
    for (const frame of [...rafCallbacks.keys()]) {
      act(() => runRaf(frame));
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const secondWaveform = waveformHost();
    expect(secondWaveform).not.toBe(firstWaveform);
    expect(eventCallCount(addEventListenerSpy, secondWaveform, 'wheel')).toBe(
      1,
    );
    expect(soundTrimMocks.drawWaveform).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(Float32Array),
      0,
      1,
      null,
      0,
      1,
    );
  });

  it('close 전환은 playback·pointer를 reset한다', async () => {
    await renderOpen();
    act(() => playbackButton().click());
    const waveform = waveformHost();
    act(() => {
      waveform.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
        }),
      );
    });
    const playing = contexts[0];

    await act(async () => {
      root.render(
        <SoundTrimModal
          isOpen={false}
          onClose={() => undefined}
          onSaved={() => undefined}
          initialFile={INITIAL_FILE}
          continuousInputStrategy="legacy"
        />,
      );
    });
    expect(playing.source.stop).toHaveBeenCalledOnce();
    expect(playing.close).toHaveBeenCalledOnce();
  });

  it('열린 상태 직접 unmount는 기존처럼 playback·pointer를 정리하지 않는다', async () => {
    await renderOpen();
    act(() => playbackButton().click());
    const leakedWaveform = waveformHost();
    const pointerListenerStart = windowAddEventListenerSpy.mock.calls.length;
    act(() => {
      leakedWaveform.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
        }),
      );
    });
    // 핸들 프레스가 첫 재생을 정지하므로 pointer 세션을 유지한 채 다시 재생
    act(() => playbackButton().click());
    const stillPlaying = contexts[1];
    const pointerListeners = windowAddEventListenerSpy.mock.calls
      .slice(pointerListenerStart)
      .filter(([type]) =>
        ['pointermove', 'pointerup', 'pointercancel', 'blur'].includes(type),
      );
    windowRemoveEventListenerSpy.mockClear();

    await act(async () => root.unmount());
    mounted = false;

    expect(stillPlaying.source.stop).not.toHaveBeenCalled();
    expect(stillPlaying.close).not.toHaveBeenCalled();
    for (const [type, listener] of pointerListeners) {
      expect(windowRemoveEventListenerSpy).not.toHaveBeenCalledWith(
        type,
        listener,
      );
    }
  });
});
