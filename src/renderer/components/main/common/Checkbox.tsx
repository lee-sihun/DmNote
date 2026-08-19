import React from 'react';
import { usePressGatedSwap } from '@hooks/usePressGatedSwap';
import { useSwitchDrag } from '@hooks/useSwitchDrag';
import {
  useOptimisticBooleanCommit,
  type BooleanCommitStrategy,
} from '@hooks/useOptimisticBooleanCommit';

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  commitStrategy?: BooleanCommitStrategy;
}

// 토글 스위치 — 이름은 기존 사용처 호환을 위해 유지.
// 직접 클릭에서 온 변경만 노브 슬라이드, 외부 상태 변경은 즉시 이동
const Checkbox = ({
  checked,
  onChange,
  commitStrategy = 'sync',
}: CheckboxProps) => {
  const { value: visualChecked, toggle } = useOptimisticBooleanCommit({
    canonicalValue: checked,
    onCommit: onChange,
    strategy: commitStrategy,
  });
  const { ref, markPress } = usePressGatedSwap<HTMLDivElement>(visualChecked);
  const drag = useSwitchDrag({
    checked: visualChecked,
    onFlip: toggle,
    markPress,
  });
  // 드래그 중에는 트랙 색이 노브가 넘어간 쪽을 미리 따라간다. 표시 전용이라
  // aria-checked에는 싣지 않는다 - 확정 안 된 값을 보조기술이 읽으면 안 된다.
  // 노브 위치는 드래그 중 인라인 translate가 소유하므로 aria 규칙과 어긋나지 않는다
  const displayChecked = drag.dragValue ?? visualChecked;

  // 드래그로 끝난 제스처의 click은 훅이 창 캡처 단계에서 이미 삼킨다
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };

  return (
    <div
      ref={ref}
      role="switch"
      aria-checked={visualChecked}
      className={`dmn-toggle-track relative w-[28px] h-[16px] rounded-full cursor-pointer transition-colors duration-base ease-out-expo ${
        displayChecked ? 'bg-accent' : 'bg-line-strong hover:bg-white/[0.19]'
      }`}
      onClick={handleClick}
      {...drag.handlers}
    >
      {/* 이동량은 --ui-toggle-travel이 소유, 트랙 28 - 노브 12 - 인셋 2×2.
          드래그 훅이 이 클래스로 노브를 찾으므로 클래스명은 계약 */}
      <div className="dmn-toggle-thumb absolute top-[2px] left-[2px] w-[12px] h-[12px] rounded-full bg-white shadow-elevation-1" />
    </div>
  );
};

export default Checkbox;
