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

// 행 높이 34px - 세 행이 [0,34) / [34,68) / [68,102)
const ROW = 34;

const ID_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_GROUPED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GROUP_ID = 'group-1';

// 'item-first': 아이템 / 헤더 / 멤버, 'group-first': 헤더 / 멤버 / 아이템
type RowOrder = 'item-first' | 'group-first';

let host: HTMLDivElement;
let root: Root;

const mount = async (order: RowOrder) => {
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
  const itemZ = order === 'item-first' ? 1 : 0;
  useKeyStore.setState({
    selectedKeyType: '4key',
    keyMappings: { '4key': ['A', 'S'] },
    positions: {
      '4key': [
        { id: ID_KEY, dx: 0, dy: 0, width: 60, height: 60, zIndex: itemZ },
        {
          id: ID_GROUPED,
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          zIndex: 1 - itemZ,
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
};

const unmount = async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.classList.remove('dmn-dragging');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
};

const rows = () => host.querySelectorAll<HTMLElement>('.dmn-row-grabbable');

const pressRow = async (rowIndex: number) => {
  await act(async () => {
    rows()[rowIndex].dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 0,
        clientY: ROW * rowIndex + 10,
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

const indicator = () => host.querySelector<HTMLElement>('.bg-accent');

describe('LayerTab 그룹 진입 존 하이라이트', () => {
  // 행 0 아이템 / 행 1 그룹 헤더 / 행 2 멤버
  beforeEach(() => mount('item-first'));
  afterEach(unmount);

  const headerEl = () => rows()[1];
  // 클래스 문자열 부분 검사는 hover: 접두 유틸까지 잡으므로 classList 정확 일치로 검사
  const hasIntoHighlight = () => headerEl().classList.contains('bg-fill-hover');

  it('헤더 중앙 존에서 행 전체에 hover 토큰을 붙이고 벗어나면 뗀다', async () => {
    await pressRow(0);

    // 헤더 중앙 (offset 17) → 진입 존
    await moveTo(ROW + 17);
    expect(hasIntoHighlight()).toBe(true);
    // 진입 존에는 삽입 인디케이터가 없다
    expect(headerEl().querySelector('.bg-accent')).toBeNull();

    // 헤더 상단 가장자리 (offset 2) → 앞 삽입 존이지만 끌던 행 바로 아래라
    // 무변경 - 하이라이트도 표식도 없다
    await moveTo(ROW + 2);
    expect(hasIntoHighlight()).toBe(false);
    expect(indicator()).toBeNull();

    // 헤더 하단 가장자리 (offset 32) → 그룹 안 첫 자리 삽입 - 멤버 행 상단 표식
    await moveTo(ROW + 32);
    expect(hasIntoHighlight()).toBe(false);
    expect(rows()[2].querySelector('.bg-accent')).not.toBeNull();

    await release();
  });

  it('드롭 후에는 하이라이트가 남지 않는다', async () => {
    await pressRow(0);
    await moveTo(ROW + 17);
    expect(hasIntoHighlight()).toBe(true);

    await release();
    expect(hasIntoHighlight()).toBe(false);
  });

  it('그룹 안 삽입 인디케이터는 멤버 인덴트로 그룹 밖과 구분된다', async () => {
    await pressRow(0);

    // 마지막 멤버 행 [68,102) 하단 절반 - 그룹 안 끝 삽입
    await moveTo(ROW * 2 + 20);
    expect(indicator()!.classList.contains('left-[28px]')).toBe(true);
    expect(indicator()!.classList.contains('left-0')).toBe(false);

    // 최하단 빈 영역 - 같은 위치의 바지만 그룹 밖 삽입
    await moveTo(ROW * 3 + 40);
    expect(indicator()!.classList.contains('left-0')).toBe(true);
    expect(indicator()!.classList.contains('left-[28px]')).toBe(false);

    await release();
  });
});

describe('LayerTab 그룹 아래 레이어의 삽입 표식', () => {
  // 행 0 그룹 헤더 / 행 1 멤버 / 행 2 그룹 밖 아이템
  beforeEach(() => mount('group-first'));
  afterEach(unmount);

  it('마지막 멤버 하단 절반으로 끌면 그룹 안 삽입 표식이 뜬다', async () => {
    await pressRow(2);

    // 슬롯은 자기 행 위 경계지만 소속이 바뀌므로 무변경이 아니다
    await moveTo(ROW + 20);
    expect(indicator()).not.toBeNull();
    expect(indicator()!.classList.contains('left-[28px]')).toBe(true);

    await release();
  });

  it('자기 행 상단 절반은 무변경이라 표식이 없다', async () => {
    await pressRow(2);

    await moveTo(ROW * 2 + 5);
    expect(indicator()).toBeNull();

    await release();
  });

  it('헤더 상단 가장자리로 끌면 그룹 앞 삽입 표식이 헤더 행에 뜬다', async () => {
    await pressRow(2);

    await moveTo(2);
    const headerIndicator = rows()[0].querySelector<HTMLElement>('.bg-accent');
    expect(headerIndicator).not.toBeNull();
    expect(headerIndicator!.classList.contains('left-0')).toBe(true);

    await release();
  });
});
