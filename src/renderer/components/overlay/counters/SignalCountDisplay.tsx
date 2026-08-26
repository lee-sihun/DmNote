'use no memo';
import React from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import type { Signal } from '@preact/signals-react';
import CountDisplay, { type CountDisplayProps } from './CountDisplay';

// 카운터 시그널 구독을 이 래퍼로 격리 — 값 변경 커밋이 상위(Key/StatItem)까지
// 올라가지 않고 CountDisplay span 하나로 끝난다.
// 구독(.value 읽기)은 반드시 'use no memo' 파일에서만 — 컴파일 대상 컴포넌트에서 읽으면
// React Compiler가 시그널 identity 기준으로 값을 캐시해 숫자가 갱신되지 않는다
interface SignalCountDisplayProps extends Omit<CountDisplayProps, 'count'> {
  countSignal: Signal<number>;
}

const SignalCountDisplay = ({
  countSignal,
  ...rest
}: SignalCountDisplayProps) => {
  useSignals();
  return <CountDisplay count={countSignal.value ?? 0} {...rest} />;
};

export default SignalCountDisplay;
