import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  settleDeferredContent,
  stubAnimationFrame,
} from '@src/renderer/__tests__/deferredContentHarness';
import CounterAnimationEditorModal from './CounterAnimationEditorModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@components/main/common/Dropdown', () => ({
  default: () => null,
}));
vi.mock('@components/main/Grid/PropertiesPanel/PropertyInputs', () => ({
  TextInput: () => null,
  NumberInput: () => null,
}));
vi.mock('@components/overlay/counters/CountDisplay', () => ({
  default: () => null,
}));

describe('CounterAnimationEditorModal 지연 마운트 실측', () => {
  let host: HTMLDivElement;
  let root: Root;
  let observed: Element[];

  beforeEach(() => {
    observed = [];
    stubAnimationFrame();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element) {
          observed.push(target);
        }

        disconnect() {}
      },
    );
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        css: {
          get: vi.fn().mockResolvedValue({ content: '' }),
          getUse: vi.fn().mockResolvedValue(false),
          tab: { getAll: vi.fn().mockResolvedValue({}) },
        },
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('본문이 첫 paint 뒤에 붙어도 캔버스 영역을 관측한다', async () => {
    await act(async () => {
      root.render(
        <CounterAnimationEditorModal
          isOpen
          mode="create"
          onClose={() => undefined}
          onSaved={() => undefined}
          t={(key) => key}
        />,
      );
    });
    expect(observed).toHaveLength(0);

    await settleDeferredContent();

    const svg = document.querySelector('[data-counter-bezier-editor="true"]');
    expect(svg).not.toBeNull();
    expect(observed).toContain(svg!.parentElement);
  });
});
