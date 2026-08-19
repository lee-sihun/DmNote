// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@components/main/common/IconSwap', () => ({
  default: ({ active }: { active: boolean }) => (
    <span data-active={String(active)} />
  ),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: () => {} },
  }),
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({
    scrollContainerRef: () => {},
    lenisInstance: { current: null },
  }),
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import LayerTabContent, { LayerGroupVisibilityButton } from './LayerTabContent';

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

describe('LayerTab 행 커서 정책', () => {
  const ID_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ID_GROUPED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const GROUP_ID = 'group-1';

  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A', 'S'] },
      positions: {
        '4key': [
          { id: ID_KEY, dx: 0, dy: 0, width: 60, height: 60, zIndex: 1 },
          {
            id: ID_GROUPED,
            dx: 0,
            dy: 0,
            width: 60,
            height: 60,
            zIndex: 0,
            groupId: GROUP_ID,
          },
        ],
      } as never,
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group A' }] },
      collapsedGroups: new Set(),
    });
    usePluginDisplayElementStore.setState({ elements: [] });
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<LayerTabContent />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('아이템 행과 그룹 헤더는 상시 grab 대신 행 커서 정책 클래스를 쓴다', () => {
    const rows = host.querySelectorAll('.dmn-row-grabbable');

    // 그룹 헤더 1 + 아이템 행 2
    expect(rows.length).toBe(3);
    expect(host.querySelector('.cursor-grab')).toBeNull();
    // 그룹 헤더도 같은 정책 적용
    expect(
      host.querySelector('[aria-expanded]')?.closest('.dmn-row-grabbable'),
    ).not.toBeNull();
  });

  it('행 내부 버튼류는 자체 pointer 커서를 유지한다', () => {
    const eyeButton = host.querySelector(
      'button[title="propertiesPanel.hideLayer"]',
    );
    const groupEyeButton = host.querySelector(
      '[aria-label="toggle group visibility"]',
    );

    expect(eyeButton?.className).toContain('cursor-pointer');
    expect(groupEyeButton?.className).toContain('cursor-pointer');
  });

  it('접기 화살표 press는 행 드래그 grabbing 커서를 켜지 않는다', async () => {
    const disclosure = host.querySelector<HTMLButtonElement>(
      'button[aria-expanded]',
    )!;

    await act(async () => {
      disclosure.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });

    // 버튼 press가 행으로 전파되면 body에 dmn-dragging이 붙는다
    expect(document.body.classList.contains('dmn-dragging')).toBe(false);

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(document.body.classList.contains('dmn-dragging')).toBe(false);
  });
});
