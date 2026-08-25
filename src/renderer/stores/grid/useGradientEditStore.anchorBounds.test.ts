import { describe, it, expect, beforeEach } from 'vitest';
import { useGradientEditStore } from './useGradientEditStore';
import type { GradientEditSession } from './useGradientEditStore';

const sessionFor = (sessionKey: string): GradientEditSession => ({
  anchor: { kind: 'key', id: 'k1' },
  sessionKey,
  surface: 'counterFill',
  stateMode: 'idle',
  spec: {
    angle: 90,
    stops: [
      { color: '#000000', pos: 0 },
      { color: '#FFFFFF', pos: 1 },
    ],
  },
  selectedIndex: 0,
  selectStop: () => undefined,
  apply: () => undefined,
});

const BOUNDS = { x: 10, y: 80, width: 24, height: 14 };

beforeEach(() => {
  useGradientEditStore.getState().setSession(null);
});

describe('gradient 앵커 박스 레지스트리', () => {
  it('현재 세션 key만 등록되고 다른 key는 무시된다', () => {
    const store = useGradientEditStore.getState();
    store.setSession(sessionFor('a'));
    store.setAnchorBounds('b', BOUNDS);
    expect(useGradientEditStore.getState().anchorBounds).toBeNull();
    store.setAnchorBounds('a', BOUNDS);
    expect(useGradientEditStore.getState().anchorBounds).toEqual({
      sessionKey: 'a',
      bounds: BOUNDS,
      origin: null,
    });
  });

  it('등록 origin은 함께 보관되고 origin만 달라져도 갱신된다', () => {
    const store = useGradientEditStore.getState();
    store.setSession(sessionFor('a'));
    store.setAnchorBounds('a', BOUNDS, { x: 5, y: 7 });
    expect(useGradientEditStore.getState().anchorBounds).toEqual({
      sessionKey: 'a',
      bounds: BOUNDS,
      origin: { x: 5, y: 7 },
    });
    const before = useGradientEditStore.getState().anchorBounds;
    store.setAnchorBounds('a', { ...BOUNDS }, { x: 5, y: 7 });
    expect(useGradientEditStore.getState().anchorBounds).toBe(before);
    store.setAnchorBounds('a', BOUNDS, { x: 6, y: 7 });
    expect(useGradientEditStore.getState().anchorBounds?.origin).toEqual({
      x: 6,
      y: 7,
    });
  });

  it('세션 교체·종료 시 등록이 초기화된다', () => {
    const store = useGradientEditStore.getState();
    store.setSession(sessionFor('a'));
    store.setAnchorBounds('a', BOUNDS);
    store.setSession(sessionFor('b'));
    expect(useGradientEditStore.getState().anchorBounds).toBeNull();

    useGradientEditStore.getState().setAnchorBounds('b', BOUNDS);
    store.setSession(null);
    expect(useGradientEditStore.getState().anchorBounds).toBeNull();
  });

  it('null 등록은 해제이고 동일 박스 재등록은 알림을 만들지 않는다', () => {
    const store = useGradientEditStore.getState();
    store.setSession(sessionFor('a'));
    store.setAnchorBounds('a', BOUNDS);
    const before = useGradientEditStore.getState().anchorBounds;
    store.setAnchorBounds('a', { ...BOUNDS });
    expect(useGradientEditStore.getState().anchorBounds).toBe(before);
    store.setAnchorBounds('a', null);
    expect(useGradientEditStore.getState().anchorBounds).toBeNull();
  });
});
