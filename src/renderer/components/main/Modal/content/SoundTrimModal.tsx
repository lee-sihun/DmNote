import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "@contexts/I18nContext";
import Modal from "../Modal";

interface SoundTrimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (soundPath: string) => void;
  previewVolume?: number;
}

type DragTarget = "start" | "end" | null;

const WAVEFORM_PEAK_COUNT = 1600;
const WAVEFORM_PAD_X = 12;
const HANDLE_PICK_PX = 10;
const MIN_TRIM_MS = 0;

function formatSecLabel(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function createAudioContext(): AudioContext {
  const ctor = window.AudioContext || (window as any).webkitAudioContext;
  return new ctor();
}

async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  const context = createAudioContext();
  try {
    return await context.decodeAudioData(bytes.slice(0));
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

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padX = WAVEFORM_PAD_X;
  const drawableW = width - padX * 2;
  const minBarHeight = 1;
  const centerY = height / 2;
  const startX = padX + startRatio * drawableW;
  const endX = padX + endRatio * drawableW;

  ctx.fillStyle = "rgba(69, 155, 248, 0.10)";
  ctx.fillRect(startX, 0, Math.max(1, endX - startX), height);

  for (let px = 0; px < drawableW; px += 1) {
    const peakIndex = Math.floor(
      (px / Math.max(1, drawableW - 1)) * (peaks.length - 1),
    );
    const amplitude = peaks[peakIndex] ?? 0;
    const barHeight = Math.max(minBarHeight, amplitude * (height - 4));
    const y = centerY - barHeight / 2;
    const x = padX + px;

    const inRange = x >= startX && x <= endX;
    ctx.fillStyle = inRange ? "#9EC4FF" : "#545868";
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
    ctx.fillStyle = "#FFFFFF";
    roundRect(ctx, cx - handleLineW / 2, handlePadY, handleLineW, handleLineH, handleLineR);
    ctx.fill();

    roundRect(ctx, cx - gripW / 2, height / 2 - gripH / 2, gripW, gripH, gripR);
    ctx.fill();
  };

  drawHandle(startX);
  drawHandle(endX);

  // Playback position indicator
  if (playbackRatio !== null) {
    const playX = padX + playbackRatio * drawableW;
    ctx.fillStyle = "#FFFFFF";
    ctx.globalAlpha = 0.9;
    ctx.fillRect(playX - 0.5, 0, 1, height);
    ctx.globalAlpha = 1;
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

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
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

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

export default function SoundTrimModal({
  isOpen,
  onClose,
  onSaved,
  previewVolume = 100,
}: SoundTrimModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragTargetRef = useRef<DragTarget>(null);

  const [originalFileName, setOriginalFileName] = useState("");
  const [soundName, setSoundName] = useState("");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array());
  const [startRatio, setStartRatio] = useState(0);
  const [endRatio, setEndRatio] = useState(1);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [errorText, setErrorText] = useState("");

  const playContextRef = useRef<AudioContext | null>(null);
  const playSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playDurationSecRef = useRef(0);
  const playStartRatioRef = useRef(0);
  const playEndRatioRef = useRef(1);
  const animFrameRef = useRef(0);
  const pausedAtRatioRef = useRef<number | null>(null);

  const durationMs = useMemo(
    () => (audioBuffer ? audioBuffer.duration * 1000 : 0),
    [audioBuffer],
  );
  const minRatioGap = useMemo(
    () => (durationMs > 0 ? Math.min(1, MIN_TRIM_MS / durationMs) : 0),
    [durationMs],
  );
  const trimDurationMs = Math.max(0, durationMs * endRatio - durationMs * startRatio);

  const canSubmit =
    !!audioBuffer &&
    !isDecoding &&
    !isSaving &&
    trimDurationMs >= MIN_TRIM_MS &&
    soundName.trim().length > 0;

  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const startRatioRef = useRef(startRatio);
  startRatioRef.current = startRatio;
  const endRatioRef = useRef(endRatio);
  endRatioRef.current = endRatio;

  const teardownAudio = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (playSourceRef.current) {
      playSourceRef.current.onended = null;
      try {
        playSourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      playSourceRef.current = null;
    }
    if (playContextRef.current) {
      void playContextRef.current.close();
      playContextRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const redrawWaveformStatic = useCallback((pausedRatio?: number | null) => {
    const canvas = canvasRef.current;
    const currentPeaks = peaksRef.current;
    if (canvas && currentPeaks.length > 0) {
      drawWaveform(
        canvas,
        currentPeaks,
        startRatioRef.current,
        endRatioRef.current,
        pausedRatio ?? null,
      );
    }
  }, []);

  // Pause: save current position and show indicator at paused position
  const pausePlayback = useCallback(() => {
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
  }, [teardownAudio, redrawWaveformStatic]);

  // Full stop: reset position to start of range
  const stopPlayback = useCallback(() => {
    pausedAtRatioRef.current = null;
    teardownAudio();
    redrawWaveformStatic();
  }, [teardownAudio, redrawWaveformStatic]);

  const handlePlay = useCallback(() => {
    if (!audioBuffer) return;

    // Currently playing → pause
    if (playSourceRef.current) {
      pausePlayback();
      return;
    }

    const ctx = createAudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = clamp(previewVolume / 100, 0, 1);
    gainNode.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    const sR = startRatioRef.current;
    const eR = endRatioRef.current;

    // Resume from paused position, or start from range beginning
    const resumeRatio = pausedAtRatioRef.current ?? sR;
    const offsetSec = audioBuffer.duration * resumeRatio;
    const remainingSec = audioBuffer.duration * (eR - resumeRatio);
    pausedAtRatioRef.current = null;

    source.onended = () => {
      // Natural end → reset position
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

    // Start animation loop for playback indicator
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

      drawWaveform(canvas, currentPeaks, startRatioRef.current, endRatioRef.current, playbackRatio);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };
    animFrameRef.current = requestAnimationFrame(animate);
  }, [audioBuffer, previewVolume, pausePlayback, stopPlayback]);

  const resetState = useCallback(() => {
    pausedAtRatioRef.current = null;
    stopPlayback();
    setOriginalFileName("");
    setSoundName("");
    setAudioBuffer(null);
    setPeaks(new Float32Array());
    setStartRatio(0);
    setEndRatio(1);
    setIsDecoding(false);
    setIsSaving(false);
    setErrorText("");
    dragTargetRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [stopPlayback]);

  const closeModal = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  useEffect(() => {
    if (!isOpen) return;
    if (isPlaying) return; // animation loop handles drawing during playback
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    drawWaveform(canvas, peaks, startRatio, endRatio, pausedAtRatioRef.current);
  }, [isOpen, isPlaying, peaks, startRatio, endRatio]);

  useEffect(() => {
    if (!isOpen) return;
    const node = waveformRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      if (isPlaying) return; // animation loop handles drawing during playback
      const canvas = canvasRef.current;
      if (!canvas || peaks.length === 0) return;
      drawWaveform(canvas, peaks, startRatio, endRatio, pausedAtRatioRef.current);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [isOpen, isPlaying, peaks, startRatio, endRatio]);

  const selectFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      stopPlayback();
      setErrorText("");
      setIsDecoding(true);
      setOriginalFileName(file.name);
      setSoundName(stripExtension(file.name));

      try {
        const decoded = await decodeAudioFile(file);
        setAudioBuffer(decoded);
        setPeaks(extractWaveformPeaks(decoded));
        setStartRatio(0);
        setEndRatio(1);
      } catch (error) {
        console.error("Failed to decode audio file:", error);
        setAudioBuffer(null);
        setPeaks(new Float32Array());
        setOriginalFileName("");
        setSoundName("");
        setErrorText(t("soundTrimModal.decodeError"));
      } finally {
        setIsDecoding(false);
      }
    },
    [stopPlayback],
  );

  const updateFromClientX = useCallback(
    (clientX: number, target: DragTarget) => {
      const host = waveformRef.current;
      if (!host || !target) return;
      const rect = host.getBoundingClientRect();
      const drawableW = rect.width - WAVEFORM_PAD_X * 2;
      const ratio = clamp(
        (clientX - rect.left - WAVEFORM_PAD_X) / Math.max(1, drawableW),
        0,
        1,
      );

      if (target === "start") {
        const maxStart = Math.max(0, endRatio - minRatioGap);
        setStartRatio(clamp(ratio, 0, maxStart));
      } else if (target === "end") {
        const minEnd = Math.min(1, startRatio + minRatioGap);
        setEndRatio(clamp(ratio, minEnd, 1));
      }
    },
    [endRatio, minRatioGap, startRatio],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const target = dragTargetRef.current;
      if (!target) return;
      updateFromClientX(event.clientX, target);
    },
    [updateFromClientX],
  );

  const handlePointerUp = useCallback(() => {
    dragTargetRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  const handleWaveformPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!audioBuffer) return;
      const host = waveformRef.current;
      if (!host) return;

      // Stop playback and reset pause position when dragging handles
      if (playSourceRef.current) {
        teardownAudio();
      }
      pausedAtRatioRef.current = null;

      const rect = host.getBoundingClientRect();
      const drawableW = rect.width - WAVEFORM_PAD_X * 2;
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const startX = WAVEFORM_PAD_X + startRatio * drawableW;
      const endX = WAVEFORM_PAD_X + endRatio * drawableW;

      const pickStart = Math.abs(x - startX) <= HANDLE_PICK_PX;
      const pickEnd = Math.abs(x - endX) <= HANDLE_PICK_PX;

      let nextTarget: DragTarget = null;
      if (pickStart && pickEnd) {
        nextTarget = x < (startX + endX) / 2 ? "start" : "end";
      } else if (pickStart) {
        nextTarget = "start";
      } else if (pickEnd) {
        nextTarget = "end";
      } else {
        nextTarget =
          Math.abs(x - startX) < Math.abs(x - endX) ? "start" : "end";
      }

      dragTargetRef.current = nextTarget;
      updateFromClientX(event.clientX, nextTarget);

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [
      audioBuffer,
      endRatio,
      handlePointerMove,
      handlePointerUp,
      startRatio,
      teardownAudio,
      updateFromClientX,
    ],
  );

  const handleSave = useCallback(async () => {
    if (!audioBuffer || isSaving || isDecoding) return;
    stopPlayback();
    setErrorText("");
    setIsSaving(true);

    try {
      const startFrame = Math.floor(audioBuffer.length * startRatio);
      const endFrame = Math.max(
        startFrame + 1,
        Math.floor(audioBuffer.length * endRatio),
      );
      const wavBase64 = encodeWavBase64(audioBuffer, startFrame, endFrame);
      const trimmedName = soundName.trim() || undefined;
      const response = await window.api.sound.saveProcessedWav(
        wavBase64,
        trimmedName,
      );

      if (!response.success || !response.soundPath) {
        throw new Error(
          response.error || t("soundTrimModal.saveErrorDefault"),
        );
      }

      onSaved(response.soundPath);
      resetState();
    } catch (error) {
      console.error("Failed to save processed sound:", error);
      setErrorText(t("soundTrimModal.saveErrorFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [
    audioBuffer,
    endRatio,
    isDecoding,
    isSaving,
    onSaved,
    resetState,
    soundName,
    startRatio,
    stopPlayback,
  ]);

  const headerLabel = useMemo(() => {
    if (!audioBuffer) {
      if (isDecoding) return t("soundTrimModal.statusDecoding");
      return t("soundTrimModal.statusWaiting");
    }
    return t("soundTrimModal.statusReady");
  }, [audioBuffer, isDecoding, t]);

  if (!isOpen) return null;

  return (
    <Modal onClick={closeModal}>
      <div
        className="w-[340px] max-w-[calc(100vw-80px)] flex flex-col bg-[#1A191E] rounded-[10px] border border-[#2A2A30] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header bar */}
        <div className="h-[37px] bg-[#2A2A30] border-b border-[#3A3943] px-[12px] flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-[8px]">
            <span className="px-[6px] h-[18px] rounded-[4px] border border-[#3A3943] bg-[#1A191E] text-[10px] leading-[18px] font-semibold tracking-[0.2px] text-[#8CC2FF]">
              Sound
            </span>
            <span className="truncate text-[12px] leading-[16px] text-[#DBDEE8]">
              {originalFileName || t("soundTrimModal.defaultTitle")}
            </span>
          </div>
          <span className="text-[11px] leading-[14px] text-[#8A8D99]">
            {headerLabel}
          </span>
        </div>

        {/* Content area */}
        <div className="p-[12px] flex flex-col gap-[10px]">
          {/* Name input */}
          <div>
            <label className="block text-[11px] leading-[14px] text-[#8A8D99] mb-[4px]">
              {t("soundTrimModal.nameLabel")}
            </label>
            <input
              type="text"
              value={soundName}
              onChange={(e) => setSoundName(e.target.value)}
              placeholder={t("soundTrimModal.namePlaceholder")}
              className="w-full h-[30px] px-[10px] rounded-[7px] border border-[#3A3943] bg-[#1E1E1E] text-[12px] leading-[16px] text-[#DBDEE8] placeholder-[#6F6E7A] outline-none focus:border-[#459BF8] transition-colors"
              disabled={isSaving}
            />
          </div>

          {/* Waveform section */}
          <div className="rounded-[8px] border border-[#3A3943] bg-[#141419] overflow-hidden">
            <div className="flex items-center h-[100px]">
              {/* Play button */}
              <div className="w-[52px] h-full flex flex-col items-center justify-center gap-[4px]">
                <button
                  type="button"
                  className={`w-[30px] h-[30px] rounded-full flex items-center justify-center transition-colors ${
                    audioBuffer
                      ? "bg-[#2A2A30] hover:bg-[#3A3A42] cursor-pointer"
                      : "bg-[#1E1E24] cursor-default opacity-40"
                  }`}
                  onClick={handlePlay}
                  disabled={!audioBuffer}
                >
                  {isPlaying ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
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
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path
                        d="M3.5 1.8C3.5 1.49 3.84 1.3 4.1 1.47L10.1 5.67C10.34 5.83 10.34 6.17 10.1 6.33L4.1 10.53C3.84 10.7 3.5 10.51 3.5 10.2V1.8Z"
                        fill="#DBDEE8"
                      />
                    </svg>
                  )}
                </button>
                <span className="text-[10px] leading-[12px] text-[#6BC87C] font-medium tabular-nums">
                  {audioBuffer ? formatSecLabel(trimDurationMs) : "--"}
                </span>
              </div>

              {/* Waveform canvas */}
              <div
                ref={waveformRef}
                className={`flex-1 h-full ${
                  audioBuffer ? "cursor-ew-resize" : "cursor-default"
                }`}
                onPointerDown={handleWaveformPointerDown}
              >
                {audioBuffer ? (
                  <canvas
                    ref={canvasRef}
                    className="w-full h-full block"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[11px] text-[#6F6E7A]">
                    {isDecoding
                      ? t("soundTrimModal.decodingMessage")
                      : t("soundTrimModal.emptyMessage")}
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

        {/* Hint bar */}
        <div className="h-[28px] bg-[#2A2A30] border-t border-[#3A3943] px-[12px] flex items-center justify-between gap-[12px]">
          <button
            type="button"
            className="text-[11px] leading-[14px] text-[#8CC2FF] hover:text-[#ACCFFF] transition-colors"
            onClick={selectFile}
            disabled={isDecoding || isSaving}
          >
            {t("soundTrimModal.loadFile")}
          </button>
          <p className="shrink-0 text-[11px] leading-[14px] text-[#8A8D99]">
            {t("soundTrimModal.dragHint")}
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Footer */}
        <div className="bg-[#1A191E] border-t border-[#2A2A30] px-[12px] py-[10px] flex items-center justify-end gap-[10.5px]">
          <button
            type="button"
            className={`w-[120px] h-[30px] rounded-[7px] text-style-3 transition-colors ${
              canSubmit
                ? "bg-[#2A2A30] text-[#DCDEE7] hover:bg-[#34343c]"
                : "bg-[#222228] text-[#777986] cursor-not-allowed"
            }`}
            onClick={() => {
              void handleSave();
            }}
            disabled={!canSubmit}
          >
            {isSaving ? t("soundTrimModal.saving") : t("soundTrimModal.submit")}
          </button>
          <button
            type="button"
            className="px-[24px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3 transition-colors"
            onClick={closeModal}
            disabled={isSaving}
          >
            {t("soundTrimModal.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
