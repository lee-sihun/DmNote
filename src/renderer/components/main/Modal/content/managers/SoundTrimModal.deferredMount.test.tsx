import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  settleDeferredContent,
  stubAnimationFrame,
} from '@src/renderer/__tests__/deferredContentHarness';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@api/modules/resourceApi', () => ({
  soundApi: {},
}));

import SoundTrimModal from './SoundTrimModal';

describe('SoundTrimModal 지연 마운트 실측', () => {
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

  it('본문이 첫 paint 뒤에 붙어도 파형 영역을 관측한다', async () => {
    await act(async () => {
      root.render(
        <SoundTrimModal
          isOpen
          onClose={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });
    expect(observed).toHaveLength(0);

    await settleDeferredContent();

    const waveform = document.querySelector('[data-sound-waveform="true"]');
    expect(waveform).not.toBeNull();
    expect(observed).toContain(waveform);
  });
});
