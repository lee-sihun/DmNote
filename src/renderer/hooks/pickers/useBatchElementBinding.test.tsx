// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  captureBatchElementBinding,
  useBatchElementBinding,
  type BatchElementBinding,
} from './useBatchElementBinding';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('captureBatchElementBinding', () => {
  // index는 스냅샷 한정 locator다 - stale index가 다른 요소를 결합하지 않게
  // 선택의 안정 ID 자체를 캡처한다 (positions 재조회 없음)
  it('선택 요소의 안정 ID를 그대로 캡처한다', () => {
    const binding = captureBatchElementBinding({
      key: [{ id: ID_A }, { id: ID_B }],
      stat: [],
    });

    expect(binding.binding).toBe('element-id');
    expect(binding.selection.key).toEqual([ID_A, ID_B]);
    expect(binding.selection.stat).toBeUndefined();
  });

  // 일부만 ID로 적용하고 나머지를 조용히 빠뜨리는 반쪽 적용 금지
  it('합성 폴백 ID가 하나라도 있으면 배치 전체를 legacy로 보낸다', () => {
    const binding = captureBatchElementBinding({
      key: [{ id: ID_A }, { id: 'key-0' }],
    });

    expect(binding.binding).toBe('session-mode');
    expect(binding.selection).toEqual({});
  });
});

describe('useBatchElementBinding', () => {
  let host: HTMLDivElement;
  let root: Root;
  const seen: { latest: BatchElementBinding | null } = { latest: null };
  const source: { ids: string[] } = { ids: [] };

  const Probe = ({ open }: { open: boolean }) => {
    const binding = useBatchElementBinding(open, () =>
      captureBatchElementBinding({
        key: source.ids.map((id) => ({ id })),
      }),
    );
    React.useEffect(() => {
      seen.latest = binding;
    });
    return null;
  };

  beforeEach(() => {
    seen.latest = null;
    source.ids = [ID_A];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  // 배치 피커는 선택 변경에 언마운트되지 않으므로 open 시점 고정이 핵심
  it('open 시점에 1회 캡처하고 닫힐 때까지 불변으로 유지한다', () => {
    act(() => root.render(<Probe open={false} />));
    expect(seen.latest?.binding).toBe('session-mode');

    act(() => root.render(<Probe open />));
    expect(seen.latest?.selection.key).toEqual([ID_A]);

    // open 중 선택이 바뀌어도 결합은 시작 시점 그대로
    act(() => {
      source.ids = [ID_B];
      root.render(<Probe open />);
    });
    expect(seen.latest?.selection.key).toEqual([ID_A]);

    // 닫았다 다시 열면 재캡처
    act(() => root.render(<Probe open={false} />));
    act(() => root.render(<Probe open />));
    expect(seen.latest?.selection.key).toEqual([ID_B]);
  });

  // 소유자가 리마운트 경계 안에 있으면 open 중 선택 교체가 재캡처를 만든다.
  // 이 훅의 소유자를 EditSessionBoundary 밖에 두는 이유를 고정한다
  it('소유자가 리마운트되면 open 상태여도 재캡처된다', () => {
    act(() => root.render(<Probe key="first" open />));
    expect(seen.latest?.selection.key).toEqual([ID_A]);

    act(() => {
      source.ids = [ID_B];
      root.render(<Probe key="second" open />);
    });
    expect(seen.latest?.selection.key).toEqual([ID_B]);
  });
});
