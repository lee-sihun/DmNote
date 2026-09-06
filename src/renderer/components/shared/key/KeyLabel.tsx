import React, { useRef } from 'react';
import { useLabelGlyphPaint } from '@hooks/shared/useLabelGlyphPaint';

interface KeyLabelProps {
  text: string;
  /** 라벨 노드 전용 페인트 (인라인 우선 모드의 그라데이션 클립 승격분) */
  paintStyle?: React.CSSProperties;
  /** 라벨 span에 그대로 얹을 레이아웃·타이포 스타일 */
  style?: React.CSSProperties;
  className?: string;
  /** idle·active 어느 상태든 저장 그라데이션이 있으면 true - 측정 수명 유지 */
  hasGradient?: boolean;
  /** 측정 캐시 키 - 타이포그래피와 표시 상태 서명 */
  metricsDep?: string;
}

/**
 * 키·스탯 라벨 공용 렌더. 에디터·오버레이·OBS가 같은 DOM과 측정 계약을
 * 공유해 그라데이션 페인트 박스와 축 앵커가 어긋나지 않게 한다
 */
const KeyLabel = ({
  text,
  paintStyle,
  style,
  className,
  hasGradient = false,
  metricsDep = '',
}: KeyLabelProps) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLabelGlyphPaint(ref, hasGradient, text, metricsDep);
  return (
    <span
      ref={ref}
      data-key-label
      className={
        className ? `text-safe-inline ${className}` : 'text-safe-inline'
      }
      style={style || paintStyle ? { ...style, ...paintStyle } : undefined}
    >
      {text}
    </span>
  );
};

export default KeyLabel;
