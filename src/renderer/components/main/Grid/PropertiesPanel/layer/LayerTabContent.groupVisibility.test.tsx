// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@components/main/common/IconSwap', () => ({
  default: ({ active }: { active: boolean }) => (
    <span data-active={String(active)} />
  ),
}));

import { LayerGroupVisibilityButton } from './LayerTabContent';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('LayerTab group visibility consumer', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it.each([false, true])(
    'collapsed children 렌더 여부와 무관하게 allHidden=%s 그룹 ID를 전달한다',
    (allHidden) => {
      const onToggle = vi.fn();
      act(() => {
        root.render(
          <LayerGroupVisibilityButton
            groupId="group-a"
            allHidden={allHidden}
            onToggle={onToggle}
          />,
        );
      });

      act(() =>
        host
          .querySelector<HTMLButtonElement>(
            '[aria-label="toggle group visibility"]',
          )
          ?.click(),
      );

      expect(onToggle).toHaveBeenCalledWith(expect.anything(), 'group-a');
      expect(
        host.querySelector('[data-active]')?.getAttribute('data-active'),
      ).toBe(String(allHidden));
    },
  );
});
