import { act } from 'react';
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

  const renderActions = (edgeAligned: boolean, modeToggleHidden = false) => {
    act(() =>
      root.render(
        <PanelHeaderActions
          mode="property"
          modeToggleHidden={modeToggleHidden}
          onToggleMode={vi.fn()}
          detachAction="reattach"
          onDetachAction={vi.fn()}
          edgeAligned={edgeAligned}
        />,
      ),
    );
    return container.querySelector('button')?.parentElement ?? null;
  };

  it('분리/결합 버튼을 사용자 화면에 렌더링하지 않는다', () => {
    renderActions(true, true);

    expect(container.querySelector('button')).toBeNull();
  });

  it('stops the remaining action-area mouse down before the window drag handler', () => {
    const actionArea = renderActions(true);
    const outerMouseDown = vi.fn();
    window.addEventListener('mousedown', outerMouseDown);

    act(() =>
      actionArea?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      ),
    );

    expect(actionArea?.classList.contains('pointer-events-auto')).toBe(true);
    expect(outerMouseDown).not.toHaveBeenCalled();
    window.removeEventListener('mousedown', outerMouseDown);
  });

  it('keeps the inline overlay transparent to its header', () => {
    const actionArea = renderActions(false);

    expect(actionArea?.classList.contains('pointer-events-none')).toBe(true);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'propertiesPanel.switchToLayer',
    );
  });
});
