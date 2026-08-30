import { clamp, createAudioContext, drawWaveform } from './soundTrimModel';

interface RuntimeRef<T> {
  current: T;
}

interface SoundTrimPlaybackRuntimeOptions {
  audioBuffer: AudioBuffer | null;
  previewVolume: number;
  canvasRef: RuntimeRef<HTMLCanvasElement | null>;
  peaksRef: RuntimeRef<Float32Array>;
  startRatioRef: RuntimeRef<number>;
  endRatioRef: RuntimeRef<number>;
  viewStartRef: RuntimeRef<number>;
  viewEndRef: RuntimeRef<number>;
  playContextRef: RuntimeRef<AudioContext | null>;
  playSourceRef: RuntimeRef<AudioBufferSourceNode | null>;
  playStartCtxTimeRef: RuntimeRef<number>;
  playDurationSecRef: RuntimeRef<number>;
  playStartRatioRef: RuntimeRef<number>;
  playEndRatioRef: RuntimeRef<number>;
  animFrameRef: RuntimeRef<number>;
  pausedAtRatioRef: RuntimeRef<number | null>;
  setIsPlaying(isPlaying: boolean): void;
}

interface SoundTrimPlaybackRuntime {
  teardownAudio(): void;
  redrawWaveformStatic(pausedRatio?: number | null): void;
  stopPlayback(): void;
  handlePlay(): void;
}

export const createSoundTrimPlaybackRuntime = ({
  audioBuffer,
  previewVolume,
  canvasRef,
  peaksRef,
  startRatioRef,
  endRatioRef,
  viewStartRef,
  viewEndRef,
  playContextRef,
  playSourceRef,
  playStartCtxTimeRef,
  playDurationSecRef,
  playStartRatioRef,
  playEndRatioRef,
  animFrameRef,
  pausedAtRatioRef,
  setIsPlaying,
}: SoundTrimPlaybackRuntimeOptions): SoundTrimPlaybackRuntime => {
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

  return {
    teardownAudio,
    redrawWaveformStatic,
    stopPlayback,
    handlePlay,
  };
};
