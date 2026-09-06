import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ saveProcessedWav: vi.fn() }));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@api/modules/resources/resourceApi', () => ({ soundApi: api }));

import SoundTrimModal from './SoundTrimModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 내부 추출 모듈 대신 Web Audio·Canvas 경계에서 원본 디코딩부터 저장까지 검증
describe('SoundTrimModal 브라우저 API 계약', () => {
  let root: Root;
  let host: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let lifecycle: string[];
  let contexts: FakeAudioContext[];
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const samples = Float32Array.from({ length: 1000 }, (_, i) =>
    i % 2 === 0 ? 0.5 : -0.5,
  );
  const buffer = {
    duration: 10,
    length: samples.length,
    sampleRate: 100,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
  const initialFile = {
    name: 'sample.wav',
    arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
  } as File;

  class FakeAudioContext {
    id = contexts.length;
    currentTime = 0;
    destination = {};
    gain = { gain: { value: 0 }, connect: vi.fn() };
    source = {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(() => lifecycle.push(`stop:${this.id}`)),
    };
    constructor() {
      contexts.push(this);
    }
    decodeAudioData = vi.fn(async () => buffer);
    createGain = () => this.gain;
    createBufferSource = () => this.source;
    close = vi.fn(async () => {
      lifecycle.push(`close:${this.id}`);
    });
  }

  const renderModal = async (isOpen = true, previewVolume = 100) => {
    await act(async () => {
      root.render(
        <SoundTrimModal
          isOpen={isOpen}
          previewVolume={previewVolume}
          initialFile={initialFile}
          onSaved={onSaved}
          onClose={onClose}
        />,
      );
    });
    if (isOpen && !document.querySelector('[data-sound-waveform]')) {
      await act(async () => {
        for (const [id, callback] of [...frames]) {
          frames.delete(id);
          callback(performance.now());
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }
  };

  const play = () => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.querySelector('svg'),
    );
    expect(button).toBeDefined();
    act(() => button!.click());
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    frames = new Map();
    nextFrame = 0;
    lifecycle = [];
    contexts = [];
    onClose.mockClear();
    onSaved.mockClear();
    api.saveProcessedWav.mockReset().mockResolvedValue({
      success: true,
      soundPath: '/sounds/trimmed.wav',
    });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      lifecycle.push('cancel');
      frames.delete(id);
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const canvasContext = Object.fromEntries(
      [
        'setTransform',
        'clearRect',
        'fillRect',
        'beginPath',
        'moveTo',
        'lineTo',
        'quadraticCurveTo',
        'closePath',
        'fill',
      ].map((name) => [name, vi.fn()]),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('디코딩 context를 닫고 재생·일시정지·재개·닫힘을 순서대로 정산한다', async () => {
    await renderModal(true, 250);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].decodeAudioData).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    play();
    const first = contexts[1];
    expect(first.gain.gain.value).toBe(2);
    expect(first.source.start).toHaveBeenCalledWith(0, 0, 10);
    first.currentTime = 2;
    lifecycle = [];
    play();
    expect(lifecycle).toEqual(['cancel', 'stop:1', 'close:1']);
    expect(first.source.onended).toBeNull();
    await renderModal(true, 50);
    play();
    const resumed = contexts[2];
    expect(resumed.gain.gain.value).toBe(0.5);
    expect(resumed.source.start).toHaveBeenCalledWith(0, 2, 8);
    await renderModal(false);
    expect(resumed.source.stop).toHaveBeenCalledOnce();
    expect(resumed.close).toHaveBeenCalledOnce();
  });

  it('프레임 대기 중인 트림 끝점을 pointerup에 반영해 실제 WAV와 원본을 저장한다', async () => {
    await renderModal();
    const waveform = document.querySelector<HTMLDivElement>(
      '[data-sound-waveform]',
    )!;
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
    act(() => {
      waveform.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 12,
        }),
      );
      window.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 52,
        }),
      );
      window.dispatchEvent(
        new MouseEvent('pointerup', {
          bubbles: true,
          clientX: 52,
        }),
      );
    });
    const save = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'soundTrimModal.submit',
    );
    expect(save).toBeDefined();
    await act(async () => save!.click());
    expect(api.saveProcessedWav).toHaveBeenCalledOnce();
    const [encoded, name, original, extension, start, end] =
      api.saveProcessedWav.mock.calls[0];
    expect([name, original, extension, start, end]).toEqual([
      'sample',
      'AQIDBA==',
      'wav',
      0.2,
      1,
    ]);
    const bytes = Uint8Array.from(atob(encoded), (value) =>
      value.charCodeAt(0),
    );
    const wav = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(wav.getUint32(24, true)).toBe(100);
    expect(wav.getUint32(40, true)).toBe(800 * 2);
    expect(wav.getInt16(44, true)).toBe(16383);
    expect(wav.getInt16(46, true)).toBe(-16384);
    expect(onSaved).toHaveBeenCalledWith('/sounds/trimmed.wav');
    expect(onClose).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>('input[type="text"]')!.value,
    ).toBe('');
  });
});
