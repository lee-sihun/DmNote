export const WAVEFORM_PEAK_COUNT = 1600;
export const WAVEFORM_PAD_X = 12;
export const SOUND_TRIM_HANDLE_PICK_PX = 10;
export const SOUND_TRIM_MIN_VIEW_ZOOM = 1;
export const SOUND_TRIM_MAX_VIEW_ZOOM = 16;

export type SoundTrimDragTarget = 'start' | 'end' | null;

interface SoundTrimWheelViewportInput {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  deltaY: number;
  viewZoom: number;
  viewPanRatio: number;
}

interface SoundTrimMiddlePanInput {
  clientX: number;
  startClientX: number;
  startPanRatio: number;
  drawableWidth: number;
  viewSpan: number;
}

interface SoundTrimHandleGeometryInput {
  rectWidth: number;
  viewStart: number;
  viewEnd: number;
  startRatio: number;
  endRatio: number;
}

interface SoundTrimClientRatioInput {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  viewStart: number;
  viewEnd: number;
}

export const formatSecLabel = (ms: number): string =>
  `${(ms / 1000).toFixed(2)}s`;

export const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const planSoundTrimWheelViewport = ({
  clientX,
  rectLeft,
  rectWidth,
  deltaY,
  viewZoom,
  viewPanRatio,
}: SoundTrimWheelViewportInput): {
  viewZoom: number;
  viewPanRatio: number;
} => {
  const drawableWidth = rectWidth - WAVEFORM_PAD_X * 2;
  const mouseScreenRatio = clamp(
    (clientX - rectLeft - WAVEFORM_PAD_X) / Math.max(1, drawableWidth),
    0,
    1,
  );
  const viewSpan = 1 / viewZoom;
  const mouseAudioRatio = viewPanRatio + mouseScreenRatio * viewSpan;
  const zoomFactor = Math.exp(-deltaY * 0.0018);
  const nextViewZoom = clamp(
    viewZoom * zoomFactor,
    SOUND_TRIM_MIN_VIEW_ZOOM,
    SOUND_TRIM_MAX_VIEW_ZOOM,
  );
  const nextViewSpan = 1 / nextViewZoom;
  const nextViewPanRatio = clamp(
    mouseAudioRatio - mouseScreenRatio * nextViewSpan,
    0,
    Math.max(0, 1 - nextViewSpan),
  );

  return {
    viewZoom: nextViewZoom,
    viewPanRatio: nextViewPanRatio,
  };
};

export const planSoundTrimMiddlePan = ({
  clientX,
  startClientX,
  startPanRatio,
  drawableWidth,
  viewSpan,
}: SoundTrimMiddlePanInput): number => {
  const deltaX = clientX - startClientX;
  const nextPanRatio =
    startPanRatio - (deltaX / Math.max(1, drawableWidth)) * viewSpan;
  return clamp(nextPanRatio, 0, Math.max(0, 1 - viewSpan));
};

export const getSoundTrimHandleGeometry = ({
  rectWidth,
  viewStart,
  viewEnd,
  startRatio,
  endRatio,
}: SoundTrimHandleGeometryInput): {
  drawableWidth: number;
  startX: number;
  endX: number;
} => {
  const drawableWidth = rectWidth - WAVEFORM_PAD_X * 2;
  const viewSpan = viewEnd - viewStart;
  return {
    drawableWidth,
    startX:
      WAVEFORM_PAD_X + ((startRatio - viewStart) / viewSpan) * drawableWidth,
    endX: WAVEFORM_PAD_X + ((endRatio - viewStart) / viewSpan) * drawableWidth,
  };
};

export const isNearSoundTrimHandle = (
  x: number,
  startX: number,
  endX: number,
): boolean =>
  Math.abs(x - startX) <= SOUND_TRIM_HANDLE_PICK_PX ||
  Math.abs(x - endX) <= SOUND_TRIM_HANDLE_PICK_PX;

export const pickSoundTrimDragTarget = (
  x: number,
  startX: number,
  endX: number,
): Exclude<SoundTrimDragTarget, null> => {
  const pickStart = Math.abs(x - startX) <= SOUND_TRIM_HANDLE_PICK_PX;
  const pickEnd = Math.abs(x - endX) <= SOUND_TRIM_HANDLE_PICK_PX;

  if (pickStart && pickEnd) {
    return x < (startX + endX) / 2 ? 'start' : 'end';
  }
  if (pickStart) return 'start';
  if (pickEnd) return 'end';
  return Math.abs(x - startX) < Math.abs(x - endX) ? 'start' : 'end';
};

export const getSoundTrimRatioFromClientX = ({
  clientX,
  rectLeft,
  rectWidth,
  viewStart,
  viewEnd,
}: SoundTrimClientRatioInput): number => {
  const drawableWidth = rectWidth - WAVEFORM_PAD_X * 2;
  const screenRatio =
    (clientX - rectLeft - WAVEFORM_PAD_X) / Math.max(1, drawableWidth);
  return clamp(viewStart + screenRatio * (viewEnd - viewStart), 0, 1);
};

