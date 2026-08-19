// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Checkbox from './Checkbox';

// 트랙 28 - 노브 12 - 인셋 2×2 = 이동 폭 12. jsdom은 CSS를 안 물리므로
// 토큰 대신 실측 경로가 타도록 사각형만 심는다
const TRACK = { x: 100, y: 0, width: 28, height: 16 };
const THUMB = { width: 12, height: 12 };
const TRAVEL = TRACK.width - THUMB.width - (TRACK.height - THUMB.height);

const rect = (width: number, height: number, left = 0): DOMRect =>
  ({
    x: left,
    y: 0,
    width,
    height,
    left,
    right: left + width,
    top: 0,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect);

describe('Checkbox 노브 드래그', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  const track = () => host.querySelector<HTMLElement>('[role="switch"]')!;
  const thumb = () => host.querySelector<HTMLElement>('.dmn-toggle-thumb')!;

  const flushRaf = () => {
    const callbacks = [...rafCallbacks.values()];
    rafCallbacks.clear();
    act(() => callbacks.forEach((callback) => callback(performance.now())));
  };

  const pointer = (type: string, init: Record<string, unknown> = {}) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      isPrimary: { value: true },
    });
    return event;
  };

  const send = (type: string, init: Record<string, unknown> = {}) =>
    act(() => {
      track().dispatchEvent(pointer(type, init));
    });

  // 실제 브라우저는 드래그 뒤에도 click을 한 번 더 보낸다
  const clickAfterRelease = () =>
    act(() => {
      track().dispatchEvent(pointer('click'));
    });

  // 트랙 28px에 이동 폭 12px이라 끝까지 끌면 손이 트랙 밖에서 떨어진다.
  // 그때 브라우저는 click을 트랙이 아니라 공통 조상에 쏜다
  const clickOnAncestorAfterRelease = () =>
    act(() => {
      host.dispatchEvent(pointer('click'));
    });

  const render = (checked: boolean, onChange: () => void) => {
    act(() => root.render(<Checkbox checked={checked} onChange={onChange} />));
    vi.spyOn(track(), 'getBoundingClientRect').mockReturnValue(
      rect(TRACK.width, TRACK.height, TRACK.x),
    );
    vi.spyOn(thumb(), 'getBoundingClientRect').mockReturnValue(
      rect(THUMB.width, THUMB.height),
    );
  };

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextRafId;
      nextRafId += 1;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('반대편까지 끌고 놓으면 한 번만 뒤집는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('켜짐 상태를 왼쪽으로 끌어 놓으면 꺼진다', () => {
    const onChange = vi.fn();
    render(true, onChange);

    send('pointerdown', { clientX: TRACK.x + 20 });
    send('pointermove', { clientX: TRACK.x + 20 - TRAVEL });
    send('pointerup', { clientX: TRACK.x + 20 - TRAVEL });
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('1px 흔들린 클릭은 슬롭 안이라 그대로 뒤집는다', () => {
    const onChange = vi.fn();
    render(true, onChange);

    send('pointerdown', { clientX: TRACK.x + 20 });
    send('pointermove', { clientX: TRACK.x + 21 });
    send('pointerup', { clientX: TRACK.x + 21 });
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
  });

  // 노브가 이미 끝이라 안 움직이는 방향으로 반 폭 이상 끈 건 "켜려고 끈" 의도다.
  // 중앙선 통과 여부만으로 탭 판정하면 여기서 click이 살아 켜려고 끌었는데 꺼진다
  it('켜진 스위치를 켜는 방향으로 반 폭 이상 끌면 켜진 채로 남는다', () => {
    const onChange = vi.fn();
    render(true, onChange);

    send('pointerdown', { clientX: TRACK.x + 14 });
    send('pointermove', { clientX: TRACK.x + 14 + TRAVEL / 2 + 2 });
    send('pointerup', { clientX: TRACK.x + 14 + TRAVEL / 2 + 2 });
    clickAfterRelease();

    expect(onChange).not.toHaveBeenCalled();
  });

  // 슬롭(3)과 중앙선(6) 사이는 클릭 중 손 떨림 범위와 겹친다. 여기서 값 그대로 + click 삼킴으로
  // 끝내면 눌렀는데 아무 반응이 없다 - 흔들린 클릭으로 보고 뒤따르는 click이 뒤집게 둔다
  it('슬롭은 넘겼지만 중앙선에 못 닿은 흔들린 클릭은 탭으로 강등돼 click이 뒤집는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL / 2 - 1 });
    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL / 2 - 1 });
    // 강등된 탭은 click을 삼키지 않는다
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);
  });

  it('노브가 못 움직이는 쪽으로 조금 흔들린 클릭도 탭이다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    // 꺼진 노브를 왼쪽으로 4px - 슬롭은 넘지만 노브는 clamp돼 제자리
    send('pointerdown', { clientX: TRACK.x + 8 });
    send('pointermove', { clientX: TRACK.x + 8 - 4 });
    send('pointerup', { clientX: TRACK.x + 8 - 4 });
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('중앙선을 넘었다 슬롭 안으로 되돌아와도 취소다 - 넘은 적이 있으므로 탭으로 강등하지 않는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointermove', { clientX: TRACK.x + 4 + 2 });
    send('pointerup', { clientX: TRACK.x + 4 + 2 });
    clickAfterRelease();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('슬롭 안쪽 이동은 탭이라 뒤따르는 click이 뒤집는다', () => {
    const onChange = vi.fn();
    render(true, onChange);

    send('pointerdown', { clientX: TRACK.x + 20 });
    send('pointermove', { clientX: TRACK.x + 22 });
    send('pointerup', { clientX: TRACK.x + 22 });
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('드래그 중에는 aria-checked를 미리 바꾸지 않는다', () => {
    render(false, vi.fn());

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });

    expect(track().getAttribute('aria-checked')).toBe('false');
  });

  it('중앙선을 넘겼다 되돌아오면 취소로 보고 커밋하지 않는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointermove', { clientX: TRACK.x + 4 });
    send('pointerup', { clientX: TRACK.x + 4 });
    clickAfterRelease();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('드래그 중에는 인라인 translate로 노브를 잡았다가 놓을 때 CSS에 돌려준다', () => {
    render(false, vi.fn());

    send('pointerdown', { clientX: TRACK.x + 4 });
    // 누르기만 해서는 전환 규칙을 건드리지 않는다
    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);

    send('pointermove', { clientX: TRACK.x + 10 });
    flushRaf();

    expect(track().hasAttribute('data-dmn-dragging')).toBe(true);
    expect(thumb().style.translate).toBe('6px 0');

    send('pointerup', { clientX: TRACK.x + 10 });
    // 표시값이 목표로 확정된 렌더가 끝난 다음 프레임에 CSS로 넘긴다
    flushRaf();

    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);
    expect(thumb().style.translate).toBe('');
  });

  it('끄는 동안 트랙 색이 넘어간 쪽을 미리 따라간다', () => {
    render(false, vi.fn());

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });

    expect(track().className).toContain('bg-accent');
  });

  it('취소·캡처 상실·blur가 겹쳐도 커밋 없이 한 번만 정리한다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    act(() => {
      track().dispatchEvent(
        pointer('pointercancel', { clientX: TRACK.x + 16 }),
      );
      track().dispatchEvent(pointer('lostpointercapture'));
      window.dispatchEvent(new Event('blur'));
    });
    flushRaf();

    expect(onChange).not.toHaveBeenCalled();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);
    expect(track().getAttribute('aria-checked')).toBe('false');
  });

  it('트랙 밖에서 떼 click이 조상에 꽂혀도 한 번만 뒤집는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 20 });
    // 트랙 오른쪽 끝(TRACK.x + 28) 바깥에서 릴리스
    send('pointermove', { clientX: TRACK.x + 34 });
    send('pointerup', { clientX: TRACK.x + 34 });
    clickOnAncestorAfterRelease();
    flushRaf();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('트랙 밖 릴리스로 무장한 억제가 다음 클릭까지 넘어가지 않는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 20 });
    send('pointermove', { clientX: TRACK.x + 34 });
    send('pointerup', { clientX: TRACK.x + 34 });
    clickOnAncestorAfterRelease();
    flushRaf();
    onChange.mockClear();

    // 다음 순수 클릭은 정상 동작해야 한다
    send('pointerdown', { clientX: TRACK.x + 14 });
    send('pointerup', { clientX: TRACK.x + 14 });
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('취소된 드래그가 다음 클릭을 삼키지 않는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointercancel', { clientX: TRACK.x + 4 + TRAVEL });
    flushRaf();

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointerup', { clientX: TRACK.x + 4 });
    clickAfterRelease();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('드래그가 click 없이 끝나도 키보드 입력이 억제를 푼다', () => {
    const onChange = vi.fn();
    render(false, onChange);
    const other = document.createElement('button');
    const otherClick = vi.fn();
    other.addEventListener('click', otherClick);
    document.body.appendChild(other);

    send('pointerdown', { clientX: TRACK.x + 20 });
    send('pointermove', { clientX: TRACK.x + 34 });
    send('pointerup', { clientX: TRACK.x + 34 });
    flushRaf();
    // 브라우저가 click을 안 보낸 채 사용자가 Tab→Enter로 다른 버튼을 누른다.
    // 합성 click에는 pointerdown이 없다 - keydown이 억제를 풀어야 버튼이 산다
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      other.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(otherClick).toHaveBeenCalledOnce();
    other.remove();
  });

  it('이동 폭을 모르면 드래그로 승격하지 않고 탭으로 둔다', () => {
    const onChange = vi.fn();
    act(() => root.render(<Checkbox checked={false} onChange={onChange} />));
    // 사각형이 전부 0(레이아웃 전·숨김) - 토큰도 jsdom엔 없다
    send('pointerdown', { clientX: 10 });
    send('pointermove', { clientX: 20 });
    send('pointerup', { clientX: 20 });
    clickAfterRelease();

    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('이동 폭 토큰이 있으면 실측 대신 토큰으로 중앙선을 잡는다', () => {
    const onChange = vi.fn();
    render(false, onChange);
    // 토큰 24 > 실측 12. 실측 기준(6px)으로는 넘지만 토큰 기준(12px)으로는 못 넘는 지점
    track().style.setProperty('--ui-toggle-travel', '24');

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + 8 });
    // 토큰 기준으로는 아직 중앙선 앞이라 트랙 색이 넘어가지 않는다
    expect(track().className).not.toContain('bg-accent');
    send('pointermove', { clientX: TRACK.x + 4 + 14 });
    expect(track().className).toContain('bg-accent');
    // 되돌아와 놓으면 취소 - 토큰 기준 반 폭(12)을 넘겼으니 탭으로 강등되지 않는다
    send('pointermove', { clientX: TRACK.x + 4 + 8 });
    send('pointerup', { clientX: TRACK.x + 4 + 8 });
    clickAfterRelease();
    flushRaf();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('이전 드래그의 정산 프레임 안에 새 드래그가 시작돼도 표식과 위치를 잃지 않는다', () => {
    render(false, vi.fn());

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
    clickAfterRelease();
    // 정산 rAF가 아직 안 돌았는데 바로 다음 드래그가 시작된다(빠른 연속 플릭).
    // 상위가 checked를 되먹이지 않는 마운트라 시작값은 여전히 꺼짐이다
    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + 5 });
    flushRaf();

    // 이전 세션의 늦은 handBack이 새 세션의 표식·인라인 위치를 걷어가면 안 된다
    expect(track().hasAttribute('data-dmn-dragging')).toBe(true);
    expect(thumb().style.translate).toBe('5px 0');
  });

  it('드래그 뒤 click이 조상 버튼에 꽂혀도 조상 핸들러까지 삼킨다', () => {
    const onChange = vi.fn();
    const ancestorClick = vi.fn();
    act(() =>
      root.render(
        <div onClick={ancestorClick}>
          <Checkbox checked={false} onChange={onChange} />
        </div>,
      ),
    );
    vi.spyOn(track(), 'getBoundingClientRect').mockReturnValue(
      rect(TRACK.width, TRACK.height, TRACK.x),
    );
    vi.spyOn(thumb(), 'getBoundingClientRect').mockReturnValue(
      rect(THUMB.width, THUMB.height),
    );

    send('pointerdown', { clientX: TRACK.x + 20 });
    send('pointermove', { clientX: TRACK.x + 34 });
    send('pointerup', { clientX: TRACK.x + 34 });
    // 트랙 밖에서 떼 click이 조상에 꽂힌다 - 설정 행처럼 조상이 토글 버튼이면 여기서 한 번 더 뒤집힌다
    act(() => {
      track().parentElement!.dispatchEvent(pointer('click'));
    });
    flushRaf();

    expect(onChange).toHaveBeenCalledOnce();
    expect(ancestorClick).not.toHaveBeenCalled();
  });

  it('드래그로 뒤집을 때 누름 표식을 먼저 찍어 정착 모션을 살린다', () => {
    // 값이 실제로 바뀌어야 정착 판정이 돈다 - 상위가 checked를 되먹이는 형태로 마운트
    const Stateful = () => {
      const [checked, setChecked] = React.useState(false);
      return (
        <Checkbox
          checked={checked}
          onChange={() => setChecked((current) => !current)}
        />
      );
    };
    act(() => root.render(<Stateful />));
    vi.spyOn(track(), 'getBoundingClientRect').mockReturnValue(
      rect(TRACK.width, TRACK.height, TRACK.x),
    );
    vi.spyOn(thumb(), 'getBoundingClientRect').mockReturnValue(
      rect(THUMB.width, THUMB.height),
    );
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1_000);
    send('pointerdown', { clientX: TRACK.x + 4 });
    // 300ms 시간창을 훌쩍 넘긴 뒤 놓는다 - 표식이 없으면 외부 변경으로 판정된다
    now.mockReturnValue(5_000);
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
    clickAfterRelease();

    expect(track().getAttribute('aria-checked')).toBe('true');
    // 값이 바뀐 렌더에서 즉시 전환 표식(data-dmn-instant)이 붙지 않아야 한다
    expect(track().hasAttribute('data-dmn-instant')).toBe(false);
    flushRaf();
  });

  it('드래그 중 언마운트에도 커밋을 만들지 않는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    act(() => root.render(null));

    expect(onChange).not.toHaveBeenCalled();
  });
});
