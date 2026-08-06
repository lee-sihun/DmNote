import { describe, expect, it } from 'vitest';
import { computeLayout } from './useLayoutComputation';
import { NOTE_SETTINGS_DEFAULTS } from '@src/types/settings/noteSettings';
import type { KeyPosition } from '@src/types/key/keys';

const PADDING = 30;
const TRACK_HEIGHT = NOTE_SETTINGS_DEFAULTS.trackHeight;

const keyAt = (
  dx: number,
  dy: number,
  overrides: Partial<KeyPosition> = {},
): KeyPosition =>
  ({
    dx,
    dy,
    width: 60,
    height: 60,
    hidden: false,
    ...overrides,
  } as KeyPosition);

const layoutInput = (
  positions: KeyPosition[],
  direction: 'up' | 'down' | 'left' | 'right' = 'up',
) => ({
  currentKeys: positions.map((_, i) => `K${i}`),
  currentPositions: positions,
  currentStatPositions: [],
  currentGraphPositions: [],
  currentKnobPositions: [],
  trackHeight: TRACK_HEIGHT,
  noteSettings: { ...NOTE_SETTINGS_DEFAULTS, direction },
});

describe('computeLayout 4방향 일반화', () => {
  it('전역 up은 기존 동작과 동일하다 (top 마진만, 트랙 바닥 = 공통 상단선)', () => {
    const result = computeLayout(layoutInput([keyAt(0, 0), keyAt(100, 0)]));
    expect(result.margins).toEqual({
      top: TRACK_HEIGHT,
      bottom: 0,
      left: 0,
      right: 0,
    });
    expect(result.topMostY).toBe(PADDING + TRACK_HEIGHT);
    const track = result.webglTracks[0];
    expect(track?.direction).toBe('up');
    expect(track?.position.dy).toBe(PADDING + TRACK_HEIGHT);
  });

  it('전역 down은 bottom 마진을 예약하고 히트라인이 콘텐츠 아래다', () => {
    const result = computeLayout(layoutInput([keyAt(0, 0)], 'down'));
    expect(result.margins).toEqual({
      top: 0,
      bottom: TRACK_HEIGHT,
      left: 0,
      right: 0,
    });
    // 콘텐츠(키 60px)는 PADDING부터, 히트라인 = PADDING + 60
    const track = result.webglTracks[0];
    expect(track?.direction).toBe('down');
    expect(track?.position.dy).toBe(PADDING + 60);
    // down의 O는 오른쪽 코너 (중앙 정렬 기본, noteWidth 미설정 = 키 폭)
    expect(track?.position.dx).toBe(PADDING + 60);
  });

  it('키별 오버라이드로 한 탭에 up과 left가 혼재하면 두 변 모두 예약된다', () => {
    const result = computeLayout(
      layoutInput([
        keyAt(0, 0),
        keyAt(100, 0, { noteDirection: 'left' } as Partial<KeyPosition>),
      ]),
    );
    expect(result.margins.top).toBe(TRACK_HEIGHT);
    expect(result.margins.left).toBe(TRACK_HEIGHT);
    expect(result.margins.bottom).toBe(0);
    // 콘텐츠가 left 마진만큼 오른쪽으로 밀림
    expect(result.positionOffset.x).toBe(PADDING + TRACK_HEIGHT);
    const leftTrack = result.webglTracks[1];
    expect(leftTrack?.direction).toBe('left');
    // left 히트라인 = PADDING + marginLeft (콘텐츠 왼쪽 변)
    expect(leftTrack?.position.dx).toBe(PADDING + TRACK_HEIGHT);
  });

  it('autoCorrection false는 키 자신의 변을 히트라인으로 쓴다', () => {
    const result = computeLayout(
      layoutInput([
        keyAt(0, 0, {
          noteAutoYCorrection: false,
          noteDirection: 'right',
        } as Partial<KeyPosition>),
      ]),
    );
    const track = result.webglTracks[0];
    // right 히트라인 = 표시 좌표의 키 오른쪽 변 = offsetX + 60
    expect(track?.position.dx).toBe(result.positionOffset.x + 60);
  });

  it('표시 키가 없으면 기존 위쪽 예약으로 폴백한다', () => {
    const result = computeLayout(
      layoutInput([keyAt(0, 0, { hidden: true })], 'down'),
    );
    expect(result.margins.top).toBe(TRACK_HEIGHT);
    expect(result.margins.bottom).toBe(0);
  });
});
