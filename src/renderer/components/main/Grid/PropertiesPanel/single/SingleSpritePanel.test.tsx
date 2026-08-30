import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SingleSpritePanel } from './SingleSpritePanel';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  updatePositions: vi.fn((_positions: unknown, _gestureId?: string) =>
    Promise.resolve({}),
  ),
}));

vi.mock('@api/modules/itemsApi', () => ({
  spriteItemsApi: { updatePositions: mocks.updatePositions },
}));

vi.mock('@api/modules/resourceApi', () => ({
  imageApi: { load: vi.fn(() => Promise.resolve({ success: false })) },
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));

const SPRITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_SPRITE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const spritePosition = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition => ({
  id: SPRITE_ID,
  dx: 0,
  dy: 0,
  width: 200,
  height: 150,
  hidden: false,
  zIndex: null,
  layerName: null,
  groupId: null,
  className: null,
  useInlineStyles: null,
  baseImage: null,
  imageFit: null,
  imageRect: { x: 0, y: 0, width: 100, height: 100 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [],
  activation: 'whileHeld',
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  ...overrides,
});

describe('SingleSpritePanel 자세 편집', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (position: CanonicalReactiveSpritePosition) => {
    act(() => {
      root.render(
        <SingleSpritePanel
          setPanelElement={vi.fn()}
          singleSpritePosition={position}
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>() as never}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          singleScrollRefFor={() => vi.fn()}
          t={((key: string) => key) as never}
        />,
      );
    });
  };

  const seed = (position: CanonicalReactiveSpritePosition) => {
    useSpriteStore.setState({
      positions: {
        '4key': [position, spritePosition({ id: OTHER_SPRITE_ID })],
      },
    });
  };

  const buttonByText = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === text,
    )!;

  const chipByTitle = (title: string) =>
    container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatePositions.mockResolvedValue({});
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A', 'S'] },
      canonicalPositions: {
        '4key': [{ id: KEY_ID_A }, { id: KEY_ID_B }],
      } as never,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useSpriteStore.setState({ positions: {} });
  });

  it('자세 추가는 담당 키가 비어 커밋하지 않고 행만 표시한다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());

    expect(mocks.updatePositions).not.toHaveBeenCalled();
    expect(container.textContent).toContain('propertiesPanel.spritePose 1');
    expect(container.textContent).toContain(
      'propertiesPanel.spriteEmptyTriggers',
    );
  });

  it('담당 키를 선택하면 전체 필드 패치로 커밋한다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    act(() => chipByTitle('A').click());

    expect(mocks.updatePositions).toHaveBeenCalledTimes(1);
    const [rawRecord, gestureId] = mocks.updatePositions.mock.calls[0];
    const record = rawRecord as Record<
      string,
      CanonicalReactiveSpritePosition[]
    >;
    expect(gestureId).toBeUndefined();
    expect(record['4key']).toHaveLength(2);
    expect(record['4key'][0].poses).toEqual([
      {
        poseId: expect.any(String),
        triggers: [KEY_ID_A],
        matchMode: 'exact',
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        imageOverride: null,
      },
    ]);
    // 같은 모드의 다른 스프라이트는 그대로 유지
    expect(record['4key'][1]).toEqual(
      useSpriteStore.getState().positions['4key'][1],
    );
  });

  it('중복 트리거 집합은 커밋을 막고 경고를 표시한다', () => {
    const position = spritePosition({
      poses: [
        {
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          matchMode: 'exact',
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    // 두 번째 자세의 A 칩 (첫 자세 칩 다음)
    const chips = [
      ...container.querySelectorAll<HTMLButtonElement>('button[title="A"]'),
    ];
    expect(chips).toHaveLength(2);
    act(() => chips[1].click());

    expect(mocks.updatePositions).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'propertiesPanel.spriteDuplicateTriggers',
    );
  });

  it('자세 삭제는 남은 자세만으로 커밋한다', () => {
    const position = spritePosition({
      poses: [
        {
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          matchMode: 'exact',
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
        {
          poseId: 'pose-2',
          triggers: [KEY_ID_B],
          matchMode: 'exact',
          transform: { x: 4, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    const removeButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[title="propertiesPanel.spriteRemovePose"]',
      ),
    ];
    expect(removeButtons).toHaveLength(2);
    act(() => removeButtons[0].click());

    expect(mocks.updatePositions).toHaveBeenCalledTimes(1);
    const record = mocks.updatePositions.mock.calls[0][0] as Record<
      string,
      CanonicalReactiveSpritePosition[]
    >;
    expect(record['4key'][0].poses.map((pose) => pose.poseId)).toEqual([
      'pose-2',
    ]);
  });

  it('죽은 트리거 참조는 표시되고 클릭으로 제거된다', () => {
    const deadId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const position = spritePosition({
      poses: [
        {
          poseId: 'pose-1',
          triggers: [KEY_ID_A, deadId],
          matchMode: 'exact',
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    const deadChip = buttonByText('propertiesPanel.spriteMissingKey');
    expect(deadChip).toBeTruthy();
    act(() => deadChip.click());

    expect(mocks.updatePositions).toHaveBeenCalledTimes(1);
    const record = mocks.updatePositions.mock.calls[0][0] as Record<
      string,
      CanonicalReactiveSpritePosition[]
    >;
    expect(record['4key'][0].poses[0].triggers).toEqual([KEY_ID_A]);
  });
});
