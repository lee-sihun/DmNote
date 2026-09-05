/**
 * 문자열 템플릿(레거시) 플러그인 요소의 내부 DOM 안정성 테스트
 *
 * React 19는 dangerouslySetInnerHTML의 {__html} 객체 identity가 바뀌면
 * 내용이 같아도 innerHTML을 다시 설정해 내부 노드를 전부 교체한다.
 * 프레스 중 재렌더(isDragging 등)가 mousedown 대상 노드를 detach시키면
 * 브라우저가 click 디스패치를 포기해 클릭 선택이 유실된다 - 실기 전용 증상
 * (합성 이벤트를 동기로 몰아 보내면 재렌더가 클릭 뒤로 밀려 재현되지 않음)
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { I18nContext } from '@contexts/I18nContextDef';
import { PluginElement } from '@components/shared/plugin/PluginElement';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type {
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DEF_ID = 'string-template-plugin';
const PLUGIN_FULL_ID = `${DEF_ID}::22222222-2222-4222-8222-222222222222`;
const TEMPLATE_HTML = '<div class="probe-box">PROBE</div>';

const makeElement = (
  overrides: Partial<PluginDisplayElementInternal> = {},
): PluginDisplayElementInternal =>
  ({
    id: PLUGIN_FULL_ID.split('::')[1],
    fullId: PLUGIN_FULL_ID,
    pluginId: DEF_ID,
    definitionId: DEF_ID,
    draggable: true,
    position: { x: 10, y: 10 },
    tabId: '4key',
    html: '<!-- plugin-element -->',
    ...overrides,
  } as unknown as PluginDisplayElementInternal);

const seedStores = (element: PluginDisplayElementInternal) => {
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
    elements: [element],
    definitions: new Map([
      [
        DEF_ID,
        {
          id: DEF_ID,
          pluginId: DEF_ID,
          name: 'String Template Plugin',
          // 순수 문자열 반환 템플릿 - html`` 헬퍼 미사용 레거시 경로
          template: () => TEMPLATE_HTML,
        } as unknown as PluginDefinitionInternal,
      ],
    ]),
  });
  useGridSelectionStore.setState({
    selectedElements: [],
    selectedGroupIds: [],
    lastSelectedKeyBounds: null,
  });
};

let container: HTMLDivElement;
let root: Root;

const renderElement = (element: PluginDisplayElementInternal, zoom: number) => {
  act(() => {
    root.render(
      <I18nContext.Provider
        value={{ locale: 'ko', setLocale: () => {}, t: (key) => key }}
      >
        <PluginElement element={element} windowType="main" zoom={zoom} />
      </I18nContext.Provider>,
    );
  });
  return container.querySelector(
    `[data-plugin-element="${PLUGIN_FULL_ID}"]`,
  ) as HTMLElement;
};

const fireMouse = (
  node: HTMLElement,
  type: string,
  init: MouseEventInit = {},
) => {
  act(() => {
    node.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
    );
  });
};

beforeEach(() => {
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

describe('문자열 템플릿 내부 DOM 안정성', () => {
  it('내용이 같은 재렌더에서 내부 노드를 교체하지 않는다', () => {
    const element = makeElement();
    seedStores(element);
    const node = renderElement(element, 1);
    const innerBefore = node.querySelector('.probe-box');
    expect(innerBefore).not.toBeNull();

    // 프레스 상태 변화와 동일한 재렌더 유발 (내용 무관 prop 변경)
    renderElement(element, 1.25);

    const innerAfter = node.querySelector('.probe-box');
    expect(innerAfter).toBe(innerBefore);
    expect(innerBefore!.isConnected).toBe(true);
  });

  it('press 도중 재렌더가 끼어도 클릭 선택이 유지된다', () => {
    const element = makeElement();
    seedStores(element);
    const node = renderElement(element, 1);
    const inner = node.querySelector('.probe-box') as HTMLElement;

    // 실클릭 타임라인 재현: mousedown -> (재렌더) -> click
    fireMouse(inner, 'mousedown');
    renderElement(element, 1.25);
    expect(inner.isConnected).toBe(true);

    fireMouse(inner, 'click');
    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'plugin', id: PLUGIN_FULL_ID },
    ]);
  });

  it('템플릿 없는 html 문자열 경로도 재렌더에서 노드를 유지한다', () => {
    const element = makeElement({
      definitionId: undefined,
      html: '<span class="probe-html">HTML</span>',
    });
    seedStores(element);
    usePluginDisplayElementStore.setState({ definitions: new Map() });
    const node = renderElement(element, 1);
    const innerBefore = node.querySelector('.probe-html');
    expect(innerBefore).not.toBeNull();

    renderElement(element, 1.25);

    expect(node.querySelector('.probe-html')).toBe(innerBefore);
    expect(innerBefore!.isConnected).toBe(true);
  });
});
