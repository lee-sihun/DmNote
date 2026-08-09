import React from 'react';
import type { DigitPopState } from '@hooks/ui/useDigitPop';

interface DigitPopLayerProps {
  pop: DigitPopState;
  /** 아래 input과 같은 타이포·색을 받아야 안 바뀐 자리가 제자리에 선다 */
  className?: string;
}

// input의 value는 브라우저가 그리는 단일 텍스트 노드라 자릿수를 따로 잡을 수 없다.
// 재생하는 동안만 같은 자리에 자릿수 span을 겹치고 input 글자는 투명으로 비운다.
// 값은 여전히 input이 갖고 있으므로 이 레이어는 화면 밖 낭독에서 제외한다
const DigitPopLayer = ({ pop, className = '' }: DigitPopLayerProps) => (
  <span
    aria-hidden
    className={`dmn-digit-pop absolute inset-0 ${className}`}
    style={{ '--dmn-digit-dir': pop.dir } as React.CSSProperties}
  >
    {pop.segments.map((segment, index) => (
      <span
        key={index}
        data-dmn-digit-changed={segment.step === null ? undefined : ''}
        style={
          segment.step === null
            ? undefined
            : ({ '--dmn-digit-step': segment.step } as React.CSSProperties)
        }
      >
        {segment.text}
      </span>
    ))}
  </span>
);

export default DigitPopLayer;
