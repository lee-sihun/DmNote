'use no memo';
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import {
  getKeySignal,
  subscribeKeyPressEdge,
} from '@stores/signals/keySignals';
import {
  isErrorForCurrentSrc,
  useFailedImageSrcs,
} from '@hooks/overlay/useFailedImageSrcs';
import {
  isRenderableImageRef,
  resolveImageSource,
} from '@utils/core/imageSource';
import { warmupImageSource } from '@utils/core/imageWarmup';
import {
  resolveSpriteTarget,
  spriteTriggerIds,
} from '@utils/sprite/poseResolver';
import {
  computeSpriteImageStyle,
  hasSpriteTransformOverride,
  spriteTransformToCss,
} from '@utils/sprite/spriteImageStyles';
import {
  resolveSpriteRenderEasing,
  SPRITE_SAFE_FALLBACK_EASING,
} from '@utils/sprite/spriteReach';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

interface OverlaySpriteItemProps {
  position: CanonicalReactiveSpritePosition;
  keyCanonicalMap: ReadonlyMap<string, string>;
}

// 엔진이 거부한 easing - 문법이 유효해도 구형 WebKit(macOS 11)이나 OBS의 CEF는
// linear()를 모른다. 한 번 거부당하면 다시 시도하지 않는다
const rejectedEasings = new Set<string>();

