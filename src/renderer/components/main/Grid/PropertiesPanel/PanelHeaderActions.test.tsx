import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@components/main/common/IconSwap', () => ({
  default: () => null,
}));
vi.mock('./PropertyInputs', () => ({
  ModeToggleIcon: () => null,
}));

import PanelHeaderActions from './PanelHeaderActions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PanelHeaderActions detached drag boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderActions = (edgeAligned: boolean) => {
    act(() =>
      root.render(
        <PanelHeaderActions
          mode="property"
          modeToggleHidden
          onToggleMode={vi.fn()}
          detachAction="reattach"
          onDetachAction={vi.fn()}
          edgeAligned={edgeAligned}
        />,
      ),
    );
    return container.querySelector('button')?.parentElement as HTMLDivElement;
  };

  it('stops detached action-area mouse down before the window drag handler', () => {
    const actionArea = renderActions(true);
    const outerMouseDown = vi.fn();
    window.addEventListener('mousedown', outerMouseDown);

    act(() =>
      actionArea.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      ),
    );

    expect(actionArea.classList.contains('pointer-events-auto')).toBe(true);
    expect(outerMouseDown).not.toHaveBeenCalled();
    window.removeEventListener('mousedown', outerMouseDown);
  });

  it('keeps the inline overlay transparent to its header', () => {
    const actionArea = renderActions(false);

    expect(actionArea.classList.contains('pointer-events-none')).toBe(true);
  });

  it('commits a focused input inside the reattach action instead of losing the first click', () => {
    const action = vi.fn();
    const blurCommit = vi.fn();

    const Harness = () => {
      const [generation, setGeneration] = React.useState(0);
      const inputRef = React.useRef<HTMLInputElement>(null);

      return (
        <>
          <input
            ref={inputRef}
            onBlur={() => {
              blurCommit();
              setGeneration((value) => value + 1);
            }}
          />
          <PanelHeaderActions
            key={generation}
            mode="property"
            modeToggleHidden
            onToggleMode={vi.fn()}
            detachAction="reattach"
            onDetachAction={() => {
              inputRef.current?.blur();
              action();
            }}
            edgeAligned
          />
        </>
      );
    };

    act(() => root.render(<Harness />));
    const input = container.querySelector('input')!;
    const button = container.querySelector('button')!;
    act(() => input.focus());

    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    act(() => {
      button.dispatchEvent(mouseDown);
      if (!mouseDown.defaultPrevented) input.blur();
    });

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(blurCommit).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(blurCommit).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
