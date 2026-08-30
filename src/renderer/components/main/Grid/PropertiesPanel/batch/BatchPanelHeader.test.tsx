import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PANEL_HEADER_CLASS } from '../panelChrome';
import BatchPanelHeader from './BatchPanelHeader';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('BatchPanelHeader 이름 변경 계약', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (
    overrides: Partial<React.ComponentProps<typeof BatchPanelHeader>> = {},
  ) => {
    const props: React.ComponentProps<typeof BatchPanelHeader> = {
      totalCount: 4,
      selectedGroupInfo: {
        id: 'group-a',
        name: 'Named group',
        memberCount: 3,
      },
      isRenaming: false,
      renameInputRef: createRef<HTMLInputElement>(),
      renameValue: '',
      setRenameValue: vi.fn(),
      renameCancelledRef: { current: false },
      handleRenameCommit: vi.fn(),
      handleRenameCancel: vi.fn(),
      handleRenameStart: vi.fn(),
      t: (key) => key,
      ...overrides,
    };

    act(() => root.render(<BatchPanelHeader {...props} />));
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('그룹과 다중 선택 DOM·제목·count 계약을 유지한다', () => {
    render();

    const header = container.firstElementChild as HTMLDivElement;
    const groupTitle = container.querySelector<HTMLSpanElement>(
      'span[title="Named group"]',
    )!;
    expect(header.className).toBe(PANEL_HEADER_CLASS);
    expect(groupTitle.textContent).toBe('Named group');
    expect(groupTitle.className).toBe(
      'text-fg text-label leading-none cursor-default truncate max-w-[110px]',
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[title="contextMenu.rename"]',
      )?.className,
    ).toBe(
      'w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0',
    );
    expect(container.textContent).not.toContain('(4)');

    render({ selectedGroupInfo: null });

    const labels = container.querySelectorAll('span');
    expect(labels).toHaveLength(2);
    expect(labels[0]?.textContent).toBe('propertiesPanel.multiSelection');
    expect(labels[0]?.className).toBe('text-fg text-label leading-none');
    expect(labels[1]?.textContent).toBe('(4)');
    expect(labels[1]?.className).toBe('text-fg-faint text-body');
    expect(container.querySelector('button')).toBeNull();
  });

  it('번역은 현재 표시 분기에 필요한 key만 평가한다', () => {
    const t = vi.fn((key: string) => key);
    render({ t });
    expect(t.mock.calls).toEqual([['contextMenu.rename']]);

    t.mockClear();
    render({ isRenaming: true, t });
    expect(t).not.toHaveBeenCalled();

    render({ selectedGroupInfo: null, t });
    expect(t.mock.calls).toEqual([['propertiesPanel.multiSelection']]);
  });

  it('제목 더블클릭과 버튼 클릭 이벤트를 시작 handler에 그대로 전달한다', () => {
    const handleRenameStart = vi.fn();
    render({ handleRenameStart });

    const title = container.querySelector<HTMLSpanElement>(
      'span[title="Named group"]',
    )!;
    const button = container.querySelector<HTMLButtonElement>(
      'button[title="contextMenu.rename"]',
    )!;

    act(() =>
      title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    act(() => button.click());

    expect(handleRenameStart).toHaveBeenCalledTimes(2);
    expect(handleRenameStart.mock.calls[0]?.[0]).toMatchObject({
      type: 'dblclick',
    });
    expect(handleRenameStart.mock.calls[1]?.[0]).toMatchObject({
      type: 'click',
    });
  });

  it('Enter는 blur 뒤 현재 값을 커밋하고 cancel ref를 초기화한다', () => {
    const order: string[] = [];
    const renameCancelledRef = { current: false };
    const renameInputRef = createRef<HTMLInputElement>();
    const handleRenameCommit = vi.fn((value: string) => {
      order.push(`commit:${value}`);
    });
    render({
      isRenaming: true,
      renameInputRef,
      renameValue: 'Draft group',
      renameCancelledRef,
      handleRenameCommit,
    });
    const input = container.querySelector('input')!;
    expect(renameInputRef.current).toBe(input);
    input.focus();
    const nativeBlur = input.blur.bind(input);
    vi.spyOn(input, 'blur').mockImplementation(() => {
      order.push('blur');
      nativeBlur();
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(order).toEqual(['blur', 'commit:Draft group']);
    expect(handleRenameCommit).toHaveBeenCalledWith('Draft group');
    expect(renameCancelledRef.current).toBe(false);
  });

  it('Escape는 취소하고 후속 blur는 커밋 없이 cancel ref만 초기화한다', () => {
    const renameCancelledRef = { current: true };
    const handleRenameCommit = vi.fn();
    const handleRenameCancel = vi.fn();
    render({
      isRenaming: true,
      renameValue: 'Cancelled group',
      renameCancelledRef,
      handleRenameCommit,
      handleRenameCancel,
    });
    const input = container.querySelector('input')!;
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(handleRenameCancel).toHaveBeenCalledTimes(1);
    expect(handleRenameCancel).toHaveBeenCalledWith();
    expect(handleRenameCommit).not.toHaveBeenCalled();
    act(() => input.blur());
    expect(handleRenameCommit).not.toHaveBeenCalled();
    expect(renameCancelledRef.current).toBe(false);
  });
});