export const createAudioContext = (): AudioContext => {
  const ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  return new ctor();
};

export const decodeAudioFromArrayBuffer = async (
  buffer: ArrayBuffer,
): Promise<AudioBuffer> => {
  const context = createAudioContext();
  try {
    return await context.decodeAudioData(buffer.slice(0));
  } finally {
    void context.close();
  }
};

export const extractWaveformPeaks = (
  buffer: AudioBuffer,
  peakCount = WAVEFORM_PEAK_COUNT,
): Float32Array => {
  const channelData = buffer.getChannelData(0);
  if (channelData.length === 0) {
    return new Float32Array(peakCount).fill(0);
  }

  const peaks = new Float32Array(peakCount);
  const blockSize = Math.max(1, Math.floor(channelData.length / peakCount));

  for (let i = 0; i < peakCount; i += 1) {
    const start = i * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    let max = 0;

    for (let j = start; j < end; j += 1) {
      const sample = Math.abs(channelData[j]);
      if (sample > max) max = sample;
    }

    peaks[i] = max;
  }

  return peaks;
};

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

export const drawWaveform = (
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  startRatio: number,
  endRatio: number,
  playbackRatio: number | null = null,
  viewStart: number = 0,
  viewEnd: number = 1,
) => {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const displayWidth = Math.max(1, Math.floor(width * dpr));
  const displayHeight = Math.max(1, Math.floor(height * dpr));

  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const tokens = getComputedStyle(canvas);
  const selectionFillColor = tokens
    .getPropertyValue('--ui-selection-fill')
    .trim();
  const selectionColor = tokens.getPropertyValue('--ui-selection').trim();
  const dimBarColor = tokens.getPropertyValue('--ui-fg-disabled').trim();
  const chromeColor = tokens.getPropertyValue('--ui-fg').trim();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const drawableW = width - WAVEFORM_PAD_X * 2;
  const centerY = height / 2;
  const viewSpan = Math.max(1e-9, viewEnd - viewStart);
  const audioToX = (ratio: number) =>
    WAVEFORM_PAD_X + ((ratio - viewStart) / viewSpan) * drawableW;
  const startX = audioToX(startRatio);
  const endX = audioToX(endRatio);
  const visStartX = Math.max(WAVEFORM_PAD_X, startX);
  const visEndX = Math.min(WAVEFORM_PAD_X + drawableW, endX);

  if (visEndX > visStartX) {
    ctx.fillStyle = selectionFillColor;
    ctx.fillRect(visStartX, 0, visEndX - visStartX, height);
  }

  for (let px = 0; px < drawableW; px += 1) {
    const audioRatio = viewStart + (px / Math.max(1, drawableW - 1)) * viewSpan;
    const peakIndex = Math.floor(clamp(audioRatio, 0, 1) * (peaks.length - 1));
    const amplitude = peaks[peakIndex] ?? 0;
    const barHeight = Math.max(1, amplitude * (height - 4));
    const x = WAVEFORM_PAD_X + px;
    ctx.fillStyle = x >= startX && x <= endX ? selectionColor : dimBarColor;
    ctx.fillRect(x, centerY - barHeight / 2, 1, barHeight);
  }

  const handlePadY = 6;
  const handleLineW = 3;
  const handleLineH = height - handlePadY * 2;
  const gripW = 7;
  const gripH = 22;
  const drawHandle = (cx: number) => {
    ctx.fillStyle = chromeColor;
    roundRect(
      ctx,
      cx - handleLineW / 2,
      handlePadY,
      handleLineW,
      handleLineH,
      1.5,
    );
    ctx.fill();
    roundRect(ctx, cx - gripW / 2, height / 2 - gripH / 2, gripW, gripH, 3);
    ctx.fill();
  };

  if (
    startX >= WAVEFORM_PAD_X - gripW &&
    startX <= WAVEFORM_PAD_X + drawableW + gripW
  ) {
    drawHandle(startX);
  }
  if (
    endX >= WAVEFORM_PAD_X - gripW &&
    endX <= WAVEFORM_PAD_X + drawableW + gripW
  ) {
    drawHandle(endX);
  }

  if (playbackRatio !== null) {
    const playX = audioToX(playbackRatio);
    if (playX >= WAVEFORM_PAD_X && playX <= WAVEFORM_PAD_X + drawableW) {
      ctx.fillStyle = chromeColor;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(playX - 0.5, 0, 1, height);
      ctx.globalAlpha = 1;
    }
  }
};

export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const encodeWavBase64 = (
  source: AudioBuffer,
  startFrame: number,
  endFrame: number,
): string => {
  const channels = source.numberOfChannels;
  const sampleRate = source.sampleRate;
  const frameCount = Math.max(1, endFrame - startFrame);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channelData = new Array(channels)
    .fill(null)
    .map((_, channel) => source.getChannelData(channel));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sourceFrame = startFrame + frame;
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(channelData[channel][sourceFrame] ?? 0, -1, 1);
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }

  return arrayBufferToBase64(buffer);
};

export const stripExtension = (name: string): string => {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
};
