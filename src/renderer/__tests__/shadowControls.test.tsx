// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShadowControls from '@components/main/Grid/PropertiesPanel/ShadowControls';
import type { ElementShadowSpec } from '@src/types/key/shadows';

vi.mock('@components/main/Modal/FloatingPopup', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="floating-popup">{children}</div> : null,
}));

vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: ({
    color,
    onColorChangeComplete,
  }: {
    color: string;
    onColorChangeComplete: (color: string) => void;
  }) => (
    <button
      data-testid="color-commit"
      data-color={color}
      onClick={() => onColorChangeComplete('#123456')}
    />
  ),
}));

const idleShadow: ElementShadowSpec = {
  enabled: true,
  color: 'rgba(0, 0, 0, 0.28)',
  offsetX: 0,
  offsetY: 4,
  blur: 10,
};

const activeShadow: ElementShadowSpec = {
  enabled: false,
  color: 'rgba(0, 0, 0, 0.32)',
  offsetX: 0,
  offsetY: 3,
  blur: 8,
};

const t = (key: string) => key.split('.').at(-1);

const findButton = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  );

describe('ShadowControls', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('마스터 토글이 대기·입력 사용을 한 번에 바꾼다', () => {
    const onChange = vi.fn();
    const onEnabledChange = vi.fn();
    act(() => {
      root.render(
        <ShadowControls
          idleShadow={idleShadow}
          activeShadow={activeShadow}
          onChange={onChange}
          onEnabledChange={onEnabledChange}
          t={t}
        />,
      );
    });

    // 한쪽이라도 켜져 있으면 토글은 on
    const toggle = host.querySelector<HTMLElement>('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');

    act(() => toggle?.click());
    expect(onEnabledChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('꺼져 있으면 설정하기 행이 숨는다', () => {
    act(() => {
      root.render(
        <ShadowControls
          idleShadow={{ ...idleShadow, enabled: false }}
          activeShadow={activeShadow}
          onChange={vi.fn()}
          onEnabledChange={vi.fn()}
          t={t}
        />,
      );
    });

    expect(
      host.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
    ).toBe('false');
    expect(findButton('configure')).toBeUndefined();
  });

  it('배치 anyEnabled가 대표값 대신 토글 표시를 결정한다', () => {
    const onEnabledChange = vi.fn();
    act(() => {
      root.render(
        <ShadowControls
          // 대표값(첫 요소)은 양쪽 다 꺼짐이지만 선택 중 켜진 요소가 존재
          idleShadow={{ ...idleShadow, enabled: false }}
          activeShadow={activeShadow}
          anyEnabled
          onChange={vi.fn()}
          onEnabledChange={onEnabledChange}
          t={t}
        />,
      );
    });

    const toggle = host.querySelector<HTMLElement>('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(findButton('configure')).toBeDefined();

    // 켜짐 표시 상태에서 클릭 → 전체 끄기
    act(() => toggle?.click());
    expect(onEnabledChange).toHaveBeenLastCalledWith(false);
  });

  it('showActiveState=false면 입력 탭이 없고 토글은 대기만 본다', () => {
    const onEnabledChange = vi.fn();
    act(() => {
      root.render(
        <ShadowControls
          idleShadow={{ ...idleShadow, enabled: false }}
          // 입력 스펙이 켜져 있어도 통계에선 무시되어야 함
          activeShadow={{ ...activeShadow, enabled: true }}
          showActiveState={false}
          onChange={vi.fn()}
          onEnabledChange={onEnabledChange}
          t={t}
        />,
      );
    });

    // 대기 기준으로만 판정 — 대기 꺼짐이면 토글 off
    expect(
      host.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
    ).toBe('false');

    act(() => host.querySelector<HTMLElement>('[role="switch"]')?.click());
    expect(onEnabledChange).toHaveBeenLastCalledWith(true);

    act(() => findButton('configure')?.click());
    expect(findButton('shadowActive')).toBeUndefined();
    expect(findButton('shadowIdle')).toBeUndefined();
  });

  it('입력 탭 선택 중 통계로 전환되면 대기로 강등되어 기록된다', () => {
    const onChange = vi.fn();
    const renderControls = (showActiveState: boolean) =>
      root.render(
        <ShadowControls
          idleShadow={idleShadow}
          activeShadow={activeShadow}
          showActiveState={showActiveState}
          onChange={onChange}
          onEnabledChange={vi.fn()}
          t={t}
        />,
      );

    act(() => renderControls(true));
    act(() => findButton('configure')?.click());
    act(() => findButton('shadowActive')?.click());

    const popup = document.querySelector('[data-testid="floating-popup"]');
    const swatch = Array.from(popup!.querySelectorAll('button')).find(
      (button) =>
        button.textContent !== 'shadowIdle' &&
        button.textContent !== 'shadowActive',
    );
    act(() => swatch?.click());
    expect(
      document
        .querySelector('[data-testid="color-commit"]')
        ?.getAttribute('data-color'),
    ).toBe(activeShadow.color);

    // 팝업 유지한 채 통계 선택으로 전환 (showActiveState=false)
    act(() => renderControls(false));
    expect(document.querySelector('[data-testid="color-commit"]')).toBeNull();

    const idlePopup = document.querySelector('[data-testid="floating-popup"]');
    const idleSwatch = Array.from(idlePopup!.querySelectorAll('button')).find(
      (button) =>
        button.textContent !== 'shadowIdle' &&
        button.textContent !== 'shadowActive',
    );
    act(() => idleSwatch?.click());
    expect(
      document
        .querySelector('[data-testid="color-commit"]')
        ?.getAttribute('data-color'),
    ).toBe(idleShadow.color);
    act(() =>
      document
        .querySelector<HTMLElement>('[data-testid="color-commit"]')
        ?.click(),
    );

    // 숨긴 입력 상태가 아니라 대기로 기록되어야 함
    expect(onChange).toHaveBeenLastCalledWith(
      'idle',
      { ...idleShadow, color: '#123456' },
      { color: '#123456' },
    );
  });

  it('설정하기 팝업에서 상태별로 편집한다', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ShadowControls
          idleShadow={idleShadow}
          activeShadow={activeShadow}
          onChange={onChange}
          onEnabledChange={vi.fn()}
          t={t}
        />,
      );
    });

    act(() => findButton('configure')?.click());

    const popup = document.querySelector('[data-testid="floating-popup"]');
    expect(popup).not.toBeNull();

    // 입력 상태로 전환 후 색상 커밋 → activeShadow 필드로 전달
    act(() => findButton('shadowActive')?.click());

    const swatch = Array.from(popup!.querySelectorAll('button')).find(
      (button) =>
        button.textContent !== 'shadowIdle' &&
        button.textContent !== 'shadowActive',
    );
    act(() => swatch?.click());
    act(() =>
      document
        .querySelector<HTMLElement>('[data-testid="color-commit"]')
        ?.click(),
    );

    expect(onChange).toHaveBeenLastCalledWith(
      'active',
      { ...activeShadow, color: '#123456' },
      { color: '#123456' },
    );
  });
});
