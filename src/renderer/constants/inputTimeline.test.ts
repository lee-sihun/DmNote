import { describe, expect, it } from 'vitest';
import {
  INPUT_TIMELINE_PRESENTATION_BUFFER_MS,
  nominalTimelineDelayMs,
} from './inputTimeline';

describe('입력 타임라인 화면 재생 버퍼', () => {
  it('사용자 단노트 구분 시간과 별도로 설정된 버퍼를 더한다', () => {
    for (const thresholdMs of [0, 37, 137, 2000]) {
      expect(nominalTimelineDelayMs(thresholdMs)).toBe(
        thresholdMs + INPUT_TIMELINE_PRESENTATION_BUFFER_MS,
      );
    }
  });
});
