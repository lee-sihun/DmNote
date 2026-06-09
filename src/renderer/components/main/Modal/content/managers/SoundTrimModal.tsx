import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';
import {
  getCursor,
  setCustomCursorHover,
  lockCustomCursor,
  unlockCustomCursor,
} from '@utils/grid/cursorUtils';

interface SoundTrimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (soundPath: string) => void;
  previewVolume?: number;
  editingSoundPath?: string | null;
  editingTrimStartRatio?: number;
  editingTrimEndRatio?: number;
  editingDisplayName?: string;
  initialFile?: File | null;
}

type DragTarget = 'start' | 'end' | null;

const WAVEFORM_PEAK_COUNT = 1600;
const WAVEFORM_PAD_X = 12;
const HANDLE_PICK_PX = 10;
const MIN_VIEW_ZOOM = 1;
const MAX_VIEW_ZOOM = 16;

function formatSecLabel(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function createAudioContext(): AudioContext {
  const ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  return new ctor();
}

async function decodeAudioFromArrayBuffer(
  buffer: ArrayBuffer,
): Promise<AudioBuffer> {
  const context = createAudioContext();
  try {
    return await context.decodeAudioData(buffer.slice(0));
  } finally {
    void context.close();
  }
}

function extractWaveformPeaks(
  buffer: AudioBuffer,
  peakCount = WAVEFORM_PEAK_COUNT,
): Float32Array {
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
      if (sample > max) {
        max = sample;
      }
    }

    peaks[i] = max;
  }

  return peaks;
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  startRatio: number,
  endRatio: number,
  playbackRatio: number | null = null,
  viewStart: number = 0,
  viewEnd: number = 1,
) {
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

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padX = WAVEFORM_PAD_X;
  const drawableW = width - padX * 2;
  const minBarHeight = 1;
  const centerY = height / 2;
  const viewSpan = Math.max(1e-9, viewEnd - viewStart);

  const audioToX = (ratio: number) =>
    padX + ((ratio - viewStart) / viewSpan) * drawableW;

  const startX = audioToX(startRatio);
  const endX = audioToX(endRatio);

  // 트림 범위 하이라이트 (보이는 영역 제한)
  const visStartX = Math.max(padX, startX);
  const visEndX = Math.min(padX + drawableW, endX);
  if (visEndX > visStartX) {
    ctx.fillStyle = 'rgba(69, 155, 248, 0.10)';
    ctx.fillRect(visStartX, 0, visEndX - visStartX, height);
  }

  for (let px = 0; px < drawableW; px += 1) {
    const audioRatio = viewStart + (px / Math.max(1, drawableW - 1)) * viewSpan;
    const peakIndex = Math.floor(clamp(audioRatio, 0, 1) * (peaks.length - 1));
    const amplitude = peaks[peakIndex] ?? 0;
    const barHeight = Math.max(minBarHeight, amplitude * (height - 4));
    const y = centerY - barHeight / 2;
    const x = padX + px;

    const inRange = x >= startX && x <= endX;
    ctx.fillStyle = inRange ? '#9EC4FF' : '#545868';
    ctx.fillRect(x, y, 1, barHeight);
  }

  const handlePadY = 6;
  const handleLineW = 3;
  const handleLineH = height - handlePadY * 2;
  const handleLineR = 1.5;
  const gripW = 7;
  const gripH = 22;
  const gripR = 3;

  const drawHandle = (cx: number) => {
    ctx.fillStyle = '#FFFFFF';
    roundRect(
      ctx,
      cx - handleLineW / 2,
      handlePadY,
      handleLineW,
      handleLineH,
      handleLineR,
    );
    ctx.fill();

    roundRect(ctx, cx - gripW / 2, height / 2 - gripH / 2, gripW, gripH, gripR);
    ctx.fill();
  };

  // 보이는 캔버스 영역 내 핸들만 렌더
  const handleMargin = gripW;
  if (
    startX >= padX - handleMargin &&
    startX <= padX + drawableW + handleMargin
  ) {
    drawHandle(startX);
  }
  if (endX >= padX - handleMargin && endX <= padX + drawableW + handleMargin) {
    drawHandle(endX);
  }

  // 재생 위치 표시기
  if (playbackRatio !== null) {
    const playX = audioToX(playbackRatio);
    if (playX >= padX && playX <= padX + drawableW) {
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = 0.9;
      ctx.fillRect(playX - 0.5, 0, 1, height);
      ctx.globalAlpha = 1;
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function encodeWavBase64(
  source: AudioBuffer,
  startFrame: number,
  endFrame: number,
): string {
  const channels = source.numberOfChannels;
  const sampleRate = source.sampleRate;
  const frameCount = Math.max(1, endFrame - startFrame);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
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
  view.setUint32(28, byteRate, true);
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
      const sample = channelData[channel][sourceFrame] ?? 0;
      const clamped = clamp(sample, -1, 1);
      const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }

  return arrayBufferToBase64(buffer);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

const SoundTrimModal = ({
  isOpen,
  onClose,
  onSaved,
  previewVolume = 100,
  editingSoundPath,
  editingTrimStartRatio,
  editingTrimEndRatio,
  editingDisplayName,
  initialFile,
}: SoundTrimModalProps) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragTargetRef = useRef<DragTarget>(null);

  const isEditMode = !!editingSoundPath;

  const [originalFileName, setOriginalFileName] = useState('');
  const [soundName, setSoundName] = useState('');
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array());
  const [startRatio, setStartRatio] = useState(0);
  const [endRatio, setEndRatio] = useState(1);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPanRatio, setViewPanRatio] = useState(0);

  const originalFileDataRef = useRef<{
    base64: string;
    extension: string;
  } | null>(null);

  const audioBufferRef = useRef(audioBuffer);
  audioBufferRef.current = audioBuffer;

  const playContextRef = useRef<AudioContext | null>(null);
  const playSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playDurationSecRef = useRef(0);
  const playStartRatioRef = useRef(0);
  const playEndRatioRef = useRef(1);
  const animFrameRef = useRef(0);
  const pausedAtRatioRef = useRef<number | null>(null);
  const middleDragCleanupRef = useRef<(() => void) | null>(null);
  const handleDragCleanupRef = useRef<(() => void) | null>(null);

  const durationMs = audioBuffer ? audioBuffer.duration * 1000 : 0;
  const trimDurationMs = Math.max(
    0,
    durationMs * endRatio - durationMs * startRatio,
  );

  const canSubmit =
    !!audioBuffer && !isDecoding && !isSaving && soundName.trim().length > 0;

  const viewStart = viewPanRatio;
  const viewEnd = Math.min(1, viewPanRatio + 1 / viewZoom);

  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const startRatioRef = useRef(startRatio);
  startRatioRef.current = startRatio;
  const endRatioRef = useRef(endRatio);
  endRatioRef.current = endRatio;
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const viewEndRef = useRef(viewEnd);
  viewEndRef.current = viewEnd;

  const teardownAudio = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (playSourceRef.current) {
      playSourceRef.current.onended = null;
      try {
        playSourceRef.current.stop();
      } catch {
        /* 이미 정지됨 */
      }
      playSourceRef.current = null;
    }
    if (playContextRef.current) {
      void playContextRef.current.close();
      playContextRef.current = null;
    }
    setIsPlaying(false);
  };

  const redrawWaveformStatic = (pausedRatio?: number | null) => {
    const canvas = canvasRef.current;
    const currentPeaks = peaksRef.current;
    if (canvas && currentPeaks.length > 0) {
      drawWaveform(
        canvas,
        currentPeaks,
        startRatioRef.current,
        endRatioRef.current,
        pausedRatio ?? null,
        viewStartRef.current,
        viewEndRef.current,
      );
    }
  };

  // 일시정지: 현재 위치 저장 및 일시정지 위치에 표시기 표시
  const pausePlayback = () => {
    const playCtx = playContextRef.current;
    if (playCtx) {
      const elapsed = playCtx.currentTime - playStartCtxTimeRef.current;
      const totalDur = playDurationSecRef.current;
      const progress = totalDur > 0 ? clamp(elapsed / totalDur, 0, 1) : 0;
      const sR = playStartRatioRef.current;
      const eR = playEndRatioRef.current;
      pausedAtRatioRef.current = sR + progress * (eR - sR);
    }
    teardownAudio();
    redrawWaveformStatic(pausedAtRatioRef.current);
  };

  // 완전 정지: 범위 시작 위치로 초기화
  const stopPlayback = () => {
    pausedAtRatioRef.current = null;
    teardownAudio();
    redrawWaveformStatic();
  };

  const handlePlay = () => {
    if (!audioBuffer) return;

    // 재생 중 → 일시정지
    if (playSourceRef.current) {
      pausePlayback();
      return;
    }

    const ctx = createAudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = clamp(previewVolume / 100, 0, 2);
    gainNode.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    const sR = startRatioRef.current;
    const eR = endRatioRef.current;

    // 일시정지 위치부터 재개, 또는 범위 시작부터 재생
    const resumeRatio = pausedAtRatioRef.current ?? sR;
    const offsetSec = audioBuffer.duration * resumeRatio;
    const remainingSec = audioBuffer.duration * (eR - resumeRatio);
    pausedAtRatioRef.current = null;

    source.onended = () => {
      // 자연 종료 → 위치 초기화
      stopPlayback();
    };

    playContextRef.current = ctx;
    playSourceRef.current = source;
    playStartCtxTimeRef.current = ctx.currentTime;
    playDurationSecRef.current = remainingSec;
    playStartRatioRef.current = resumeRatio;
    playEndRatioRef.current = eR;
    setIsPlaying(true);

    source.start(0, offsetSec, remainingSec);

    // 재생 표시기 애니메이션 루프 시작
    const animate = () => {
      const playCtx = playContextRef.current;
      const canvas = canvasRef.current;
      const currentPeaks = peaksRef.current;
      if (!playCtx || !canvas || currentPeaks.length === 0) return;

      const elapsed = playCtx.currentTime - playStartCtxTimeRef.current;
      const totalDur = playDurationSecRef.current;
      const progress = totalDur > 0 ? clamp(elapsed / totalDur, 0, 1) : 0;
      const animSR = playStartRatioRef.current;
      const animER = playEndRatioRef.current;
      const playbackRatio = animSR + progress * (animER - animSR);

      drawWaveform(
        canvas,
        currentPeaks,
        startRatioRef.current,
        endRatioRef.current,
        playbackRatio,
        viewStartRef.current,
        viewEndRef.current,
      );

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };
    animFrameRef.current = requestAnimationFrame(animate);
  };

  const resetStateImpl = useRef<() => void>(() => {});
  resetStateImpl.current = () => {
    pausedAtRatioRef.current = null;
    originalFileDataRef.current = null;
    stopPlayback();
    setOriginalFileName('');
    setSoundName('');
    setAudioBuffer(null);
    setPeaks(new Float32Array());
    setStartRatio(0);
    setEndRatio(1);
    setViewZoom(1);
    setViewPanRatio(0);
    setIsDecoding(false);
    setIsSaving(false);
    setErrorText('');
    dragTargetRef.current = null;
    middleDragCleanupRef.current?.();
    handleDragCleanupRef.current?.();
    setCustomCursorHover(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  const resetState = () => {
    resetStateImpl.current();
  };

  const closeModal = () => {
    resetState();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen]);

  const processFileImpl = useRef<
    (file: File, signal?: { cancelled: boolean }) => Promise<void>
  >(async () => {});
  processFileImpl.current = async (
    file: File,
    signal?: { cancelled: boolean },
  ) => {
    stopPlayback();
    setErrorText('');
    setIsDecoding(true);
    setViewZoom(1);
    setViewPanRatio(0);
    setOriginalFileName(file.name);
    setSoundName(stripExtension(file.name));

    try {
      const arrayBuffer = await file.arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'wav';
      originalFileDataRef.current = {
        base64: arrayBufferToBase64(arrayBuffer),
        extension: ext,
      };

      const decoded = await decodeAudioFromArrayBuffer(arrayBuffer);
      if (signal?.cancelled) return;

      setAudioBuffer(decoded);
      setPeaks(extractWaveformPeaks(decoded));
      setStartRatio(0);
      setEndRatio(1);
    } catch (error) {
      if (signal?.cancelled) return;
      console.error('Failed to decode audio file:', error);
      setAudioBuffer(null);
      setPeaks(new Float32Array());
      setOriginalFileName('');
      setSoundName('');
      originalFileDataRef.current = null;
      setErrorText(t('soundTrimModal.decodeError'));
    } finally {
      if (!signal?.cancelled) {
        setIsDecoding(false);
      }
    }
  };
  const processFile = async (file: File, signal?: { cancelled: boolean }) => {
    await processFileImpl.current(file, signal);
  };

  // 편집 모드: 백엔드에서 원본 오디오 로드
  useEffect(() => {
    if (!isOpen || !editingSoundPath) return;

    let cancelled = false;
    setIsDecoding(true);
    setErrorText('');
    setViewZoom(1);
    setViewPanRatio(0);
    setSoundName(editingDisplayName || '');
    setOriginalFileName(editingDisplayName || '');

    (async () => {
      try {
        const result = await window.api.sound.loadOriginal(editingSoundPath);
        if (cancelled) return;

        if (!result.success || !result.audioBase64) {
          throw new Error(result.error || 'Failed to load original audio');
        }

        const arrayBuffer = base64ToArrayBuffer(result.audioBase64);
        const decoded = await decodeAudioFromArrayBuffer(arrayBuffer);
        if (cancelled) return;

        setAudioBuffer(decoded);
        setPeaks(extractWaveformPeaks(decoded));
        setStartRatio(editingTrimStartRatio ?? 0);
        setEndRatio(editingTrimEndRatio ?? 1);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load original audio:', error);
          setErrorText(t('soundTrimModal.loadOriginalError'));
        }
      } finally {
        if (!cancelled) {
          setIsDecoding(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    editingSoundPath,
    editingTrimStartRatio,
    editingTrimEndRatio,
    editingDisplayName,
    t,
  ]);

  // initialFile 제공 시 처리 (SoundManagerModal 파일 선택기에서)
  useEffect(() => {
    if (!isOpen || !initialFile || isEditMode) return;
    const signal = { cancelled: false };
    void processFile(initialFile, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [isOpen, initialFile, isEditMode]);

  useEffect(() => {
    if (!isOpen) return;
    if (isPlaying) return; // 재생 중에는 애니메이션 루프가 렌더 담당
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    drawWaveform(
      canvas,
      peaks,
      startRatio,
      endRatio,
      pausedAtRatioRef.current,
      viewStart,
      viewEnd,
    );
  }, [isOpen, isPlaying, peaks, startRatio, endRatio, viewStart, viewEnd]);

  useEffect(() => {
    if (!isOpen) return;
    const node = waveformRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      if (!isPlaying) {
        redrawWaveformStatic(pausedAtRatioRef.current);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [isOpen, isPlaying]);

  const selectFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void processFile(file);
  };

  // 휠 줌: 마우스 위치 기준 줌 인/아웃
  const viewZoomRef = useRef(viewZoom);
  viewZoomRef.current = viewZoom;
  const viewPanRatioRef = useRef(viewPanRatio);
  viewPanRatioRef.current = viewPanRatio;
  const isWheelProcessingRef = useRef(false);

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!audioBuffer) return;
    if (isWheelProcessingRef.current) return;
    isWheelProcessingRef.current = true;
    requestAnimationFrame(() => {
      isWheelProcessingRef.current = false;
    });

    const host = waveformRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const drawableW = rect.width - WAVEFORM_PAD_X * 2;
    const mouseScreenRatio = clamp(
      (e.clientX - rect.left - WAVEFORM_PAD_X) / Math.max(1, drawableW),
      0,
      1,
    );

    const curZoom = viewZoomRef.current;
    const curPan = viewPanRatioRef.current;
    const curViewSpan = 1 / curZoom;
    const mouseAudioRatio = curPan + mouseScreenRatio * curViewSpan;

    const zoomFactor = e.deltaY > 0 ? 0.85 : 1.18;
    const newZoom = clamp(curZoom * zoomFactor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    const newViewSpan = 1 / newZoom;

    let newPan = mouseAudioRatio - mouseScreenRatio * newViewSpan;
    newPan = clamp(newPan, 0, Math.max(0, 1 - newViewSpan));

    setViewZoom(newZoom);
    setViewPanRatio(newPan);
  };

  useEffect(() => {
    if (!isOpen) return;
    const node = waveformRef.current;
    if (!node) return;
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  });

  // 중간 버튼 드래그: 줌 시 수평 패닝
  const handleMiddleDown = (e: MouseEvent) => {
    if (e.button !== 1) return;
    if (!audioBufferRef.current) return;
    e.preventDefault();

    const host = waveformRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const drawableW = rect.width - WAVEFORM_PAD_X * 2;

    const startX = e.clientX;
    const startPan = viewPanRatioRef.current;
    const curZoom = viewZoomRef.current;
    const viewSpan = 1 / curZoom;

    setCustomCursorHover(null);
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';
    host.style.cursor = 'grabbing';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      let newPan = startPan - (deltaX / Math.max(1, drawableW)) * viewSpan;
      newPan = clamp(newPan, 0, Math.max(0, 1 - viewSpan));
      setViewPanRatio(newPan);
    };

    const cleanup = () => {
      host.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', cleanup);
      middleDragCleanupRef.current = null;
    };

    middleDragCleanupRef.current = cleanup;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', cleanup);
  };

  useEffect(() => {
    if (!isOpen) return;
    const node = waveformRef.current;
    if (!node) return;
    node.addEventListener('mousedown', handleMiddleDown);
    return () => {
      node.removeEventListener('mousedown', handleMiddleDown);
      middleDragCleanupRef.current?.();
    };
  }, [isOpen]);

  // 커서 overlay 루트가 모달 포털보다 DOM 순서상 위에 위치하도록 보장
  useEffect(() => {
    if (!isOpen) return;
    const overlay = document.getElementById('dmn-cursor-overlay');
    if (overlay?.parentNode) {
      overlay.parentNode.appendChild(overlay);
    }
  }, [isOpen]);

  // 캔버스 커서 hover: macOS overlay 커서용 네이티브 addEventListener
  useEffect(() => {
    if (!isOpen || !audioBuffer) return;
    const canvas = canvasRef.current;
    const host = waveformRef.current;
    if (!canvas || !host) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (dragTargetRef.current || middleDragCleanupRef.current) return;
      const rect = host.getBoundingClientRect();
      const drawableW = rect.width - WAVEFORM_PAD_X * 2;
      const x = e.clientX - rect.left;
      const vStart = viewStartRef.current;
      const vEnd = viewEndRef.current;
      const viewSpan = vEnd - vStart;
      const sR = startRatioRef.current;
      const eR = endRatioRef.current;
      const startHandleX =
        WAVEFORM_PAD_X + ((sR - vStart) / viewSpan) * drawableW;
      const endHandleX =
        WAVEFORM_PAD_X + ((eR - vStart) / viewSpan) * drawableW;
      const nearHandle =
        Math.abs(x - startHandleX) <= HANDLE_PICK_PX ||
        Math.abs(x - endHandleX) <= HANDLE_PICK_PX;

      // macOS: SVG overlay 커서 / Windows: getCursor CSS 폴백
      setCustomCursorHover(nearHandle ? 'ew-resize' : null, e);
      canvas.style.cursor = nearHandle ? getCursor('ew-resize') : '';
    };

    const handleMouseLeave = () => {
      if (!dragTargetRef.current && !middleDragCleanupRef.current) {
        setCustomCursorHover(null);
        canvas.style.cursor = '';
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      setCustomCursorHover(null);
    };
  }, [isOpen, audioBuffer]);

  const updateFromClientX = (clientX: number, target: DragTarget) => {
    const host = waveformRef.current;
    if (!host || !target) return;
    const rect = host.getBoundingClientRect();
    const drawableW = rect.width - WAVEFORM_PAD_X * 2;
    const screenRatio =
      (clientX - rect.left - WAVEFORM_PAD_X) / Math.max(1, drawableW);
    const vStart = viewStartRef.current;
    const vEnd = viewEndRef.current;
    const ratio = clamp(vStart + screenRatio * (vEnd - vStart), 0, 1);

    if (target === 'start') {
      setStartRatio(clamp(ratio, 0, endRatioRef.current));
    } else if (target === 'end') {
      setEndRatio(clamp(ratio, startRatioRef.current, 1));
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const target = dragTargetRef.current;
    if (!target) return;
    updateFromClientX(event.clientX, target);
  };

  const handlePointerUp = () => {
    handleDragCleanupRef.current?.();
  };

  const handleWaveformPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    if (!audioBuffer) return;
    const host = waveformRef.current;
    if (!host) return;

    // 핸들 드래그 시 재생 중지 및 일시정지 위치 초기화
    if (playSourceRef.current) {
      teardownAudio();
    }
    pausedAtRatioRef.current = null;

    const rect = host.getBoundingClientRect();
    const drawableW = rect.width - WAVEFORM_PAD_X * 2;
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const vStart = viewStartRef.current;
    const vEnd = viewEndRef.current;
    const viewSpan = vEnd - vStart;
    const sR = startRatioRef.current;
    const eR = endRatioRef.current;
    const startX = WAVEFORM_PAD_X + ((sR - vStart) / viewSpan) * drawableW;
    const endX = WAVEFORM_PAD_X + ((eR - vStart) / viewSpan) * drawableW;

    const pickStart = Math.abs(x - startX) <= HANDLE_PICK_PX;
    const pickEnd = Math.abs(x - endX) <= HANDLE_PICK_PX;

    let nextTarget: DragTarget;
    if (pickStart && pickEnd) {
      nextTarget = x < (startX + endX) / 2 ? 'start' : 'end';
    } else if (pickStart) {
      nextTarget = 'start';
    } else if (pickEnd) {
      nextTarget = 'end';
    } else {
      nextTarget = Math.abs(x - startX) < Math.abs(x - endX) ? 'start' : 'end';
    }

    dragTargetRef.current = nextTarget;
    lockCustomCursor('ew-resize', event.nativeEvent as unknown as MouseEvent);
    updateFromClientX(event.clientX, nextTarget);

    const registeredMove = handlePointerMove;
    const registeredUp = handlePointerUp;

    handleDragCleanupRef.current = () => {
      dragTargetRef.current = null;
      unlockCustomCursor();
      window.removeEventListener('pointermove', registeredMove);
      window.removeEventListener('pointerup', registeredUp);
      handleDragCleanupRef.current = null;
    };

    window.addEventListener('pointermove', registeredMove);
    window.addEventListener('pointerup', registeredUp);
  };

  const handleSave = async () => {
    if (!audioBuffer || isSaving || isDecoding) return;
    stopPlayback();
    setErrorText('');
    setIsSaving(true);

    try {
      const startFrame = Math.floor(audioBuffer.length * startRatio);
      const endFrame = Math.max(
        startFrame + 1,
        Math.floor(audioBuffer.length * endRatio),
      );
      const wavBase64 = encodeWavBase64(audioBuffer, startFrame, endFrame);
      const trimmedName = soundName.trim() || undefined;

      if (isEditMode && editingSoundPath) {
        // 편집 모드: 기존 사운드 업데이트
        const response = await window.api.sound.updateProcessedWav(
          editingSoundPath,
          wavBase64,
          startRatio,
          endRatio,
          trimmedName,
        );

        if (!response.success) {
          throw new Error(
            response.error || t('soundTrimModal.saveErrorDefault'),
          );
        }

        onSaved(editingSoundPath);
        resetState();
      } else {
        // 생성 모드: 새 사운드 + 원본 저장
        const origData = originalFileDataRef.current;
        const response = await window.api.sound.saveProcessedWav(
          wavBase64,
          trimmedName,
          origData?.base64,
          origData?.extension,
          startRatio,
          endRatio,
        );

        if (!response.success || !response.soundPath) {
          throw new Error(
            response.error || t('soundTrimModal.saveErrorDefault'),
          );
        }

        onSaved(response.soundPath);
        resetState();
      }
    } catch (error) {
      console.error('Failed to save processed sound:', error);
      setErrorText(t('soundTrimModal.saveErrorFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const headerLabel = (() => {
    if (!audioBuffer) {
      if (isDecoding) {
        return isEditMode
          ? t('soundTrimModal.statusLoading')
          : t('soundTrimModal.statusDecoding');
      }
      return t('soundTrimModal.statusWaiting');
    }
    return t('soundTrimModal.statusReady');
  })();

  const headerTitle = isEditMode
    ? editingDisplayName || t('soundTrimModal.editTitle')
    : originalFileName || t('soundTrimModal.defaultTitle');

  if (!isOpen) return null;

  return (
    <Modal onClick={closeModal}>
      <div
        className="w-[340px] max-w-[calc(100vw-80px)] flex flex-col bg-[#1A191E] rounded-[10px] border border-[#2A2A30] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 헤더 바 */}
        <div className="h-[37px] bg-[#2A2A30] border-b border-[#3A3943] px-[12px] flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-[8px]">
            <span className="px-[6px] h-[18px] rounded-[4px] border border-[#3A3943] bg-[#1A191E] text-[10px] leading-[18px] font-semibold tracking-[0.2px] text-[#8CC2FF]">
              Sound
            </span>
            <span className="truncate text-[12px] leading-[16px] text-[#DBDEE8]">
              {headerTitle}
            </span>
          </div>
          <span className="text-[11px] leading-[14px] text-[#8A8D99]">
            {headerLabel}
          </span>
        </div>

        {/* 콘텐츠 영역 */}
        <div className="p-[12px] flex flex-col gap-[10px]">
          {/* 이름 입력 */}
          <div>
            <label className="block text-[11px] leading-[14px] text-[#8A8D99] mb-[4px]">
              {t('soundTrimModal.nameLabel')}
            </label>
            <input
              type="text"
              value={soundName}
              onChange={(e) => setSoundName(e.target.value)}
              placeholder={t('soundTrimModal.namePlaceholder')}
              className="w-full h-[30px] px-[10px] rounded-[7px] border border-[#3A3943] bg-[#1E1E1E] text-[12px] leading-[16px] text-[#DBDEE8] placeholder-[#6F6E7A] outline-none focus:border-[#459BF8] transition-colors"
              disabled={isSaving}
            />
          </div>

          {/* 파형 섹션 */}
          <div className="rounded-[8px] border border-[#3A3943] bg-[#141419] overflow-hidden">
            <div className="flex items-center h-[100px]">
              {/* 재생 버튼 */}
              <div className="w-[52px] h-full flex flex-col items-center justify-center gap-[4px]">
                <button
                  type="button"
                  className={`w-[30px] h-[30px] rounded-full flex items-center justify-center transition-colors ${
                    audioBuffer
                      ? 'bg-[#2A2A30] hover:bg-[#3A3A42] cursor-pointer'
                      : 'bg-[#1E1E24] cursor-default opacity-40'
                  }`}
                  onClick={handlePlay}
                  disabled={!audioBuffer}
                >
                  {isPlaying ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <rect
                        x="2"
                        y="1.5"
                        width="3"
                        height="9"
                        rx="0.75"
                        fill="#DBDEE8"
                      />
                      <rect
                        x="7"
                        y="1.5"
                        width="3"
                        height="9"
                        rx="0.75"
                        fill="#DBDEE8"
                      />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M3.5 1.8C3.5 1.49 3.84 1.3 4.1 1.47L10.1 5.67C10.34 5.83 10.34 6.17 10.1 6.33L4.1 10.53C3.84 10.7 3.5 10.51 3.5 10.2V1.8Z"
                        fill="#DBDEE8"
                      />
                    </svg>
                  )}
                </button>
                <span className="text-[10px] leading-[12px] text-[#6BC87C] font-medium tabular-nums">
                  {audioBuffer ? formatSecLabel(trimDurationMs) : '--'}
                </span>
              </div>

              {/* 파형 캔버스 */}
              <div
                ref={waveformRef}
                className="flex-1 h-full"
                onPointerDown={handleWaveformPointerDown}
              >
                {audioBuffer ? (
                  <canvas ref={canvasRef} className="w-full h-full block" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[11px] text-[#6F6E7A]">
                    {isDecoding
                      ? isEditMode
                        ? t('soundTrimModal.statusLoading')
                        : t('soundTrimModal.decodingMessage')
                      : t('soundTrimModal.emptyMessage')}
                  </div>
                )}
              </div>
            </div>
          </div>

          {errorText ? (
            <p className="text-[11px] leading-[14px] text-[#E6A7A7]">
              {errorText}
            </p>
          ) : null}
        </div>

        {/* 힌트 바 */}
        <div className="h-[28px] bg-[#2A2A30] border-t border-[#3A3943] px-[12px] flex items-center justify-between gap-[12px]">
          {!isEditMode ? (
            <button
              type="button"
              className="text-[11px] leading-[14px] text-[#8CC2FF] hover:text-[#ACCFFF] transition-colors"
              onClick={selectFile}
              disabled={isDecoding || isSaving}
            >
              {t('soundTrimModal.loadFile')}
            </button>
          ) : (
            <span />
          )}
          <p className="shrink-0 text-[11px] leading-[14px] text-[#8A8D99]">
            {t('soundTrimModal.dragHint')}
          </p>
        </div>

        {!isEditMode ? (
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileChange}
          />
        ) : null}

        {/* 푸터 */}
        <div className="bg-[#1A191E] border-t border-[#2A2A30] px-[12px] py-[10px] flex items-center justify-end gap-[10.5px]">
          <button
            type="button"
            className={`w-[120px] h-[30px] rounded-[7px] text-style-3 transition-colors ${
              canSubmit
                ? 'bg-[#2A2A30] text-[#DCDEE7] hover:bg-[#34343c]'
                : 'bg-[#222228] text-[#777986] cursor-not-allowed'
            }`}
            onClick={() => {
              void handleSave();
            }}
            disabled={!canSubmit}
          >
            {isSaving
              ? t('soundTrimModal.saving')
              : isEditMode
              ? t('soundTrimModal.submitEdit')
              : t('soundTrimModal.submit')}
          </button>
          <button
            type="button"
            className="px-[24px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3 transition-colors"
            onClick={closeModal}
            disabled={isSaving}
          >
            {t('soundTrimModal.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SoundTrimModal;
