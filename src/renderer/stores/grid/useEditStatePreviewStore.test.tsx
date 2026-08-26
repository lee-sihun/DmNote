/**
 * 편집 상태 프리뷰 스토어 계약 테스트
 * 발행 스택 소유권(마지막 발행자 우선, 회수 시 이전 발행자 복원)과
 * 발행자 훅 수명, 소비 selector의 매칭 규칙·리렌더 격리를 고정한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  useEditStatePreviewStore,
  useEditStatePreviewActive,
  useEditStatePreviewPublisher,
  type EditStateAnchor,
} from './useEditStatePreviewStore';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const KEY_A = '00000000-0000-4000-8000-000000000601';
const KEY_B = '00000000-0000-4000-8000-000000000602';

const publish = (
  token: number,
  anchor: EditStateAnchor,
  state: 'idle' | 'active',
) => useEditStatePreviewStore.getState().publish(token, anchor, state);

const topEntry = () => {
  const { entries } = useEditStatePreviewStore.getState();
  return entries[entries.length - 1] ?? null;
};

beforeEach(() => {
  useEditStatePreviewStore.setState({ entries: [] });
});

describe('useEditStatePreviewStore 소유권', () => {
  it('마지막 발행자가 이기고, 회수하면 이전 발행자가 복원된다', () => {
    publish(1, { kind: 'key', id: KEY_A }, 'active');
    publish(2, { kind: 'key', id: KEY_B }, 'active');
    expect(topEntry()).toMatchObject({ token: 2 });
    // B가 닫히면 아직 살아 있는 A가 복원 - 피커 공존 대비
    useEditStatePreviewStore.getState().retract(2);
    expect(topEntry()).toMatchObject({
      token: 1,
      anchor: { kind: 'key', id: KEY_A },
    });
    useEditStatePreviewStore.getState().retract(1);
    expect(topEntry()).toBeNull();
  });

  it('덮인 발행자의 회수는 최상단 항목을 건드리지 않는다', () => {
    publish(1, { kind: 'key', id: KEY_A }, 'active');
    publish(2, { kind: 'key', id: KEY_B }, 'active');
    useEditStatePreviewStore.getState().retract(1);
    expect(topEntry()).toMatchObject({ token: 2 });
  });

  it('같은 토큰·앵커·상태 재발행은 상태 객체를 갈지 않는다', () => {
    publish(1, { kind: 'key', id: KEY_A }, 'active');
    const before = useEditStatePreviewStore.getState().entries;
    publish(1, { kind: 'key', id: KEY_A }, 'active');
    expect(useEditStatePreviewStore.getState().entries).toBe(before);
  });

  it('스택 중간 발행자의 재발행은 맨 위로 올라온다', () => {
    publish(1, { kind: 'key', id: KEY_A }, 'idle');
    publish(2, { kind: 'key', id: KEY_B }, 'active');
    publish(1, { kind: 'key', id: KEY_A }, 'active');
    expect(topEntry()).toMatchObject({ token: 1, state: 'active' });
    expect(useEditStatePreviewStore.getState().entries).toHaveLength(2);
  });
});

describe('useEditStatePreviewPublisher 수명', () => {
  let container: HTMLDivElement;
  let root: Root;

  const Publisher = ({
    anchor,
    state,
  }: {
    anchor: EditStateAnchor | null;
    state: 'idle' | 'active';
  }) => {
    useEditStatePreviewPublisher(anchor, state);
    return null;
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('앵커 소실·언마운트에 자기 발행분만 회수한다', () => {
    act(() =>
      root.render(
        <Publisher anchor={{ kind: 'key', id: KEY_A }} state="active" />,
      ),
    );
    expect(topEntry()).toMatchObject({ anchor: { id: KEY_A } });
    // 앵커 소실(피커 닫힘) - 마운트 유지 중 회수
    act(() => root.render(<Publisher anchor={null} state="active" />));
    expect(topEntry()).toBeNull();
    // 재발행 후 언마운트 회수
    act(() =>
      root.render(
        <Publisher anchor={{ kind: 'key', id: KEY_A }} state="idle" />,
      ),
    );
    expect(topEntry()).toMatchObject({ state: 'idle' });
    act(() => root.unmount());
    expect(topEntry()).toBeNull();
    act(() => {
      root = createRoot(container);
    });
  });

  it('두 발행자 교차: 나중 발행자가 사라지면 먼저 열린 발행자가 복원된다', () => {
    act(() =>
      root.render(
        <>
          <Publisher anchor={{ kind: 'key', id: KEY_A }} state="active" />
          <Publisher anchor={{ kind: 'key', id: KEY_B }} state="idle" />
        </>,
      ),
    );
    // 렌더 순서상 B가 나중 발행 - 최상단
    expect(topEntry()).toMatchObject({ anchor: { id: KEY_B }, state: 'idle' });
    act(() =>
      root.render(
        <Publisher anchor={{ kind: 'key', id: KEY_A }} state="active" />,
      ),
    );
    expect(topEntry()).toMatchObject({
      anchor: { id: KEY_A },
      state: 'active',
    });
  });
});

describe('useEditStatePreviewActive 매칭', () => {
  let container: HTMLDivElement;
  let root: Root;
  const renders: Record<string, number> = {};

  interface ProbeProps {
    name: string;
    kind: 'key' | 'stat' | 'graph' | 'knob';
    id: string;
    inBatch?: boolean;
  }

  const Probe = ({ name, kind, id, inBatch = false }: ProbeProps) => {
    const active = useEditStatePreviewActive(kind, id, inBatch);
    // 커밋 횟수로 리렌더를 센다 - 렌더 중 외부 값 변경 금지(React Compiler)
    React.useEffect(() => {
      renders[name] = (renders[name] ?? 0) + 1;
    });
    return <i data-probe={name} data-active={active ? '1' : '0'} />;
  };

  const activeOf = (name: string) =>
    container
      .querySelector(`[data-probe="${name}"]`)
      ?.getAttribute('data-active');

  beforeEach(() => {
    for (const key of Object.keys(renders)) delete renders[key];
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('단일 앵커는 kind·id 일치에만 반응하고 비대상은 리렌더되지 않는다', () => {
    act(() => {
      root.render(
        <>
          <Probe name="target" kind="key" id={KEY_A} />
          <Probe name="other" kind="key" id={KEY_B} />
        </>,
      );
    });
    expect(renders.other).toBe(1);
    act(() => publish(1, { kind: 'key', id: KEY_A }, 'active'));
    expect(activeOf('target')).toBe('1');
    expect(activeOf('other')).toBe('0');
    act(() => publish(1, { kind: 'key', id: KEY_A }, 'idle'));
    expect(activeOf('target')).toBe('0');
    act(() => useEditStatePreviewStore.getState().retract(1));
    // 비대상 키는 발행·상태 변경·회수 전 과정에서 리렌더 0회 추가
    expect(renders.other).toBe(1);
  });

  it('batch 앵커는 선택 포함 + active 시각 능력(key/knob)일 때만 참', () => {
    act(() => {
      root.render(
        <>
          <Probe name="key-in" kind="key" id={KEY_A} inBatch />
          <Probe name="key-out" kind="key" id={KEY_B} />
          <Probe name="knob-in" kind="knob" id={KEY_B} inBatch />
          <Probe name="stat-in" kind="stat" id={KEY_A} inBatch />
        </>,
      );
    });
    act(() => publish(7, { kind: 'batch' }, 'active'));
    expect(activeOf('key-in')).toBe('1');
    expect(activeOf('knob-in')).toBe('1');
    expect(activeOf('key-out')).toBe('0');
    expect(activeOf('stat-in')).toBe('0');
  });
});
