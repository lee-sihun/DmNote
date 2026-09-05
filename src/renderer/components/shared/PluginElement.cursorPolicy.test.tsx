/**
 * 플러그인 요소 커서 정책 스코프 테스트
 * 메인 창 래퍼만 dmn-grabbable을 가져 main.css 커서 규칙의 적용 범위가 되는지 검증
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { I18nContext } from '@contexts/I18nContextDef';
import { PluginElement } from '@components/shared/PluginElement';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PLUGIN_FULL_ID = 'plugin-a::11111111-1111-4111-8111-111111111111';

const makePluginElement = (options?: {
  scoped?: boolean;
}): PluginDisplayElementInternal =>
  ({
    id: PLUGIN_FULL_ID.split('::')[1],
    fullId: PLUGIN_FULL_ID,
    pluginId: 'plugin-a',
    position: { x: 10, y: 10 },
    measuredSize: { width: 180, height: 120 },
    tabId: '4key',
    scoped: options?.scoped,
  } as unknown as PluginDisplayElementInternal);

const seedStores = (options?: { scoped?: boolean }) => {
  useKeyStore.setState({
    selectedKeyType: '4key',
    positions: { '4key': [] },
    canonicalPositions: { '4key': [] },
  });
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({ layerGroups: {} });
  usePluginDisplayElementStore.setState({
    elements: [makePluginElement(options)],
  });
  useGridSelectionStore.setState({
    selectedElements: [],
    selectedGroupIds: [],
    lastSelectedKeyBounds: null,
  });
};

let container: HTMLDivElement;
let root: Root;

const renderElement = (windowType: 'main' | 'overlay') => {
  const element = usePluginDisplayElementStore.getState().elements[0];
  act(() => {
    root.render(
      <I18nContext.Provider
        value={{ locale: 'ko', setLocale: async () => {}, t: (key) => key }}
      >
        <PluginElement element={element} windowType={windowType} />
      </I18nContext.Provider>,
    );
  });
  return container.querySelector(
    `[data-plugin-element="${PLUGIN_FULL_ID}"]`,
  ) as HTMLElement;
};

beforeEach(() => {
  seedStores();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('플러그인 요소 커서 정책 스코프', () => {
  it('메인 창 래퍼는 dmn-grabbable로 커서 정책 스코프에 들어간다', () => {
    const node = renderElement('main');

    expect(node.classList.contains('dmn-grabbable')).toBe(true);
    expect(node.dataset.overlayHit).toBeUndefined();
    expect(container.querySelector('[data-plugin-hit-box]')).toBeNull();
    // 커서 소유는 클래스 규칙 - 래퍼 인라인 커서 없음
    expect(node.style.cursor).toBe('');
  });

  it('오버레이 창 래퍼는 커서 정책 스코프 밖이다', () => {
    const node = renderElement('overlay');

    expect(node.classList.contains('dmn-grabbable')).toBe(false);
    expect(node.style.cursor).toBe('default');
    expect(node.dataset.overlayHit).toBeUndefined();
    const hitBox = container.querySelector<HTMLElement>(
      `[data-plugin-hit-box="${PLUGIN_FULL_ID}"]`,
    );
    expect(hitBox).not.toBeNull();
    expect(hitBox!.dataset.overlayHit).toBe('true');
    expect(hitBox!.style.width).toBe('180px');
    expect(hitBox!.style.height).toBe('120px');
    expect(hitBox!.style.transform).toBe(node.style.transform);
  });

  it('scoped 플러그인은 메인 창 shadow root에 커서 상속 스타일이 주입된다', () => {
    seedStores({ scoped: true });
    const node = renderElement('main');

    const injected = node.shadowRoot?.querySelector(
      'style[data-dmn-cursor-policy]',
    );
    expect(injected?.textContent).toContain('cursor: inherit !important');
  });

  it('오버레이 창 scoped shadow root에는 커서 스타일을 주입하지 않는다', () => {
    seedStores({ scoped: true });
    const node = renderElement('overlay');

    expect(node.shadowRoot).toBeTruthy();
    expect(
      node.shadowRoot?.querySelector('style[data-dmn-cursor-policy]'),
    ).toBeNull();
  });
});
