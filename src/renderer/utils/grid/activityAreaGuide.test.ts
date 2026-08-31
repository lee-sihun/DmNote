import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_AREA_GUIDE_COLOR,
  activityAreaGuideMetrics,
  editorChromeScale,
} from './activityAreaGuide';

describe('activityAreaGuideMetrics', () => {
  it('색은 토큰 한 곳에서 온다 - 아이템 클래스와 고스트 인라인이 같은 값을 쓴다', () => {
    expect(ACTIVITY_AREA_GUIDE_COLOR).toBe('var(--ui-guide-activity)');
  });

  it('배율 1에서는 원래 규격 그대로다', () => {
    expect(activityAreaGuideMetrics(1)).toEqual({
      borderWidth: '1px',
      borderRadius: '4px',
    });
  });

  it('확대하면 화면 굵기가 유지되도록 역수로 줄어든다', () => {
    expect(activityAreaGuideMetrics(4)).toEqual({
      borderWidth: '0.25px',
      borderRadius: '1px',
    });
    expect(activityAreaGuideMetrics(0.5)).toEqual({
      borderWidth: '2px',
      borderRadius: '8px',
    });
  });

  it('0 이하·비유한 배율은 무보정으로 방어한다', () => {
    expect(editorChromeScale(0)).toBe(1);
    expect(editorChromeScale(-2)).toBe(1);
    expect(editorChromeScale(Number.NaN)).toBe(1);
    expect(editorChromeScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
