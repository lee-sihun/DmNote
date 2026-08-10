import React from 'react';
import { usePressGatedSwap } from '@hooks/usePressGatedSwap';
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
  const { ref } = usePressGatedSwap<HTMLDivElement>(visualChecked);

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
        visualChecked ? 'bg-accent' : 'bg-line-strong hover:bg-white/[0.18]'
      }`}
      onClick={handleClick}
    >
      {/* 이동량은 --ui-toggle-travel이 소유, 트랙 28 - 노브 12 - 인셋 2×2 */}
      <div className="dmn-toggle-thumb absolute top-[2px] left-[2px] w-[12px] h-[12px] rounded-full bg-white shadow-elevation-1" />
    </div>
  );
};

export default Checkbox;
