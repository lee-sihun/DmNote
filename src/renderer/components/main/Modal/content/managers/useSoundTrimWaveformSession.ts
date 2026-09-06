import { useCallback, useEffect, useRef } from 'react';
import type {
  Dispatch,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from 'react';
import { beginDragCursor, endDragCursor } from '@utils/dom/dragCursor';
import {
  getCursor,
  lockCustomCursor,
  setCustomCursorHover,
  unlockCustomCursor,
} from '@utils/grid/cursorUtils';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import {
  WAVEFORM_PAD_X,
  clamp,
  getSoundTrimHandleGeometry,
  getSoundTrimRatioFromClientX,
  isNearSoundTrimHandle,
  pickSoundTrimDragTarget,
  planSoundTrimMiddlePan,
  planSoundTrimWheelViewport,
  type SoundTrimDragTarget,
} from './soundTrimModel';

interface UseSoundTrimWaveformSessionOptions {
  isOpen: boolean;
  audioBuffer: AudioBuffer | null;
  waveformHost: HTMLDivElement | null;
  waveformRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  audioBufferRef: RefObject<AudioBuffer | null>;
  startRatioRef: RefObject<number>;
  endRatioRef: RefObject<number>;
  viewStartRef: RefObject<number>;
  viewEndRef: RefObject<number>;
  dragTargetRef: MutableRefObject<SoundTrimDragTarget>;
  middleDragCleanupRef: MutableRefObject<(() => void) | null>;
  handleDragCleanupRef: MutableRefObject<(() => void) | null>;
  playSourceRef: RefObject<AudioBufferSourceNode | null>;
  pausedAtRatioRef: MutableRefObject<number | null>;
  viewZoom: number;
  viewPanRatio: number;
  setViewZoom: Dispatch<SetStateAction<number>>;
  setViewPanRatio: Dispatch<SetStateAction<number>>;
  setStartRatio: Dispatch<SetStateAction<number>>;
  setEndRatio: Dispatch<SetStateAction<number>>;
  teardownAudio: () => void;
  continuousInputStrategy: ContinuousInputStrategy;
}

export const useSoundTrimWaveformSession = ({
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
}: UseSoundTrimWaveformSessionOptions): {
  handleWaveformPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
} => {
  const viewZoomRef = useRef(viewZoom);
  viewZoomRef.current = viewZoom;
  const viewPanRatioRef = useRef(viewPanRatio);
  viewPanRatioRef.current = viewPanRatio;
  const wheelDeltaRef = useRef(0);

  // 최신 값은 전부 ref로 읽으므로 노드가 붙을 때만 다시 건다. 매 렌더 재등록하면
  // 정리 시 스케줄러가 아직 안 흘린 휠 델타를 버린다
  useEffect(() => {
    if (!isOpen) return;
    const node = waveformHost;
    if (!node) return;
    const applyWheel = (event: WheelEvent, deltaY: number) => {
      if (!audioBufferRef.current) return;

      const rect = node.getBoundingClientRect();
      const nextViewport = planSoundTrimWheelViewport({
        clientX: event.clientX,
        rectLeft: rect.left,
        rectWidth: rect.width,
        deltaY,
        viewZoom: viewZoomRef.current,
        viewPanRatio: viewPanRatioRef.current,
      });
      setViewZoom(nextViewport.viewZoom);
      setViewPanRatio(nextViewport.viewPanRatio);
    };
    const scheduler = createRafLatestScheduler<WheelEvent>((event) => {
      const deltaY = wheelDeltaRef.current;
      wheelDeltaRef.current = 0;
      applyWheel(event, deltaY);
    }, continuousInputStrategy);
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheelDeltaRef.current += event.deltaY;
      scheduler.push(event);
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      scheduler.cancel();
      wheelDeltaRef.current = 0;
      node.removeEventListener('wheel', handleWheel);
    };
    // ref와 React setter는 안정적이며 기존 노드·전략 재등록 경계 유지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousInputStrategy, isOpen, waveformHost]);

  // 중간 버튼 드래그: 줌 시 수평 패닝
  const handleMiddleDown = useCallback(
    (event: MouseEvent) => {
      if (event.button !== 1) return;
      if (!audioBufferRef.current) return;
      event.preventDefault();

      const host = waveformRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const drawableWidth = rect.width - WAVEFORM_PAD_X * 2;

      const startClientX = event.clientX;
      const startPanRatio = viewPanRatioRef.current;
      const viewSpan = 1 / viewZoomRef.current;

      setCustomCursorHover(null);
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = '';
      host.style.cursor = 'grabbing';
      // 잡는 동안 전역 유지 - 호스트 밖으로 나가도 복귀하지 않게
      beginDragCursor('grabbing');

      const applyMouseMove = (moveEvent: MouseEvent) => {
        setViewPanRatio(
          planSoundTrimMiddlePan({
            clientX: moveEvent.clientX,
            startClientX,
            startPanRatio,
            drawableWidth,
            viewSpan,
          }),
        );
      };
      const moveScheduler = createRafLatestScheduler(
        applyMouseMove,
        continuousInputStrategy,
      );
      const handleMouseMove = (moveEvent: MouseEvent) =>
        moveScheduler.push(moveEvent);

      const cleanup = () => {
        moveScheduler.flush();
        moveScheduler.cancel();
        endDragCursor();
        host.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', cleanup);
        window.removeEventListener('blur', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        middleDragCleanupRef.current = null;
      };

      middleDragCleanupRef.current = cleanup;
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', cleanup);
      // 드래그 중 포커스 상실·포인터 취소 시에도 커서 복구
      window.addEventListener('blur', cleanup);
      window.addEventListener('pointercancel', cleanup);
    },
    // ref와 React setter는 안정적이며 기존 전략 교체 경계 유지
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [continuousInputStrategy],
  );

  useEffect(() => {
    if (!isOpen) return;
    const node = waveformHost;
    if (!node) return;
    node.addEventListener('mousedown', handleMiddleDown);
    return () => {
      node.removeEventListener('mousedown', handleMiddleDown);
      middleDragCleanupRef.current?.();
    };
    // cleanup ref는 안정적이며 기존 재등록 경계 유지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleMiddleDown, isOpen, waveformHost]);

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
    const host = waveformHost;
    if (!canvas || !host) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (dragTargetRef.current || middleDragCleanupRef.current) return;
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const { startX, endX } = getSoundTrimHandleGeometry({
        rectWidth: rect.width,
        viewStart: viewStartRef.current,
        viewEnd: viewEndRef.current,
        startRatio: startRatioRef.current,
        endRatio: endRatioRef.current,
      });
      const nearHandle = isNearSoundTrimHandle(x, startX, endX);

      // macOS: SVG overlay 커서 / Windows: getCursor CSS 폴백
      setCustomCursorHover(nearHandle ? 'ew-resize' : null, event);
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
    // ref는 안정적이며 audio/host 교체 시점의 기존 재등록 경계 유지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, audioBuffer, waveformHost]);

  const updateFromClientX = (clientX: number, target: SoundTrimDragTarget) => {
    const host = waveformRef.current;
    if (!host || !target) return;
    const rect = host.getBoundingClientRect();
    const ratio = getSoundTrimRatioFromClientX({
      clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      viewStart: viewStartRef.current,
      viewEnd: viewEndRef.current,
    });

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
    event: ReactPointerEvent<HTMLDivElement>,
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
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const { startX, endX } = getSoundTrimHandleGeometry({
      rectWidth: rect.width,
      viewStart: viewStartRef.current,
      viewEnd: viewEndRef.current,
      startRatio: startRatioRef.current,
      endRatio: endRatioRef.current,
    });
    const nextTarget = pickSoundTrimDragTarget(x, startX, endX);

    dragTargetRef.current = nextTarget;
    lockCustomCursor('ew-resize', event.nativeEvent as unknown as MouseEvent);
    updateFromClientX(event.clientX, nextTarget);

    const moveScheduler = createRafLatestScheduler(
      handlePointerMove,
      continuousInputStrategy,
    );
    const registeredMove = (moveEvent: PointerEvent) =>
      moveScheduler.push(moveEvent);
    const registeredUp = handlePointerUp;

    handleDragCleanupRef.current = () => {
      moveScheduler.flush();
      moveScheduler.cancel();
      dragTargetRef.current = null;
      unlockCustomCursor();
      window.removeEventListener('pointermove', registeredMove);
      window.removeEventListener('pointerup', registeredUp);
      window.removeEventListener('pointercancel', registeredUp);
      window.removeEventListener('blur', registeredUp);
      handleDragCleanupRef.current = null;
    };

    window.addEventListener('pointermove', registeredMove);
    window.addEventListener('pointerup', registeredUp);
    // 드래그 중 포커스 상실·포인터 취소 시에도 커서·드래그 상태 복구
    window.addEventListener('pointercancel', registeredUp);
    window.addEventListener('blur', registeredUp);
  };

  return { handleWaveformPointerDown };
};
