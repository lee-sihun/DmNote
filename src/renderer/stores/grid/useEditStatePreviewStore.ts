import { useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';
import { supportsActiveVisualState } from './useGradientEditStore';

/**
 * 편집 상태 프리뷰 - 상태 스위치를 가진 피커가 열려 있는 동안 어느 요소를
 * 어느 상태(대기/입력)로 보여줄지 공유한다. 그라데이션 세션과 달리 spec
 * 페인트·축 소유권 없이 시각 상태만 담당하며, 캔버스 leaf의 previewActive는
 * 이 스토어가 유일한 원천이다 (형식·표면과 무관하게 같은 규칙)
 */

export type EditStateAnchor =
  | { kind: 'key' | 'stat' | 'graph' | 'knob'; id: string }
  | { kind: 'batch' };

export type EditPreviewState = 'idle' | 'active';

interface EditStatePreviewEntry {
  /** 발행자 소유권 - 다른 발행자가 덮어쓴 항목을 이전 발행자 정리가 지우지 못하게 */
  token: number;
  anchor: EditStateAnchor;
  state: EditPreviewState;
}

interface EditStatePreviewStore {
  /** 발행 스택 - 마지막 항목이 현재 프리뷰. 최신 발행자가 닫히면(회수)
      아직 살아 있는 이전 발행자가 복원된다 (피커 공존 대비) */
  entries: EditStatePreviewEntry[];
  publish: (
    token: number,
    anchor: EditStateAnchor,
    state: EditPreviewState,
  ) => void;
  /** 자기 토큰의 항목만 제거 - 스택 중간이어도 안전 */
  retract: (token: number) => void;
}

const anchorEquals = (a: EditStateAnchor, b: EditStateAnchor): boolean =>
  a.kind === 'batch' || b.kind === 'batch'
    ? a.kind === b.kind
    : a.kind === b.kind && a.id === b.id;

export const useEditStatePreviewStore = create<EditStatePreviewStore>(
  (set) => ({
    entries: [],
    publish: (token, anchor, state) =>
      set((prev) => {
        const top = prev.entries[prev.entries.length - 1];
        if (
          top &&
          top.token === token &&
          top.state === state &&
          anchorEquals(top.anchor, anchor)
        ) {
          return {};
        }
        // 같은 토큰의 이전 발행분은 제거하고 맨 위로 - 최근 상호작용 우선
        const others = prev.entries.filter((entry) => entry.token !== token);
        return { entries: [...others, { token, anchor, state }] };
      }),
    retract: (token) =>
      set((prev) =>
        prev.entries.some((entry) => entry.token === token)
          ? { entries: prev.entries.filter((entry) => entry.token !== token) }
          : {},
      ),
  }),
);

let publisherSeq = 0;

/**
 * 발행자 - anchor가 있는 동안 상태를 게시하고, anchor 소실·언마운트 시
 * 자기 발행분만 회수한다. anchor 객체는 렌더마다 새로 만들어져도 된다
 */
export function useEditStatePreviewPublisher(
  anchor: EditStateAnchor | null | undefined,
  state: EditPreviewState,
) {
  const tokenRef = useRef(0);
  if (tokenRef.current === 0) tokenRef.current = ++publisherSeq;
  const anchorKey = anchor
    ? anchor.kind === 'batch'
      ? 'batch'
      : `${anchor.kind}:${anchor.id}`
    : null;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  useLayoutEffect(() => {
    const token = tokenRef.current;
    const current = anchorRef.current;
    if (!anchorKey || !current) {
      useEditStatePreviewStore.getState().retract(token);
      return;
    }
    useEditStatePreviewStore.getState().publish(token, current, state);
  }, [anchorKey, state]);
  useLayoutEffect(() => {
    const token = tokenRef.current;
    return () => useEditStatePreviewStore.getState().retract(token);
  }, []);
}

/**
 * 캔버스 leaf 소비 - 매칭까지 selector 안에서 끝내고 boolean만 반환해
 * 비대상 요소는 발행·회수에도 리렌더되지 않는다.
 * batch 발행은 선택 포함 + active 시각 능력(key/knob)일 때만 참
 */
export function useEditStatePreviewActive(
  kind: 'key' | 'stat' | 'graph' | 'knob',
  id: string,
  isInBatchSelection = false,
): boolean {
  return useEditStatePreviewStore((store) => {
    const entry = store.entries[store.entries.length - 1];
    if (!entry || entry.state !== 'active') return false;
    if (entry.anchor.kind === 'batch') {
      return isInBatchSelection && supportsActiveVisualState(kind);
    }
    return entry.anchor.kind === kind && entry.anchor.id === id;
  });
}
