import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommonListPickerPage from './CommonListPickerPage';

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({
    scrollContainerRef: { current: null },
    lenisInstance: { current: null },
  }),
}));

describe('CommonListPickerPage keyboard contract', () => {
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

  it('returns to the parent page when Escape is pressed in search', async () => {
    const onBack = vi.fn();
    await act(async () => {
      root.render(
        <CommonListPickerPage
          open
          searchQuery=""
          onSearchQueryChange={() => undefined}
          searchPlaceholder="Search fonts"
          items={[]}
          renderItem={() => null}
          emptyText="Empty"
          onAdd={() => undefined}
          addLabel="Add"
          pageTitle="Fonts"
          onBack={onBack}
        />,
      );
    });

    const search = host.querySelector<HTMLInputElement>('input');
    expect(search?.getAttribute('aria-label')).toBe('Search fonts');
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => search?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
