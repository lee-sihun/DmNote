import { useEffect, useState } from 'react';

import type { AutoUpdatePhase } from '@stores/useUpdateStore';

interface UpdateProgressLabelProps {
  /** 교차 트리거. 단계가 바뀔 때만 줄을 갈아 끼운다 */
  phase: AutoUpdatePhase;
  text: string;
}

interface Line {
  seq: number;
  phase: AutoUpdatePhase;
  text: string;
}

// 나가는 줄을 걷어내는 시점. 회수는 항상 타이머가 한다, animationend를 듣지 않는다.
// --ui-text-swap-duration(--ui-duration-fast, 현재 120ms)보다 넉넉해야 하고
// 그 전역 다이얼을 올리면 여기도 같이 올려야 한다
const LINE_EXIT_MS = 320;

/**
 * 업데이트 버튼 라벨. 단계가 바뀌면 두 줄이 같은 자리에서 교차한다.
 * 퍼센트가 오르는 동안은 줄을 그대로 두고 글자만 갈아 끼워야 한다 -
 * 매 이벤트마다 줄을 갈면 초당 서너 번 깜빡여서 숫자를 눈으로 좇을 수 없다
 */
const UpdateProgressLabel = ({ phase, text }: UpdateProgressLabelProps) => {
  const [current, setCurrent] = useState<Line>({ seq: 0, phase, text });
  const [leaving, setLeaving] = useState<Line | null>(null);

  // 렌더 중 상태 보정. 다음 렌더에서 바로 수렴하므로 효과로 미루면
  // 한 프레임 동안 이전 단계의 글자가 남는다
  if (current.phase !== phase) {
    setLeaving(current);
    setCurrent({ seq: current.seq + 1, phase, text });
  } else if (current.text !== text) {
    setCurrent({ ...current, text });
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), LINE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <span className="dmn-gauge-label">
      {leaving && (
        <span
          key={`${leaving.seq}-${leaving.phase}`}
          className="dmn-gauge-line"
          data-leaving="true"
          aria-hidden="true"
        >
          <span className="dmn-gauge-ink">{leaving.text}</span>
        </span>
      )}
      <span
        key={`${current.seq}-${current.phase}`}
        className="dmn-gauge-line"
        data-enter={current.seq > 0 ? 'true' : undefined}
      >
        <span className="dmn-gauge-ink">{current.text}</span>
      </span>
    </span>
  );
};

export default UpdateProgressLabel;