// 폴백 재생이 직접 쓴 transform을 문서의 idle로 되돌린다.
// 기본 모드는 비우면 CSS 변수 채널이 받고, 인라인 우선 모드는 React가 쓴 것과
// 같은 선언을 되돌린다. 호출부가 항상 최신 문서를 넘겨야 재생 중 idleTransform·
// 인라인 우선이 바뀌어도 캡처해 둔 옛 값을 다시 덮지 않는다
const restoreIdleTransform = (
  el: HTMLImageElement,
  position: CanonicalReactiveSpritePosition,
) => {
  el.style.transform =
    position.useInlineStyles === true
      ? spriteTransformToCss(position.idleTransform)
      : '';
};

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

  // 자세들이 참조하는 키 요소 id 전체. 해석기가 poses identity로 캐시해 둔 것을 그대로 쓴다
  const triggerIds = spriteTriggerIds(position.poses);

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

  // onPress는 렌더가 idle 고정이라 자세 해석과 폴백 계산을 타지 않는다
  const heldTarget = isOneShot
    ? null
    : resolveSpriteTarget(position, pressedIds);

  const { failedImageSrcs, markFailed } = useFailedImageSrcs(
    position.baseImage,
    ...position.poses.map((pose) => pose.imageOverride),
  );

  const baseImageSrc = resolveImageSource(position.baseImage);
  // 실패한 기본 이미지는 "기본 이미지 없음"으로 취급한다 - 깨진 노드를 남기면
  // 투명 오버레이 위에 회색 대체 박스가 상주한다 (whileHeld 분기와 같은 규칙)
  const idleBaseSrc =
    baseImageSrc && !failedImageSrcs.has(baseImageSrc) ? baseImageSrc : null;

  // easing 해석은 정규식·베지어 극값 계산이라 렌더마다 돌리지 않는다.
  // 발산 easing은 도달 계산과 같은 기준으로 강등 (창 클리핑 방지)
  const renderEasing = useMemo(() => {
    const resolved = resolveSpriteRenderEasing(position.transitionEasing);
    // onPress의 보간자는 WAAPI뿐이라 전환 선언을 내지 않는다 - 엔진 질의도 생략
    if (isOneShot) return resolved;
    // CSS.supports가 없으면 판정할 방법이 없으니 통과시킨다 (테스트 DOM 포함)
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
      return resolved;
    }
    // whileHeld의 보간자는 CSS transition이라 WAAPI try/catch가 닿지 않는다.
    // 무효한 timing-function은 선언 전체가 버려져 0ms 스냅이 되므로, 문법 게이트를
    // 통과한 값도 선언 전에 엔진에 직접 물어본다
    return CSS.supports('transition-timing-function', resolved)
      ? resolved
      : SPRITE_SAFE_FALLBACK_EASING;
  }, [position.transitionEasing, isOneShot]);
  // onPress는 전환 채널 미사용 - WAAPI가 유일한 보간자다
  const transitionCss = isOneShot
    ? undefined
    : `transform ${position.transitionMs}ms ${renderEasing}`;

  // 실패한 src는 baseImage로 폴백, 그것도 실패면 렌더 제외
  let heldImageSrc = heldTarget
    ? resolveImageSource(heldTarget.imageSrc)
    : null;
  if (heldImageSrc && failedImageSrcs.has(heldImageSrc)) {
    heldImageSrc = baseImageSrc;
  }
  if (heldImageSrc && failedImageSrcs.has(heldImageSrc)) heldImageSrc = null;

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
  const hasOverrideImage = position.poses.some((pose) =>
    isRenderableImageRef(pose.imageOverride),
  );
  const mountOneShotImage =
    isOneShot && (idleBaseSrc !== null || hasOverrideImage);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const playbackRef = useRef<OneShotPlayback>({
    generation: 0,
    animation: null,
    timer: null,
  });
  // edge 핸들러는 구독 effect보다 자주 갱신되는 값을 ref로 읽는다 (재구독 방지).
  // layout 단계 갱신이라 구독 해제 cleanup도 최신 문서·실패 집합으로 복원한다
  const latestRef = useRef({
    position,
    failedImageSrcs,
    triggerIds,
    keyCanonicalMap,
  });
  useLayoutEffect(() => {
    latestRef.current = {
      position,
      failedImageSrcs,
      triggerIds,
      keyCanonicalMap,
    };
  });

  // 구독 대상 canonical 집합의 내용 시그니처. 문서 clone·키 맵 재생성처럼 내용이
  // 같은 새 identity로 effect가 다시 돌면 진행 중 재생이 끊기므로 집합이 실제로
  // 바뀔 때만 재구독한다. 트리거→canonical 짝은 edge 시점에 ref로 읽는다
  const canonicalKey = useMemo(() => {
    const canonicals = new Set<string>();
    for (const id of triggerIds) {
      const canonical = keyCanonicalMap.get(id);
      if (canonical) canonicals.add(canonical);
    }
    return [...canonicals].sort().join('\n');
  }, [triggerIds, keyCanonicalMap]);

  // 직접 쓴 src·visibility를 현재 문서의 기본 이미지로 되돌린다.
  // 재생 종료·취소, 구독 해제, 로드 실패가 같은 복원 규칙을 쓴다.
  // excludedSrc는 방금 실패해 아직 실패 집합에 반영되지 않은 src
  const restoreBaseImage = (
    el: HTMLImageElement,
    excludedSrc?: string | null,
  ) => {
    const { position: pos, failedImageSrcs: failed } = latestRef.current;
    const currentBase = resolveImageSource(pos.baseImage);
    if (
      currentBase &&
      currentBase !== excludedSrc &&
      !failed.has(currentBase)
    ) {
      el.src = currentBase;
      el.style.visibility = '';
    } else {
      el.removeAttribute('src');
      el.style.visibility = 'hidden';
    }
  };

  // 진행 중 재생 정리 - 세대 무효화로 늦은 콜백까지 차단 (멱등).
  // 노드는 호출부가 넘긴다 - 언마운트 뒤 정리에서는 imgRef가 이미 비어 있다
  const stopPlayback = (el: HTMLImageElement | null) => {
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
      // 폴백이 쓴 transform은 React prop이 그대로라 리렌더가 걷어내지 못한다.
      // 취소도 정상 만료와 같은 복원을 거쳐야 자세 각도가 남지 않는다
      if (el) restoreIdleTransform(el, latestRef.current.position);
    }
  };

  useEffect(() => {
    if (!isOneShot) return undefined;
    // cleanup 복원 대상 노드 - 같은 분기 재구독 동안은 key가 같아 안정적이고,
    // 모드 전환 시에는 어차피 key 재마운트가 잔상을 걷는다
    const mountedImg = imgRef.current;

    if (canonicalKey === '') return undefined;
    const canonicals = canonicalKey.split('\n');

    const handleEdge = () => {
      const el = imgRef.current;
      if (!el) return;
      const {
        position: pos,
        failedImageSrcs: failed,
        triggerIds: ids,
        keyCanonicalMap: canonicalMap,
      } = latestRef.current;

      // 눌린 집합은 시그널 peek로만 만든다 - 여기서 구독이 생기면 안 된다
      const pressed = new Set<string>();
      for (const id of ids) {
        const canonical = canonicalMap.get(id);
        if (canonical && getKeySignal(canonical).value) pressed.add(id);
      }
      const resolved = resolveSpriteTarget(pos, pressed);

      let baseSrc = resolveImageSource(pos.baseImage);
      if (baseSrc && failed.has(baseSrc)) baseSrc = null;
      let src = resolveImageSource(resolved.imageSrc);
      if (src && failed.has(src)) src = baseSrc;

      const playback = playbackRef.current;
      // 재트리거 소유권 이전 - 이전 재생의 콜백을 떼고 취소한다
      stopPlayback(el);
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
        restoreBaseImage(el);
      };

      const fromCss = spriteTransformToCss(resolved.transform);
      const toCss = spriteTransformToCss(pos.idleTransform);
      // 보간 없는 재생의 만료 복원 - 자세 이미지를 pressDurationMs 뒤 되돌린다
      const scheduleRestore = () => {
        playback.timer = window.setTimeout(() => {
          if (playbackRef.current.generation !== generation) return;
          playbackRef.current.timer = null;
          restoreIdleTransform(el, latestRef.current.position);
          restore();
        }, pos.pressDurationMs);
      };
      // 기본 모드에서 사용자가 --sprite-transform을 잡았으면 자세 transform은 그
      // 값으로 대체된 것이다. 애니메이션 원점은 사용자 CSS를 이기므로 여기서 걸러
      // whileHeld처럼 이미지만 바꾼다. 보간 자체는 컴포지터 경로를 지키려 native
      // transform에 건다 - 커스텀 속성 보간은 매 프레임 메인 스레드 스타일 재계산이다
      if (pos.useInlineStyles !== true && hasSpriteTransformOverride(el)) {
        scheduleRestore();
        return;
      }
      // WAAPI 부재·거부 공용 폴백 - 자세로 스냅했다가 시간 후 복귀 (보간 없음)
      const snapBack = () => {
        el.style.transform = fromCss;
        scheduleRestore();
      };

      const easing = resolveSpriteRenderEasing(pos.transitionEasing);
      let animation: Animation | null = null;
      if (typeof el.animate === 'function' && !rejectedEasings.has(easing)) {
        try {
          // 자세에서 시작해 idle로 돌아오는 한 방향 재생 - 스냅 타격 + 이즈 복귀.
          // fill: none이라 종료 후에는 CSS 변수 채널(idle)이 그대로 복귀값이다
          animation = el.animate(
            [{ transform: fromCss }, { transform: toCss }],
            {
              duration: pos.pressDurationMs,
              easing,
              fill: 'none',
            },
          );
        } catch (error) {
          // 문법 게이트는 엔진의 지원 여부까지는 알 수 없다. 여기서 던지면
          // 이미 자세 이미지로 바꾼 뒤라 복원 없이는 그대로 고착된다
          rejectedEasings.add(easing);
          console.error('[sprite] 엔진이 거부한 easing:', easing, error);
        }
      }

      if (animation) {
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
        snapBack();
      }
    };

    const unsubscribes = canonicals.map((canonical) =>
      subscribeKeyPressEdge(canonical, handleEdge),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      // whileHeld 전환·트리거 교체 시 진행 중 재생을 함께 끊는다
      stopPlayback(mountedImg);
      // 직접 쓴 src·visibility 잔상 제거 - React는 prop이 같으면 DOM을 다시
      // 쓰지 않으므로 여기서 현재 문서 기준으로 복원한다 (전환 시에는 key가
      // 노드를 갈아 끼우고, 같은 분기 안 재구독에는 이 복원이 잡는다)
      if (mountedImg) restoreBaseImage(mountedImg);
    };
  }, [isOneShot, canonicalKey]);

  if (position.hidden) return null;

  // 사용자 클래스는 위치 래퍼에, 표식은 안쪽 표면에 - 노브·카운터와 같은 배치라
  // 문서의 `.클래스 [data-sprite-element]` 선택자가 에디터와 오버레이에서 같이 먹는다.
  // 히트 기준은 활동 영역 박스(래퍼) - 에디터 선택 박스와 같은 의미이고 포즈 전환
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
      data-overlay-hit="true"
    >
      <div
        // 이미지 절대 배치의 포함 블록 - 래퍼와 같은 박스라 원점이 바뀌지 않는다
        style={{ width: '100%', height: '100%', position: 'relative' }}
        data-sprite-element="true"
        data-sprite-state={
          !isOneShot && pressedIds.size > 0 ? 'active' : 'inactive'
        }
      >
        {isOneShot
          ? mountOneShotImage && (
              <img
                // 분기별 key - 모드 전환 시 노드 재사용을 끊어 직접 쓴 src가
                // 다음 모드로 새어 나가지 않게 한다
                key="one-shot"
                ref={imgRef}
                src={idleBaseSrc ?? undefined}
                alt=""
                draggable={false}
                style={{
                  ...computeSpriteImageStyle(position, position.idleTransform),
                  willChange: 'transform',
                  // 기본 이미지가 없으면 재생 순간에만 보인다
                  ...(idleBaseSrc ? {} : { visibility: 'hidden' as const }),
                }}
                onError={(event) => {
                  // 재생이 DOM에 직접 쓴 src도 실제 실패 URL과 대조한다 -
                  // 늦게 도착한 이전 src의 오류가 멀쩡한 이미지를 낙인찍지 않게
                  const el = event.currentTarget;
                  const src = el.getAttribute('src');
                  if (!isErrorForCurrentSrc(el, src)) return;
                  markFailed(src);
                  // 직접 쓴 src는 React prop이 그대로라 리렌더가 걷어내지 못한다.
                  // 재생이 끝날 때까지 깨진 이미지를 두지 않게 여기서 되돌린다
                  restoreBaseImage(el, src);
                }}
              />
            )
          : heldTarget &&
            heldImageSrc && (
              <img
                key="held"
                src={heldImageSrc}
                alt=""
                draggable={false}
                style={{
                  // 외관 채널은 기본 모드에서 변수로 - 사용자 CSS가 !important 없이 이긴다
                  ...computeSpriteImageStyle(
                    position,
                    heldTarget.transform,
                    transitionCss,
                  ),
                  willChange: 'transform',
                }}
                onError={(event) => {
                  if (!isErrorForCurrentSrc(event.currentTarget, heldImageSrc))
                    return;
                  markFailed(heldImageSrc);
                }}
              />
            )}
      </div>
    </div>
  );
});

export default OverlaySpriteItem;
