import { describe, expect, it } from 'vitest';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  clamp,
  encodeWavBase64,
  extractWaveformPeaks,
  formatSecLabel,
  stripExtension,
} from './soundTrimModel';

describe('soundTrimModel', () => {
  it('시간·범위·파일 이름 표시를 정규화한다', () => {
    expect(formatSecLabel(1234)).toBe('1.23s');
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(stripExtension('sample.take.wav')).toBe('sample.take');
    expect(stripExtension('.hidden')).toBe('.hidden');
  });

  it('첫 채널을 고정 개수 peak 블록으로 축약한다', () => {
    const data = new Float32Array([0.1, -0.8, 0.4, -0.2]);
    const buffer = {
      getChannelData: () => data,
    } as unknown as AudioBuffer;
    expect([...extractWaveformPeaks(buffer, 2)]).toEqual([
      expect.closeTo(0.8),
      expect.closeTo(0.4),
    ]);
  });

  it('ArrayBuffer base64 왕복과 PCM WAV 헤더·트림 프레임을 보존한다', () => {
    const bytes = new Uint8Array([0, 1, 127, 255]);
    expect(
      new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(bytes.buffer))),
    ).toEqual(bytes);

    const audio = {
      numberOfChannels: 1,
      sampleRate: 48_000,
      getChannelData: () => new Float32Array([-1, 0.5, 1]),
    } as unknown as AudioBuffer;
    const wav = base64ToArrayBuffer(encodeWavBase64(audio, 1, 3));
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(wav, offset, length));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(16_383);
    expect(view.getInt16(46, true)).toBe(32_767);
  });
});
