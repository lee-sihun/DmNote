import React, { useCallback } from 'react';
import { prefersReducedMotion } from '@utils/animation/motionPreferences';

const PLAY_ATTR = 'data-dmn-icon-play';

// getAnimations는 CSS 트랜지션도 같이 준다. 버튼에는 색 트랜지션이 걸려 있어서
// 이걸 안 걸러내면 애니메이션이 끝나는 순간 커서가 빠질 때 색 전환이
// "아직 도는 중"으로 잡히고, 재생 표시가 안 내려가 다시는 재생되지 않는다
const isRunningAnimation = (animation: Animation) =>
  'animationName' in animation && animation.playState === 'running';

const hasRunningAnimation = (el: HTMLElement) =>
  el.getAnimations({ subtree: true }).some(isRunningAnimation);

// 툴바 아이콘 호버 모션. 값은 main.css의 keyframe이, 재생 여부는 DOM 속성이 소유한다.
// 상태를 React에 두지 않는 건 의도 - 애니메이션 재시작은 속성을 지웠다 다시 넣어야 하는데
// 상태로 관리하면 이벤트가 한 번 어긋났을 때 재생 표시가 남아 영구히 잠긴다.
// 실제로 도는 애니메이션을 매번 다시 확인하므로 어긋나도 다음 호버에서 스스로 풀린다.
// 덤으로 호버마다 리렌더가 없다.
//
// 누를 때 재생 중이던 모션은 끊지 않고 그대로 끝까지 둔다.
// keyframe은 트랜지션과 달리 중간에서 낚아챌 수 없어 끊으면 값이 튀고,
// 부드럽게 되돌려도 중간에 방향이 꺾이는 게 그대로 보인다.
// 누름의 피드백은 버튼 배경과 클릭 결과가 이미 담당하므로 아이콘까지 반응할 이유가 없다.
// 이게 성립하려면 아이콘의 모션 대상이 상태에 따라 바뀌지 않아야 한다 -
// 눈 아이콘이 켜짐·꺼짐 모두 동공만 움직이는 이유
export const useIconMotion = () => {
  const start = useCallback((el: HTMLElement) => {
    if (prefersReducedMotion() || hasRunningAnimation(el)) return;
    // 속성이 남아 있으면 다시 넣어도 재시작되지 않는다. 지우고 스타일을 한 번 확정시킨다
    if (el.hasAttribute(PLAY_ATTR)) {
      el.removeAttribute(PLAY_ATTR);
      void el.offsetWidth;
    }
    el.setAttribute(PLAY_ATTR, '');
  }, []);

  // 터치는 탭 한 번에 pointerenter와 click이 같이 오므로 마우스만 받는다
  const onPointerEnter = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'mouse') return;
      start(event.currentTarget);
    },
    [start],
  );

  // 키보드로 이동해 온 경우만 재생. 클릭으로 들어온 포커스는 :focus-visible에 안 걸린다
  const onFocus = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.matches(':focus-visible')) return;
      start(event.currentTarget);
    },
    [start],
  );

  // 파트가 여러 개면 animationend도 여러 번 온다.
  // 아직 도는 게 남아 있으면 흘려보내고 마지막 하나에서만 내린다
  const onAnimationEnd = useCallback(
    (event: React.AnimationEvent<HTMLElement>) => {
      if (hasRunningAnimation(event.currentTarget)) return;
      event.currentTarget.removeAttribute(PLAY_ATTR);
    },
    [],
  );

  return { motionProps: { onPointerEnter, onFocus, onAnimationEnd } };
};
