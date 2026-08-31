'use no memo';
import React, { useEffect, useMemo, useRef } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import {
  getKeySignal,
  subscribeKeyPressEdge,
} from '@stores/signals/keySignals';
import {
  isErrorForCurrentSrc,
  useFailedImageSrcs,
} from '@hooks/overlay/useFailedImageSrcs';
import { resolveImageSource } from '@utils/core/imageSource';
import { warmupImageSource } from '@utils/core/imageWarmup';
import { resolveSpriteTarget } from '@utils/sprite/poseResolver';
import { computeSpriteImageStyle } from '@utils/sprite/spriteImageStyles';
import { resolveSpriteRenderEasing } from '@utils/sprite/spriteReach';
import { spriteTransformToCss } from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

interface OverlaySpriteItemProps {
  position: CanonicalReactiveSpritePosition;
  keyCanonicalMap: ReadonlyMap<string, string>;
}

// 단발(onPress) 재생 상태 - 재트리거 소유권 검증용 세대 포함.
// 늦게 도착한 이전 재생의 복원 콜백이 새 재생의 이미지를 덮지 못하게 한다
interface OneShotPlayback {
  generation: number;
  animation: Animation | null;
  timer: number | null;
}

// 키 입력에 따라 자세가 바뀌는 반응형 스프라이트 잎 컴포넌트.
// whileHeld: 담당 키 시그널을 여기서만 읽어 눌림 변화가 이 잎의 리렌더로만 남고,
// 변환은 CSS transition이 컴포지터에서 보간한다 (계약 §9).
// onPress: 렌더는 항상 idle로 고정하고, 실입력 DOWN edge에서 WAAPI가
// 자세→idle 한 방향 재생을 수행한다 (React state 미경유, 탭당 리렌더 0)
const OverlaySpriteItem = React.memo(function OverlaySpriteItem({
  position,
  keyCanonicalMap,
}: OverlaySpriteItemProps) {
  useSignals();

  const isOneShot = position.activation === 'onPress';

  // 자세들이 참조하는 키 요소 id 전체 (중복 제거)
  const triggerIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const pose of position.poses) {
      for (const trigger of pose.triggers) {
        if (seen.has(trigger)) continue;
        seen.add(trigger);
        ids.push(trigger);
      }
    }
    return ids;
  }, [position.poses]);

  // whileHeld만 렌더 중 시그널을 읽어 구독을 형성한다 - onPress는 edge 채널 전용이라
  // 눌림 레벨 변화에 리렌더될 이유가 없다
  const pressedIds = new Set<string>();
  if (!isOneShot) {
    for (const id of triggerIds) {
      const canonical = keyCanonicalMap.get(id);
      if (!canonical) continue;
      if (getKeySignal(canonical).value) pressedIds.add(id);
    }
  }

  const target = isOneShot
    ? { transform: position.idleTransform, imageSrc: position.baseImage }
    : resolveSpriteTarget(position, pressedIds);

  const { failedImageSrcs, markFailed } = useFailedImageSrcs(
    position.baseImage,
    ...position.poses.map((pose) => pose.imageOverride),
  );

  const baseImageSrc = resolveImageSource(position.baseImage);
  const targetImageSrc = resolveImageSource(target.imageSrc);

  // easing 해석은 정규식·베지어 극값 계산이라 렌더마다 돌리지 않는다.
  // 발산 easing은 도달 계산과 같은 기준으로 강등 (창 클리핑 방지)
  const renderEasing = useMemo(
    () => resolveSpriteRenderEasing(position.transitionEasing),
    [position.transitionEasing],
  );
  // onPress는 전환 채널 미사용 - WAAPI가 유일한 보간자다
  const transitionCss = isOneShot
    ? undefined
    : `transform ${position.transitionMs}ms ${renderEasing}`;

  // 실패한 src는 baseImage로 폴백, 그것도 실패면 렌더 제외
  let imageSrc = targetImageSrc;
  if (imageSrc && failedImageSrcs.has(imageSrc)) imageSrc = baseImageSrc;
  if (imageSrc && failedImageSrcs.has(imageSrc)) imageSrc = null;

  // 첫 자세 전환에서 cold decode가 겹치지 않도록 base와 모든 override를 선행 디코드
  const warmupSrcs = useMemo(() => {
    const srcs = new Set<string>();
    const base = resolveImageSource(position.baseImage);
    if (base) srcs.add(base);
    for (const pose of position.poses) {
      const src = resolveImageSource(pose.imageOverride);
      if (src) srcs.add(src);
    }
    return [...srcs];
  }, [position.baseImage, position.poses]);

  useEffect(() => {
    for (const src of warmupSrcs) warmupImageSource(src);
  }, [warmupSrcs]);

  // 기본 이미지가 없어도 자세 override만으로 유효한 onPress 스프라이트가 성립한다.
  // 안정 img 노드를 유지하고 idle에는 숨겨야 edge 핸들러가 재생할 대상이 있다
  const hasOverrideImage = position.poses.some(
    (pose) => pose.imageOverride != null,
  );
  const mountOneShotImage =
    isOneShot && (baseImageSrc !== null || hasOverrideImage);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const playbackRef = useRef<OneShotPlayback>({
    generation: 0,
    animation: null,
    timer: null,
  });
  // 진행 중 재생 정리 - 세대 무효화로 늦은 콜백까지 차단 (멱등)
  const stopPlayback = () => {
    const playback = playbackRef.current;
    playback.generation += 1;
    if (playback.animation) {
      playback.animation.onfinish = null;
      playback.animation.oncancel = null;
      playback.animation.cancel();
      playback.animation = null;
    }
    if (playback.timer !== null) {
      clearTimeout(playback.timer);
      playback.timer = null;
    }
  };

  // edge 핸들러는 구독 effect보다 자주 갱신되는 값을 ref로 읽는다 (재구독 방지)
  const latestRef = useRef({ position, failedImageSrcs });
  useEffect(() => {
    latestRef.current = { position, failedImageSrcs };
  });

  useEffect(() => {
    if (!isOneShot) return undefined;
    // cleanup 복원 대상 노드 - 같은 분기 재구독 동안은 key가 같아 안정적이고,
    // 모드 전환 시에는 어차피 key 재마운트가 잔상을 걷는다
    const mountedImg = imgRef.current;

    const canonicals = new Set<string>();
    for (const id of triggerIds) {
      const canonical = keyCanonicalMap.get(id);
      if (canonical) canonicals.add(canonical);
    }
    if (canonicals.size === 0) return undefined;

    const handleEdge = () => {
      const el = imgRef.current;
      if (!el) return;
      const { position: pos, failedImageSrcs: failed } = latestRef.current;

      // 눌린 집합은 시그널 peek로만 만든다 - 여기서 구독이 생기면 안 된다
      const pressed = new Set<string>();
      for (const id of triggerIds) {
        const canonical = keyCanonicalMap.get(id);
        if (canonical && getKeySignal(canonical).value) pressed.add(id);
      }
      const resolved = resolveSpriteTarget(pos, pressed);

      let src = resolveImageSource(resolved.imageSrc);
      if (src && failed.has(src)) src = resolveImageSource(pos.baseImage);
      if (src && failed.has(src)) src = null;
      const baseSrc = resolveImageSource(pos.baseImage);

      const playback = playbackRef.current;
      // 재트리거 소유권 이전 - 이전 재생의 콜백을 떼고 취소한다
      stopPlayback();
      const generation = playback.generation;

      if (src) {
        el.src = src;
        el.style.visibility = '';
      } else {
        // 재생할 이미지가 없으면 이전 세대의 잔상을 즉시 걷어낸다
        el.removeAttribute('src');
        el.style.visibility = baseSrc ? '' : 'hidden';
        if (baseSrc) el.src = baseSrc;
      }
      const restore = () => {
        if (playbackRef.current.generation !== generation) return;
        // 재생 중 문서가 바뀌었을 수 있어 캡처값 대신 최신 baseImage로 복원
        const currentBase = resolveImageSource(
          latestRef.current.position.baseImage,
        );
        if (currentBase) {
          el.src = currentBase;
          el.style.visibility = '';
        } else {
          el.removeAttribute('src');
          el.style.visibility = 'hidden';
        }
      };

      const fromCss = spriteTransformToCss(resolved.transform);
      const toCss = spriteTransformToCss(pos.idleTransform);
      if (typeof el.animate === 'function') {
        // 자세에서 시작해 idle로 돌아오는 한 방향 재생 - 스냅 타격 + 이즈 복귀.
        // fill: none이라 종료 후에는 CSS 변수 채널(idle)이 그대로 복귀값이다
        const animation = el.animate(
          [{ transform: fromCss }, { transform: toCss }],
          {
            duration: pos.pressDurationMs,
            easing: resolveSpriteRenderEasing(pos.transitionEasing),
            fill: 'none',
          },
        );
        const settle = () => {
          if (playbackRef.current.generation !== generation) return;
          playbackRef.current.animation = null;
          restore();
        };
        animation.onfinish = settle;
        // 외부 취소(사용자 스크립트 등)도 idle 이미지 복원 계약을 지킨다
        animation.oncancel = settle;
        playback.animation = animation;
      } else {
        // WAAPI 부재 폴백 - 자세로 스냅했다가 시간 후 복귀 (보간 없음)
        el.style.transform = fromCss;
        playback.timer = window.setTimeout(() => {
          if (playbackRef.current.generation !== generation) return;
          playbackRef.current.timer = null;
          el.style.transform = '';
          restore();
        }, pos.pressDurationMs);
      }
    };

    const unsubscribes = [...canonicals].map((canonical) =>
      subscribeKeyPressEdge(canonical, handleEdge),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      // whileHeld 전환·트리거 교체 시 진행 중 재생을 함께 끊는다
      stopPlayback();
      // 직접 쓴 src·visibility 잔상 제거 - React는 prop이 같으면 DOM을 다시
      // 쓰지 않으므로 여기서 현재 문서 기준으로 복원한다 (전환 시에는 key가
      // 노드를 갈아 끼우고, 같은 분기 안 재구독에는 이 복원이 잡는다)
      const el = mountedImg;
      if (el) {
        const currentBase = resolveImageSource(
          latestRef.current.position.baseImage,
        );
        if (currentBase) {
          el.src = currentBase;
          el.style.visibility = '';
        } else {
          el.removeAttribute('src');
          el.style.visibility = 'hidden';
        }
      }
    };
  }, [isOneShot, triggerIds, keyCanonicalMap]);

  if (position.hidden) return null;

  // 히트 기준은 활동 영역 박스(루트) - 에디터 선택 박스와 같은 의미이고 포즈 전환
  // 중에도 rect가 안정적이다. 이미지 박스는 transform을 따라 움직여 실측 시점에
  // 따라 어긋나므로 히트 표식을 img로 옮기지 않는다
  return (
    <div
      className={`absolute ${position.className || ''}`}
      style={{
        left: 0,
        top: 0,
        transform: `translate3d(${position.dx}px, ${position.dy}px, 0)`,
        width: `${position.width}px`,
        height: `${position.height}px`,
        zIndex: position.zIndex ?? 0,
        pointerEvents: 'none',
      }}
      data-sprite-element="true"
      data-overlay-hit="true"
      data-state={!isOneShot && pressedIds.size > 0 ? 'active' : 'idle'}
    >
      {isOneShot
        ? mountOneShotImage && (
            <img
              // 분기별 key - 모드 전환 시 노드 재사용을 끊어 직접 쓴 src가
              // 다음 모드로 새어 나가지 않게 한다
              key="one-shot"
              ref={imgRef}
              src={baseImageSrc ?? undefined}
              alt=""
              draggable={false}
              style={{
                ...computeSpriteImageStyle(position, position.idleTransform),
                willChange: 'transform',
                // 기본 이미지가 없으면 재생 순간에만 보인다
                ...(baseImageSrc ? {} : { visibility: 'hidden' as const }),
              }}
              onError={(event) => {
                const src = event.currentTarget.getAttribute('src');
                if (src) markFailed(src);
              }}
            />
          )
        : imageSrc && (
            <img
              key="held"
              src={imageSrc}
              alt=""
              draggable={false}
              style={{
                // 외관 채널은 기본 모드에서 변수로 - 사용자 CSS가 !important 없이 이긴다
                ...computeSpriteImageStyle(
                  position,
                  target.transform,
                  transitionCss,
                ),
                willChange: 'transform',
              }}
              onError={(event) => {
                if (!isErrorForCurrentSrc(event.currentTarget, imageSrc))
                  return;
                markFailed(imageSrc);
              }}
            />
          )}
    </div>
  );
});

export default OverlaySpriteItem;
