import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoUpdatePhase } from '@stores/useUpdateStore';
import UpdateProgressLabel from './UpdateProgressLabel';

const lines = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.dmn-gauge-line'));

describe('UpdateProgressLabel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const render = (phase: AutoUpdatePhase, text: string) => {
    act(() => {
      root.render(<UpdateProgressLabel phase={phase} text={text} />);
    });
  };

  it('같은 단계에서 퍼센트만 바뀌면 줄을 갈지 않는다', () => {
    render('downloading', '다운로드 중... 0%');
    render('downloading', '다운로드 중... 42%');

    // 매 진행 이벤트마다 줄이 교차하면 숫자를 눈으로 좇을 수 없다
    expect(lines(host)).toHaveLength(1);
    expect(host.textContent).toBe('다운로드 중... 42%');
  });

  it('단계가 바뀌면 두 줄이 같은 자리에서 교차한다', () => {
    render('downloading', '다운로드 중... 100%');
    render('verifying', '검증 중...');

    const rendered = lines(host);
    expect(rendered).toHaveLength(2);
    expect(rendered[0].getAttribute('data-leaving')).toBe('true');
    expect(rendered[0].getAttribute('aria-hidden')).toBe('true');
    expect(rendered[0].textContent).toBe('다운로드 중... 100%');
    expect(rendered[1].getAttribute('data-enter')).toBe('true');
    expect(rendered[1].textContent).toBe('검증 중...');
  });

  it('교차가 끝나면 나가는 줄을 걷어낸다', () => {
    render('downloading', '다운로드 중... 100%');
    render('verifying', '검증 중...');

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(lines(host)).toHaveLength(1);
    expect(host.textContent).toBe('검증 중...');
  });

  it('첫 줄은 교차 없이 그대로 앉는다', () => {
    render('idle', '자동 업데이트');

    // 모달 등장 모션에 얹혀 들어오므로 여기서 또 움직이면 두 번 흔들린다
    expect(lines(host)[0].hasAttribute('data-enter')).toBe(false);
  });
});
