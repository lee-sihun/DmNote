import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import FullSurfaceModalLayout from '@components/main/Modal/FullSurfaceModalLayout';
import { isTopmostPopupLayer } from '@components/main/Modal/popupLayer';
import IconSwap from '@components/main/common/IconSwap';
import { setCustomCursorHover } from '@utils/grid/cursorUtils';
import { type ContinuousInputStrategy } from '@utils/animation/rafLatestScheduler';
import { soundApi } from '@api/modules/resources/resourceApi';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  decodeAudioFromArrayBuffer,
  drawWaveform,
  encodeWavBase64,
  extractWaveformPeaks,
  formatSecLabel,
  stripExtension,
  type SoundTrimDragTarget,
} from './soundTrimModel';
import { createSoundTrimPlaybackRuntime } from './soundTrimPlaybackRuntime';
import { useSoundTrimWaveformSession } from './useSoundTrimWaveformSession';

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
  /** 성능 계측용 비교 전략. 제품 경로는 프레임당 최신 입력만 반영한다. */
  continuousInputStrategy?: ContinuousInputStrategy;
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
  continuousInputStrategy = 'frame',
}: SoundTrimModalProps) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 시트 본문은 첫 paint 뒤에 붙는다(FullSurfaceModalLayout after-paint). 파형 노드에
  // 리스너·관측을 거는 이펙트는 마운트 시점 ref 읽기로는 노드를 못 잡으므로,
  // 붙는 순간을 state로 받아 그때 다시 돌린다. 핸들러는 그대로 ref를 읽는다
  const [waveformHost, setWaveformHost] = useState<HTMLDivElement | null>(null);
  const attachWaveformHost = useCallback((node: HTMLDivElement | null) => {
    waveformRef.current = node;
    setWaveformHost(node);
  }, []);
  const dragTargetRef = useRef<SoundTrimDragTarget>(null);

  const isEditMode = !!editingSoundPath;

  const [originalFileName, setOriginalFileName] = useState('');
  const [soundName, setSoundName] = useState('');
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array());
  const [startRatio, setStartRatio] = useState(0);
  const [endRatio, setEndRatio] = useState(1);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
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

  const { teardownAudio, redrawWaveformStatic, stopPlayback, handlePlay } =
    createSoundTrimPlaybackRuntime({
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
    });

  const handlePlayRef = useRef<() => void>(() => {});
  handlePlayRef.current = handlePlay;

  // 스페이스 = 재생/일시정지 — 포커스된 버튼의 스페이스 활성화(취소 오동작)를 가로챔
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.defaultPrevented) return;
      // 시트 위에 다른 팝업 레이어가 떠 있으면 스페이스 소유권 양보
      const backdrop = waveformRef.current?.closest<HTMLElement>(
        '[data-dmn-modal-backdrop="true"]',
      );
      if (!isTopmostPopupLayer(backdrop ?? null)) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      handlePlayRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

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
    savingRef.current = false;
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
    // 저장 중 닫기 금지 — 진행 중 저장의 완료 콜백이 닫힌 시트로 새는 것을 차단
    if (isSaving) return;
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

  // initialFile 제공 시 처리 (SoundPicker 파일 선택기에서)
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
    if (!waveformHost || !canvas || peaks.length === 0) return;
    drawWaveform(
      canvas,
      peaks,
      startRatio,
      endRatio,
      pausedAtRatioRef.current,
      viewStart,
      viewEnd,
    );
  }, [
    isOpen,
    isPlaying,
    peaks,
    startRatio,
    endRatio,
    viewStart,
    viewEnd,
    waveformHost,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const node = waveformHost;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      if (!isPlaying) {
        redrawWaveformStatic(pausedAtRatioRef.current);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [isOpen, isPlaying, waveformHost]);

  const selectFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void processFile(file);
  };

  const { handleWaveformPointerDown } = useSoundTrimWaveformSession({
    isOpen,
    audioBuffer,
    waveformHost,
    waveformRef,
    canvasRef,
    audioBufferRef,
    startRatioRef,
    endRatioRef,
    viewStartRef,
    viewEndRef,
    dragTargetRef,
    middleDragCleanupRef,
    handleDragCleanupRef,
    playSourceRef,
    pausedAtRatioRef,
    viewZoom,
    viewPanRatio,
    setViewZoom,
    setViewPanRatio,
    setStartRatio,
    setEndRatio,
    teardownAudio,
    continuousInputStrategy,
  });

  const handleSave = async () => {
    if (!audioBuffer || savingRef.current || isDecoding) return;
    savingRef.current = true;
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
        const response = await soundApi.updateProcessedWav(
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
        const response = await soundApi.saveProcessedWav(
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
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const sheetTitle = isEditMode
    ? t('soundTrimModal.editTitle')
    : t('soundTrimModal.defaultTitle');

  // 제목은 모드 고정 — 파일 정체성은 헤더 보조 캡션이 담당
  const headerFileName = isEditMode
    ? editingDisplayName || ''
    : originalFileName;

  if (!isOpen) return null;

  return (
    <FullSurfaceModalLayout
      onClose={closeModal}
      title={sheetTitle}
      headerInfo={
        headerFileName ? (
          <span className="min-w-0 text-caption text-fg-faint truncate">
            {headerFileName}
          </span>
        ) : undefined
      }
      submitLabel={
        isSaving
          ? t('soundTrimModal.saving')
          : isEditMode
          ? t('soundTrimModal.submitEdit')
          : t('soundTrimModal.submit')
      }
      submitDisabled={!canSubmit}
      onSubmit={() => {
        void handleSave();
      }}
      cancelLabel={t('common.cancel')}
    >
      {/* 본문 — 상단: 파형 히어로 스테이지, 하단: 트랜스포트 데크 */}
      <div className="flex-1 min-h-0 flex flex-col gap-[12px]">
        {/* 파형 카드 — 카드 내부를 통째로 채우는 풀블리드 캔버스 */}
        <div className="flex-1 min-w-0 min-h-0 bg-fill-faint rounded-surface p-[10px] flex flex-col">
          <div
            ref={attachWaveformHost}
            data-sound-waveform="true"
            className="relative flex-1 min-h-0 min-w-0 rounded-md overflow-hidden bg-inset"
            onPointerDown={handleWaveformPointerDown}
          >
            {audioBuffer ? (
              /* 디코드 완료 시 한 박자 페이드 — 스켈레톤→파형 팝인 정리 */
              <div className="absolute inset-0 animate-stage-in">
                <canvas ref={canvasRef} className="w-full h-full block" />
                {/* 하단 안내 — 스크림 없이 흐린 캡션만 */}
                <div className="absolute inset-x-0 bottom-[10px] text-center pointer-events-none">
                  <span className="text-caption text-fg-faint">
                    {t('soundTrimModal.dragHint')}
                  </span>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-caption text-fg-muted">
                {isDecoding
                  ? isEditMode
                    ? t('soundTrimModal.statusLoading')
                    : t('soundTrimModal.decodingMessage')
                  : t('soundTrimModal.emptyMessage')}
              </div>
            )}
          </div>
        </div>

        {/* 트랜스포트 데크 — 재생·길이·이름 한 줄, 이름 입력이 남는 폭 흡수 */}
        <div className="shrink-0 bg-fill-faint rounded-surface px-[10px] py-[4px] flex flex-nowrap items-center gap-x-[10px] overflow-hidden">
          <div className="flex items-center gap-[8px] min-h-[32px]">
            <button
              type="button"
              className={`w-[24px] h-[24px] rounded-full flex items-center justify-center transition-colors duration-fast ${
                audioBuffer
                  ? 'bg-fill hover:bg-fill-hover active:bg-fill-active text-fg cursor-pointer'
                  : 'bg-fill-faint text-fg-disabled cursor-default'
              }`}
              onClick={handlePlay}
              disabled={!audioBuffer}
            >
              <IconSwap
                active={isPlaying}
                activeIcon={
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect
                      x="2"
                      y="1.5"
                      width="3"
                      height="9"
                      rx="0.75"
                      fill="currentColor"
                    />
                    <rect
                      x="7"
                      y="1.5"
                      width="3"
                      height="9"
                      rx="0.75"
                      fill="currentColor"
                    />
                  </svg>
                }
                inactiveIcon={
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M3.5 1.8C3.5 1.49 3.84 1.3 4.1 1.47L10.1 5.67C10.34 5.83 10.34 6.17 10.1 6.33L4.1 10.53C3.84 10.7 3.5 10.51 3.5 10.2V1.8Z"
                      fill="currentColor"
                    />
                  </svg>
                }
              />
            </button>
            <span
              className={`text-body tabular-nums ${
                audioBuffer ? 'text-fg' : 'text-fg-faint'
              }`}
            >
              {audioBuffer ? formatSecLabel(trimDurationMs) : '--'}
            </span>
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px] flex-1 min-w-0">
            <p className="text-fg-muted text-label shrink-0">
              {t('soundTrimModal.nameLabel')}
            </p>
            <input
              type="text"
              value={soundName}
              onChange={(e) => setSoundName(e.target.value)}
              placeholder={t('soundTrimModal.namePlaceholder')}
              className="flex-1 min-w-0 h-[23px] px-[8px] bg-inset rounded-md text-body text-fg placeholder-fg-faint outline-none focus:shadow-focus-ring transition-shadow duration-fast"
              disabled={isSaving}
            />
          </div>

          {!isEditMode ? (
            <button
              type="button"
              className="shrink-0 h-[24px] px-[10px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-md text-label text-fg-muted hover:text-fg transition-colors duration-fast"
              onClick={selectFile}
              disabled={isDecoding || isSaving}
            >
              {t('soundTrimModal.loadFile')}
            </button>
          ) : null}
        </div>

        {errorText ? (
          <p className="shrink-0 text-caption leading-[14px] text-danger-fg">
            {errorText}
          </p>
        ) : null}
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
    </FullSurfaceModalLayout>
  );
};

export default SoundTrimModal;
