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

vi.mock('./layerReorderIntent', () => ({
  commitLayerDropIntent: vi.fn(() => Promise.resolve()),
  resolveDropIndexFromAnchors: vi.fn(() => 0),
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import LayerTabContent from './LayerTabContent';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 행 높이 34px - 행 0 아이템 [0,34) / 행 1 그룹 헤더 [34,68) / 행 2 멤버 [68,102)
const ROW = 34;

describe('LayerTab 그룹 진입 존 하이라이트', () => {
  const ID_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ID_GROUPED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const GROUP_ID = 'group-1';

  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    // 동기 호출 스텁은 스케줄러의 frame 해제보다 늦게 id를 대입해
    // 후속 push가 무시되므로 microtask로 호출 순서를 보존한다
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 100,
      width: 100,
      height: ROW,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
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
    usePluginDisplayElementStore.setState({ elements: [], panelElements: [] });
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
    document.body.classList.remove('dmn-dragging');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const headerEl = () =>
    host.querySelectorAll<HTMLElement>('.dmn-row-grabbable')[1];

  const pressFirstItem = async () => {
    const itemRow = host.querySelectorAll<HTMLElement>('.dmn-row-grabbable')[0];
    await act(async () => {
      itemRow.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 0,
          clientY: 10,
        }),
      );
    });
  };

  const moveTo = async (clientY: number) => {
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 0, clientY }),
      );
    });
  };

  const release = async () => {
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
  };

  // hover:bg-surface-hover 토큰과의 부분 문자열 오탐을 피해 classList로 검사
  const hasIntoHighlight = () =>
    headerEl().classList.contains('bg-surface-hover');

  it('헤더 중앙 존에서 행 전체에 hover 토큰을 붙이고 벗어나면 뗀다', async () => {
    await pressFirstItem();

    // 헤더 중앙 (offset 17) → 진입 존
    await moveTo(ROW + 17);
    expect(hasIntoHighlight()).toBe(true);
    // 진입 존에는 삽입 인디케이터가 없다
    expect(headerEl().querySelector('.bg-accent')).toBeNull();

    // 헤더 상단 가장자리 (offset 2) → 앞 삽입 존
    await moveTo(ROW + 2);
    expect(hasIntoHighlight()).toBe(false);
    expect(headerEl().querySelector('.bg-accent')).not.toBeNull();

    await release();
  });

  it('드롭 후에는 하이라이트가 남지 않는다', async () => {
    await pressFirstItem();
    await moveTo(ROW + 17);
    expect(hasIntoHighlight()).toBe(true);

    await release();
    expect(hasIntoHighlight()).toBe(false);
  });

  it('그룹 안 삽입 인디케이터는 멤버 인덴트로 그룹 밖과 구분된다', async () => {
    await pressFirstItem();

    // 마지막 멤버 행 [68,102) 하단 절반 - 그룹 안 끝 삽입
    await moveTo(ROW * 2 + 20);
    let indicator = host.querySelector<HTMLElement>('.bg-accent')!;
    expect(indicator.classList.contains('left-[28px]')).toBe(true);
    expect(indicator.classList.contains('left-0')).toBe(false);

    // 최하단 빈 영역 - 같은 위치의 바지만 그룹 밖 삽입
    await moveTo(ROW * 3 + 40);
    indicator = host.querySelector<HTMLElement>('.bg-accent')!;
    expect(indicator.classList.contains('left-0')).toBe(true);
    expect(indicator.classList.contains('left-[28px]')).toBe(false);

    await release();
  });
});
