/**
 * 순서 변경이 도는 동안 도착한 권위 스냅샷을 어떻게 다루는지 고정한다
 *
 * 낙관 순서를 이벤트가 되돌리면 칩이 튀었다 돌아오고, 그 사이에 또 놓으면
 * 낡은 순서 위에서 계산돼 방금 한 교체가 사라진다. 그렇다고 버리기만 하면
 * 프리셋이나 다른 창의 undo가 실려 온 순서를 영영 잃는다
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useKeyStore } from './useKeyStore';

const BUILTIN = ['4key', '5key', '6key', '8key'];
const LOCAL = ['custom-a', ...BUILTIN];
const AUTHORITATIVE = ['custom-b', ...BUILTIN];

const tabs = [
  { id: 'custom-a', name: 'A' },
  { id: 'custom-b', name: 'B' },
];

const event = (tabOrder: string[]) => ({
  customTabs: tabs,
  tabOrder,
  barCount: 4,
  selectedKeyType: '4key',
});

const store = () => useKeyStore.getState();

beforeEach(() => {
  useKeyStore.setState({
    customTabs: tabs,
    tabOrder: LOCAL,
    barCount: 4,
    pendingTabPlacements: 0,
    deferredTabPlacement: null,
    selectedKeyType: '4key',
  });
});

describe('탭 순서 이벤트 채택', () => {
  it('진행 중인 변경이 없으면 그대로 받는다', () => {
    store().adoptTabMetadataEvent(event(AUTHORITATIVE));

    expect(store().tabOrder).toEqual(AUTHORITATIVE);
    expect(store().deferredTabPlacement).toBeNull();
  });

  it('진행 중이면 순서만 미루고 customTabs와 선택은 즉시 받는다', () => {
    store().beginTabPlacementMutation();
    store().adoptTabMetadataEvent({
      ...event(AUTHORITATIVE),
      selectedKeyType: '6key',
    });

    expect(store().tabOrder).toEqual(LOCAL);
    expect(store().selectedKeyType).toBe('6key');
    expect(store().deferredTabPlacement?.tabOrder).toEqual(AUTHORITATIVE);
  });

  it('요청 뒤에 권위 이벤트를 들었으면 응답을 통째로 버린다', () => {
    // 응답 스냅샷은 그 트랜잭션이 커밋된 시점 값이다. 다른 창의 프리셋이나
    // undo가 그 뒤에 커밋되면 이벤트 쪽이 전부 더 새롭다
    const generation = store().tabMetadataGeneration;
    store().beginTabPlacementMutation();

    const arrived = [
      { id: 'custom-b', name: 'B' },
      { id: 'custom-c', name: '프리셋이 만든 탭' },
    ];
    store().adoptTabMetadataEvent({
      customTabs: arrived,
      tabOrder: AUTHORITATIVE,
      barCount: 4,
      selectedKeyType: '6key',
    });

    store().setTabMetadata(
      {
        customTabs: tabs,
        tabOrder: ['custom-a', 'custom-b', ...BUILTIN],
        barCount: 4,
      },
      generation,
    );

    // 순서만이 아니라 탭 목록과 선택까지 지켜져야 한다. 필드별로 갈라 받으면
    // tabOrder에는 있는데 customTabs에 없는 탭이 화면에서 사라진다
    expect(store().customTabs).toEqual(arrived);
    expect(store().selectedKeyType).toBe('6key');

    store().endTabPlacementMutation();
    expect(store().tabOrder).toEqual(AUTHORITATIVE);
  });

  it('응답은 선택 모드를 아예 건드리지 않는다', () => {
    // 선택은 keys:mode-changed가 소유한다. 다른 창의 모드 변경은 customTabs:changed
    // 없이 그 이벤트만 낼 수 있어서, 응답이 선택을 쓰면 되돌릴 길이 생긴다
    const generation = store().tabMetadataGeneration;
    useKeyStore.setState({ selectedKeyType: '8key' });

    store().setTabMetadata(
      { customTabs: tabs, tabOrder: LOCAL, barCount: 4 },
      generation,
    );

    expect(store().selectedKeyType).toBe('8key');
  });

  it('이름 변경 응답도 늦으면 최신 순서를 되돌리지 못한다', () => {
    // rename은 pendingTabPlacements를 올리지 않는다. 세대가 없으면 늦게 온
    // rename 응답이 프리셋이 맞춰둔 순서와 barCount까지 통째로 덮는다
    const generation = store().tabMetadataGeneration;

    store().adoptTabMetadataEvent({
      customTabs: tabs,
      tabOrder: AUTHORITATIVE,
      barCount: 2,
      selectedKeyType: '4key',
    });

    store().setTabMetadata(
      { customTabs: tabs, tabOrder: LOCAL, barCount: 4 },
      generation,
    );

    expect(store().tabOrder).toEqual(AUTHORITATIVE);
    expect(store().barCount).toBe(2);
  });

  it('들은 이벤트가 없으면 응답이 순서를 채운다', () => {
    // 바뀐 게 없거나 거절되면 이벤트를 내지 않는다. 그때는 응답이 유일한 진실이다
    store().beginTabPlacementMutation();

    const settled = ['custom-b', 'custom-a', ...BUILTIN];
    store().setTabMetadata(
      { customTabs: tabs, tabOrder: settled, barCount: 4 },
      store().tabMetadataGeneration,
    );
    store().endTabPlacementMutation();

    expect(store().tabOrder).toEqual(settled);
    expect(store().deferredTabPlacement).toBeNull();
  });

  it('응답이 스냅샷 없이 끝나면 미뤄둔 권위 순서를 되살린다', () => {
    store().beginTabPlacementMutation();
    store().adoptTabMetadataEvent(event(AUTHORITATIVE));

    // transport 실패나 epoch 충돌은 스냅샷을 못 싣는다
    store().endTabPlacementMutation();

    expect(store().tabOrder).toEqual(AUTHORITATIVE);
    expect(store().deferredTabPlacement).toBeNull();
  });

  it('연속 드롭에서는 마지막 하나가 끝날 때까지 되살리지 않는다', () => {
    store().beginTabPlacementMutation();
    store().beginTabPlacementMutation();
    store().adoptTabMetadataEvent(event(AUTHORITATIVE));

    store().endTabPlacementMutation();
    expect(store().tabOrder).toEqual(LOCAL);
    expect(store().deferredTabPlacement?.tabOrder).toEqual(AUTHORITATIVE);

    store().endTabPlacementMutation();
    expect(store().tabOrder).toEqual(AUTHORITATIVE);
  });

  it('되살릴 때도 barCount는 순서 길이에 맞춰 조인다', () => {
    store().beginTabPlacementMutation();
    store().adoptTabMetadataEvent({
      customTabs: tabs,
      tabOrder: ['4key', '5key'],
      barCount: 4,
      selectedKeyType: '4key',
    });
    store().endTabPlacementMutation();

    expect(store().barCount).toBe(2);
  });
});
