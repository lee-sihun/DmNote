// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../index', () => ({
  PropertyRow: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  NumberInput: () => null,
}));

import BatchGeometrySection from './BatchGeometrySection';

describe('BatchGeometrySection 분배 게이트', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  const renderSection = (
    totalCount: number,
    handleBatchDistribute = vi.fn(),
  ) => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <BatchGeometrySection
          totalCount={totalCount}
          handleBatchAlign={vi.fn()}
          handleBatchDistribute={handleBatchDistribute}
          handleBatchSpacing={vi.fn()}
          batchSpacing={{ isMixed: false, value: 0 }}
          t={(key) => key}
        />,
      );
    });
    return handleBatchDistribute;
  };

  const distributeButtons = () =>
    [
      host?.querySelector('[title="propertiesPanel.distributeH"]'),
      host?.querySelector('[title="propertiesPanel.distributeV"]'),
    ] as Array<HTMLButtonElement | null>;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  it('합산 3 미만이면 분배 버튼이 비활성이다', () => {
    const handler = renderSection(2);

    for (const button of distributeButtons()) {
      expect(button?.disabled).toBe(true);
      act(() =>
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
      );
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('native+plugin 합산 3이면 분배 버튼이 활성이고 핸들러를 호출한다', () => {
    // native 2 + plugin 1 혼합 선택의 합산 케이스
    const handler = renderSection(3);
    const [horizontal, vertical] = distributeButtons();

    expect(horizontal?.disabled).toBe(false);
    expect(vertical?.disabled).toBe(false);
    act(() =>
      horizontal?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    act(() =>
      vertical?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(handler).toHaveBeenNthCalledWith(1, 'horizontal');
    expect(handler).toHaveBeenNthCalledWith(2, 'vertical');
  });
});
