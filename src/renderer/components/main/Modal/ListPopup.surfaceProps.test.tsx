import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ListPopup from './ListPopup';

const surface = () =>
  document.querySelector<HTMLElement>('[aria-label="메뉴"]');

describe('ListPopup 표면 옵션', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
  });

  const render = async (props: Record<string, unknown>) => {
    const Harness = () => {
      const referenceRef = useRef<HTMLElement>(null!);
      return (
        <ListPopup
          open
          ariaLabel="메뉴"
          referenceRef={referenceRef}
          onClose={() => {}}
          contentMountStrategy="sync"
          items={[{ id: 'a', label: '항목' }]}
          {...props}
        />
      );
    };
    await act(async () => root.render(<Harness />));
  };

  it('minWidth로 트리거 폭에 맞출 수 있다', async () => {
    await render({ minWidth: 172 });

    expect(surface()?.style.minWidth).toBe('172px');
  });

  it('기본 z는 z-40', async () => {
    await render({});

    expect(surface()?.className).toContain('z-40');
  });

  // 호출부가 z를 주면 기본값을 빼야 한다. 둘 다 붙으면 특이도가 같아
  // CSS 생성 순서가 승부를 내고, 그러면 결과를 예측할 수 없다
  it('호출부가 z를 주면 기본 z를 붙이지 않는다', async () => {
    await render({ className: 'z-[60]' });

    const className = surface()?.className ?? '';
    expect(className).toContain('z-[60]');
    expect(className).not.toContain('z-40');
  });

  it('z가 아닌 className은 기본 z와 함께 붙는다', async () => {
    await render({ className: 'w-[172px]' });

    const className = surface()?.className ?? '';
    expect(className).toContain('w-[172px]');
    expect(className).toContain('z-40');
  });

  it('긴 항목 이름은 전체 문구를 유지한 채 180px 표면 안에서 말줄임한다', async () => {
    const label =
      '아주 길어서 메뉴 폭을 계속 늘리면 안 되는 플러그인 메뉴 항목';
    await render({ items: [{ id: 'long', label, isPlugin: true }] });

    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]');
    const text = item?.querySelector('span');

    expect(item?.hasAttribute('title')).toBe(false);
    expect(item?.textContent).toBe(label);
    expect(item?.className).toContain('max-w-[172px]');
    expect(item?.className).toContain('overflow-hidden');
    expect(text?.className).toContain('min-w-0');
    expect(text?.className).toContain('truncate');
    expect(text?.className).toContain('text-body');
  });

  it('기본 항목은 기존 내용 기반 폭을 유지한다', async () => {
    await render({
      items: [{ id: 'long', label: '기존 드롭다운의 긴 기본 항목' }],
    });

    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]');
    const text = item?.querySelector('span');

    expect(item?.className).not.toContain('max-w-[172px]');
    expect(text?.className).not.toContain('truncate');
    expect(text?.className).toContain('whitespace-nowrap');
    expect(text?.className).toContain('text-body');
  });
});
