import React, { useEffect, useRef } from 'react';
import { usePressGatedSwap } from '@hooks/usePressGatedSwap';
import { useSwitchDrag } from '@hooks/useSwitchDrag';
import {
  useOptimisticBooleanCommit,
  type BooleanCommitStrategy,
} from '@hooks/useOptimisticBooleanCommit';

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel?: string;
  commitStrategy?: BooleanCommitStrategy;
  /** 드래그로 노브가 넘어간 쪽까지 반영한 표시 값. 확정 전 값이라 표시 전용으로만 쓴다 */
  onDisplayChange?: (value: boolean) => void;
}

// 토글 스위치 - 이름은 기존 사용처 호환을 위해 유지
// 직접 클릭에서 온 변경만 노브 슬라이드, 외부 상태 변경은 즉시 이동
const Checkbox = ({
  checked,
  onChange,
  ariaLabel,
  commitStrategy = 'sync',
  onDisplayChange,
}: CheckboxProps) => {
  // 트랙 ref는 두 훅이 나눠 쓴다. 커밋 프레임과 표식 프레임 모두 트랙이 사는 창 기준
  const trackRef = useRef<HTMLDivElement>(null);
  const { value: visualChecked, toggle } = useOptimisticBooleanCommit({
    canonicalValue: checked,
    onCommit: onChange,
    strategy: commitStrategy,
    frameHostRef: trackRef,
  });
  const { markPress } = usePressGatedSwap<HTMLDivElement>(
    visualChecked,
    trackRef,
  );
  const drag = useSwitchDrag({
    checked: visualChecked,
    onFlip: toggle,
    markPress,
  });
  // 드래그 중에는 트랙 색이 노브가 넘어간 쪽을 미리 따라간다. 표시 전용이라
  // aria-checked에는 싣지 않는다 - 확정 안 된 값을 보조기술이 읽으면 안 된다.
  // 노브 위치는 드래그 중 인라인 translate가 소유하므로 aria 규칙과 어긋나지 않는다
  const displayChecked = drag.dragValue ?? visualChecked;

  // 트랙 색만 쓰던 값을 부모도 볼 수 있게 흘린다 - 노브를 끄는 동안
  // 아래 설명이 함께 바뀌어야 손을 떼기 전에 결과를 알 수 있다
  useEffect(() => {
    onDisplayChange?.(displayChecked);
  }, [displayChecked, onDisplayChange]);

  // 드래그로 끝난 제스처의 click은 훅이 창 캡처 단계에서 이미 삼킨다
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };

  return (
    <div
      ref={trackRef}
      role="switch"
      aria-checked={visualChecked}
      aria-label={ariaLabel}
      className={`dmn-toggle-track relative w-[28px] h-[16px] rounded-full cursor-pointer transition-colors duration-base ease-out-expo ${
        displayChecked ? 'bg-accent' : 'bg-line-strong hover:bg-white/[0.19]'
      }`}
      onClick={handleClick}
      {...drag.handlers}
    >
      {/* 이동량은 --ui-toggle-travel이 소유, 트랙 28 - 노브 12 - 인셋 2×2.
          드래그 훅이 이 클래스로 노브를 찾으므로 클래스명은 계약.
          반지름은 rounded-full이 아니라 CSS가 소유한다 - 누름 캡슐이 scale과
          짝지어 반지름을 되돌려야 해서 전환 가능한 값이어야 한다 */}
      <div className="dmn-toggle-thumb absolute top-[2px] left-[2px] w-[12px] h-[12px] bg-white shadow-elevation-1" />
    </div>
  );
};

export default Checkbox;
