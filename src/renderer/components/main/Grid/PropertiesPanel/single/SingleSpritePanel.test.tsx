import React, { act, createRef, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SingleSpritePanel } from './SingleSpritePanel';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useSpriteEditPreviewStore } from '@stores/grid/useSpriteEditPreviewStore';
import {
  useSpritePoseHandleStore,
  type SpritePoseHandleSession,
} from '@stores/grid/useSpritePoseHandleStore';
import { makeSpritePose } from '@utils/sprite/spriteFixtures';
import { projectSpriteResize } from '@utils/sprite/resizeProjection';
import {
  placeSpriteVisual,
  spritePoseVisual,
} from '@utils/sprite/spritePlacement';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const mocks = vi.hoisted(() => ({
  patchPosition: vi.fn(
    (
      _mode: string,
      _id: string,
      _patch: unknown,
      _gestureId?: string,
      _generatePatch?: unknown,
    ) => Promise.resolve(undefined),
  ),
  preview: vi.fn(),
  gestureCancel: vi.fn(),
  imageLoad: vi.fn(() =>
    Promise.resolve({ success: false } as {
      success: boolean;
      imagePath?: string;
      errorCode?: string;
    }),
  ),
  canDecodeImage: vi.fn(() => Promise.resolve(true)),
  probeImageSize: vi.fn(() => Promise.resolve({ width: 64, height: 32 })),
  commitBounds: vi.fn(
    (_type: string, _id: string, _bounds: unknown, _gestureId?: string) =>
      Promise.resolve(true),
  ),
}));

// 요소 상자(위치·크기)는 resizeSprite op 경로 - 커밋 인자만 검증한다
vi.mock(
  '@src/renderer/editor/runtime/operations/elementOps',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    commitSingleElementBoundsById: mocks.commitBounds,
  }),
);

vi.mock('@api/modules/editor/itemsApi', () => ({
  spriteItemsApi: { patchPosition: mocks.patchPosition },
}));

vi.mock('@api/modules/resources/resourceApi', () => ({
  imageApi: { load: mocks.imageLoad },
}));

vi.mock('@utils/media/assetProbe', () => ({
  canDecodeImage: mocks.canDecodeImage,
  probeImageSize: mocks.probeImageSize,
  canLoadFont: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));

// 팝업 표면은 배치 로직 없이 열림 여부만 따라 인라인 렌더.
// 변형별 배치 계약(fallbackHeight/offsetY)은 data 속성으로 남겨 검증한다
vi.mock('@components/main/Grid/PropertiesPanel/controls/PickerSurface', () => ({
  default: ({
    open,
    children,
    ariaLabel,
    fallbackHeight,
    offsetY,
    anchorKey,
  }: {
    open: boolean;
    children: React.ReactNode;
    ariaLabel: string;
    fallbackHeight: number;
    offsetY?: number;
    anchorKey?: React.Key;
  }) =>
    open ? (
      <div
        data-testid="pose-popup"
        aria-label={ariaLabel}
        data-fallback-height={fallbackHeight}
        data-offset-y={offsetY}
        data-anchor-key={anchorKey}
      >
        {children}
      </div>
    ) : null,
}));

// preview 발행 계약 검증용 - 패널이 쓰는 네 메서드만 대체
vi.mock('@src/renderer/editor/runtime/gesture/editGestureController', () => ({
  editGestureController: {
    preview: mocks.preview,
    cancel: mocks.gestureCancel,
    activeGestureId: () => undefined,
    settleCommit: vi.fn(),
  },
}));

// 프리뷰 locator가 테스트 환경의 빈 요소 맵에서도 해석되게 한다
vi.mock('@src/renderer/editor/model/elementIdMap', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveElementById: () => ({ mode: '4key' }),
}));

const SPRITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_SPRITE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const spritePosition = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition => ({
  activation: 'whileHeld',
  pressDurationMs: 300,
  rotation: 0,
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
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [],
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  referenceNaturalSize: null,
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
          panelElement={container}
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

  // 상태 행 - 피커 행 문법의 div[role=button], 클릭이 팝업을 연다
  const poseEditButtons = () =>
    [...container.querySelectorAll<HTMLElement>('[role="button"]')].filter(
      (row) =>
        row.textContent?.startsWith('propertiesPanel.spritePose ') ?? false,
    );

  // 행 ⋮ 메뉴 열기 - 메뉴는 body 포털의 ListPopup
  const openPoseRowMenu = (row: HTMLElement) => {
    const moreButton = row.querySelector<HTMLButtonElement>(
      'button[aria-label="common.more"]',
    )!;
    act(() => moreButton.click());
  };

  const menuItemByText = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === text,
    )!;

  const setInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // preview 발행은 rAF 뒤 setTimeout 0에 실린다 - 프레임과 두 틱을 기다린다
  const flushPreview = async () => {
    await act(async () => {
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => resolve(null)),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  const posePopup = () =>
    container.querySelector<HTMLElement>('[data-testid="pose-popup"]');

  // 팝업 종류 구분 - 이미지 설정·상태 팝업이 같은 mock 표면을 쓴다
  const popupByLabel = (label: string) =>
    container.querySelector<HTMLElement>(
      `[data-testid="pose-popup"][aria-label="${label}"]`,
    );

  // 담당 키 드롭다운은 자세 팝업(dialog) 안에서만 찾는다 - 패널의 반응 방식
  // 드롭다운('spriteActivationHold'의 A)이 부분 일치에 걸리는 것을 차단
  const triggerDropdownByText = (text: string) =>
    [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-haspopup="listbox"]',
      ),
    ]
      .filter((button) => button.closest('[data-testid="pose-popup"]'))
      .find((button) => button.textContent?.includes(text))!;

  const openListbox = () =>
    document.querySelector(
      '[role="listbox"]:not([data-dmn-motion-state="closing"])',
    );

  // 메뉴는 body 포털로 뜨므로 document에서 옵션을 찾는다
  const menuOptionByText = (text: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="listbox"]:not([data-dmn-motion-state="closing"]) [role="option"]',
      ),
    ].find((option) => option.textContent === text)!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    mocks.patchPosition.mockResolvedValue(undefined);
    mocks.imageLoad.mockResolvedValue({ success: false });
    mocks.canDecodeImage.mockResolvedValue(true);
    mocks.probeImageSize.mockResolvedValue({ width: 64, height: 32 });
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
    vi.unstubAllGlobals();
    container.remove();
    useSpriteStore.setState({ positions: {} });
    useSpriteEditPreviewStore.setState({ preview: null });
  });

  it('자세 추가는 담당 키가 비어 커밋하지 않고 요약 행과 편집 팝업만 연다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());

    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(container.textContent).toContain('propertiesPanel.spritePose 1');
    // 빈 트리거 안내 문구는 제거됐다 - 요약 행은 자리표시 텍스트만 보인다
    expect(container.textContent).not.toContain(
      'propertiesPanel.spriteEmptyTriggers',
    );
    // 새 자세는 편집 팝업이 바로 열려 담당 키 드롭다운이 보인다
    expect(
      triggerDropdownByText('propertiesPanel.spriteTriggerPlaceholder'),
    ).toBeTruthy();
  });

  it('담당 키를 선택하면 id 기반 필드 패치로 커밋한다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    await act(async () =>
      triggerDropdownByText('propertiesPanel.spriteTriggerPlaceholder').click(),
    );
    await act(async () => menuOptionByText('A').click());

    // 다중 모드라 메뉴는 열린 채 체크 상태만 갱신된다
    expect(openListbox()).not.toBeNull();
    expect(menuOptionByText('A').getAttribute('aria-selected')).toBe('true');

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const [mode, spriteId, rawPatch, gestureId] =
      mocks.patchPosition.mock.calls[0];
    const patch = rawPatch as Partial<CanonicalReactiveSpritePosition>;
    expect(mode).toBe('4key');
    expect(spriteId).toBe(SPRITE_ID);
    expect(gestureId).toBeUndefined();
    // 대상 스프라이트의 바뀐 필드만 실린다
    expect(Object.keys(patch)).toEqual(['poses']);
    expect(patch.poses).toEqual([
      {
        poseId: expect.any(String),
        // 표준 관례: 자동 번호는 생성 시점에 이름으로 고정된다 (sticky)
        name: 'propertiesPanel.spritePose 1',
        triggers: [KEY_ID_A],
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        pivot: null,
        imageOverride: null,
        imageOverrideMetrics: null,
      },
    ]);
    const generatePatch = mocks.patchPosition.mock.calls[0][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition>;
    expect(generatePatch(position).poses).toEqual(patch.poses);
  });

  it('중복 트리거 집합은 커밋을 막고 경고를 표시한다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    // 추가된 두 번째 자세의 팝업이 바로 열린다
    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    await act(async () =>
      triggerDropdownByText('propertiesPanel.spriteTriggerPlaceholder').click(),
    );
    await act(async () => menuOptionByText('A').click());

    expect(mocks.patchPosition).not.toHaveBeenCalled();
    // 배너 대신 드롭다운 트리거가 짧은 라벨·위험 톤·사유 툴팁을 단다
    const trigger = triggerDropdownByText(
      'propertiesPanel.spriteDuplicateShort',
    );
    expect(trigger.getAttribute('title')).toBe(
      'propertiesPanel.spriteDuplicateTriggers',
    );
    expect(trigger.querySelector('span')?.className).toContain(
      'text-danger-fg',
    );
  });

  it('키 미지정 자세가 둘이어도 중복 표시 없이 커밋만 보류한다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());

    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        'button[title="propertiesPanel.spriteDuplicateTriggers"]',
      ),
    ).toBeNull();
  });

  it('기본 상태 편집 UI는 존재하지 않는다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    expect(
      container.querySelector(
        'button[aria-label="propertiesPanel.spriteIdlePose"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain(
      'propertiesPanel.spriteIdlePose',
    );
  });

  it('행 재클릭은 팝업을 토글한다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    expect(posePopup()!.getAttribute('aria-label')).toBe(
      'propertiesPanel.spritePose 1',
    );
    expect(posePopup()!.dataset.fallbackHeight).toBe('229');

    // 같은 행 재클릭 - 토글 닫힘
    act(() => poseEditButtons()[0].click());
    expect(posePopup()).toBeNull();
  });

  it('행 전환은 프리뷰를 회수 없이 교체하고 편집 세션을 새로 연다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
        {
          imageOverrideMetrics: null,
          poseId: 'pose-2',
          triggers: [KEY_ID_B],
          transform: { x: 4, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
      kind: 'pose',
      poseId: 'pose-1',
    });
    const firstPopup = posePopup();
    const firstSessionInput = firstPopup!.querySelector('input');

    // 전환 중 프리뷰가 null을 거치면 캔버스가 기본 상태로 한 번 튄다
    const transitions: Array<string | null> = [];
    const unsubscribe = useSpriteEditPreviewStore.subscribe((state) => {
      transitions.push(
        state.preview?.kind === 'pose' ? state.preview.poseId : null,
      );
    });
    act(() => poseEditButtons()[1].click());
    unsubscribe();

    expect(transitions).toEqual(['pose-2']);
    expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
      kind: 'pose',
      poseId: 'pose-2',
    });
    expect(posePopup()!.getAttribute('aria-label')).toBe(
      'propertiesPanel.spritePose 2',
    );
    // 셸은 유지되어 전환이 이어지고(등장 모션 없음), 편집 subtree만
    // poseId 세션으로 리마운트되어 입력 draft·포커스가 남지 않는다
    expect(posePopup()).toBe(firstPopup);
    expect(posePopup()!.querySelector('input')).not.toBe(firstSessionInput);
    expect(posePopup()!.dataset.anchorKey).toBe('pose-2');
  });

  it('자세 삭제는 남은 자세만으로 커밋한다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
        {
          imageOverrideMetrics: null,
          poseId: 'pose-2',
          triggers: [KEY_ID_B],
          transform: { x: 4, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    // 삭제는 행 ⋮ 메뉴에서 (팝업에는 삭제 버튼이 없다).
    // 메뉴 항목은 after-paint로 마운트되므로 프레임을 흘려보낸다
    openPoseRowMenu(poseEditButtons()[0]);
    await flushPreview();
    act(() => menuItemByText('propertiesPanel.delete').click());

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses?.map((pose) => pose.poseId)).toEqual(['pose-2']);
  });

  it('행 메뉴의 복제는 트리거만 비운 사본을 원본 아래에 추가하고 편집 팝업을 연다', async () => {
    const KEY_ID_C = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A', 'S', 'D'] },
      canonicalPositions: {
        '4key': [{ id: KEY_ID_A }, { id: KEY_ID_B }, { id: KEY_ID_C }],
      } as never,
    });
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          name: '왼손',
          triggers: [KEY_ID_A],
          transform: { x: 10, y: -6, rotation: 15, scale: 1.2 },
          imageOverride: 'override.png',
        },
        {
          imageOverrideMetrics: null,
          poseId: 'pose-2',
          triggers: [KEY_ID_B],
          transform: { x: 4, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    const sourceRow = [
      ...container.querySelectorAll<HTMLElement>('[role="button"]'),
    ].find((row) => row.textContent?.startsWith('왼손'))!;
    openPoseRowMenu(sourceRow);
    await flushPreview();
    act(() => menuItemByText('contextMenu.duplicate').click());

    // 빈 트리거 draft라 커밋은 보류되고, 사본은 복제 접미사 이름으로 뜬다
    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(
      [...container.querySelectorAll<HTMLElement>('[role="button"]')].filter(
        (row) => row.textContent?.startsWith('왼손'),
      ),
    ).toHaveLength(2);
    expect(posePopup()!.getAttribute('aria-label')).toBe(
      '왼손 common.copySuffix',
    );
    // 이름 있는 사본이 사이에 끼어도 무명 상태의 번호는 밀리지 않는다
    expect(poseEditButtons()[0].textContent).toContain(
      'propertiesPanel.spritePose 1',
    );

    // 담당 키를 지정하면 사본까지 실려 커밋된다
    await act(async () =>
      triggerDropdownByText('propertiesPanel.spriteTriggerPlaceholder').click(),
    );
    await act(async () => menuOptionByText('D').click());

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses).toEqual([
      position.poses[0],
      {
        poseId: expect.any(String),
        name: '왼손 common.copySuffix',
        triggers: [KEY_ID_C],
        transform: { x: 10, y: -6, rotation: 15, scale: 1.2 },
        imageOverride: 'override.png',
        imageOverrideMetrics: null,
      },
      // 구조 변경 시 무명 상태는 보이던 번호가 이름으로 고정된다
      { ...position.poses[1], name: 'propertiesPanel.spritePose 1' },
    ]);
    expect(patch.poses?.[1].poseId).not.toBe('pose-1');
  });

  it('사본을 다시 복제하면 접미사를 겹치지 않고 숫자를 올린다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          name: '왼손 common.copySuffix',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    const sourceRow = [
      ...container.querySelectorAll<HTMLElement>('[role="button"]'),
    ].find((row) => row.textContent?.startsWith('왼손'))!;
    openPoseRowMenu(sourceRow);
    await flushPreview();
    act(() => menuItemByText('contextMenu.duplicate').click());

    expect(posePopup()!.getAttribute('aria-label')).toBe(
      '왼손 common.copySuffix 2',
    );
  });

  it('숫자 카운터 사본은 루트로 복귀하고, 생성 불가 숫자는 사용자 작명으로 보존한다', async () => {
    const makeNamedPose = (poseId: string, name: string, key: string) => ({
      poseId,
      name,
      triggers: [key],
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
      imageOverride: null,
      imageOverrideMetrics: null,
    });
    const position = spritePosition({
      poses: [
        // 생성 규칙상 카운터 - 루트 '왼손'으로 축약돼 빈 자리부터 다시 센다
        makeNamedPose('pose-1', '왼손 common.copySuffix 3', KEY_ID_A),
        // 카운터로 생성될 수 없는 0 - 이름 전체가 루트로 보존된다
        makeNamedPose('pose-2', '왼손 common.copySuffix 0', KEY_ID_B),
      ],
    });
    seed(position);
    render(position);

    const rowByName = (name: string) =>
      [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
        (row) => row.textContent?.startsWith(name),
      )!;

    openPoseRowMenu(rowByName('왼손 common.copySuffix 3'));
    await flushPreview();
    act(() => menuItemByText('contextMenu.duplicate').click());
    expect(posePopup()!.getAttribute('aria-label')).toBe(
      '왼손 common.copySuffix',
    );

    openPoseRowMenu(rowByName('왼손 common.copySuffix 0'));
    await flushPreview();
    act(() => menuItemByText('contextMenu.duplicate').click());
    expect(posePopup()!.getAttribute('aria-label')).toBe(
      '왼손 common.copySuffix 0 common.copySuffix',
    );
  });

  it('상태를 삭제해도 남은 상태의 번호는 유지된다', async () => {
    const poses = Array.from({ length: 5 }, (_, index) => ({
      poseId: `pose-${index + 1}`,
      triggers: [`key-${index}`],
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
      imageOverride: null,
      imageOverrideMetrics: null,
    }));
    const position = spritePosition({ poses });
    seed(position);
    render(position);

    // 상태 4 삭제
    openPoseRowMenu(poseEditButtons()[3]);
    await flushPreview();
    act(() => menuItemByText('propertiesPanel.delete').click());

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    // 상태 5는 상태 4로 당겨지지 않고 번호를 유지한다 (sticky)
    expect(patch.poses?.map((pose) => pose.name)).toEqual([
      'propertiesPanel.spritePose 1',
      'propertiesPanel.spritePose 2',
      'propertiesPanel.spritePose 3',
      'propertiesPanel.spritePose 5',
    ]);
    const rowTexts = [
      ...container.querySelectorAll<HTMLElement>('[role="button"]'),
    ]
      .map((row) => row.textContent ?? '')
      .filter((text) => text.startsWith('propertiesPanel.spritePose '));
    expect(rowTexts.some((text) => text.includes('spritePose 5'))).toBe(true);
    expect(rowTexts.some((text) => text.includes('spritePose 4'))).toBe(false);

    // 새 상태는 비어 있는 가장 작은 번호(4)를 재사용한다
    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    expect(posePopup()!.getAttribute('aria-label')).toBe(
      'propertiesPanel.spritePose 4',
    );
  });

  it('저장된 자동 이름은 무변경 이름 변경에서 커밋되지 않는다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          name: 'propertiesPanel.spritePose 1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    openPoseRowMenu(poseEditButtons()[0]);
    await flushPreview();
    act(() => menuItemByText('contextMenu.rename').click());

    const input =
      container.querySelector<HTMLInputElement>('input.caret-accent')!;
    expect(input.value).toBe('propertiesPanel.spritePose 1');
    act(() => input.blur());
    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  it('이름을 비우면 점유 번호를 피해 자동 이름을 재부여한다', async () => {
    const makeAutoNamed = (poseId: string, ordinal: number, key: string) => ({
      poseId,
      name: `propertiesPanel.spritePose ${ordinal}`,
      triggers: [key],
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
      imageOverride: null,
      imageOverrideMetrics: null,
    });
    const position = spritePosition({
      poses: [
        makeAutoNamed('pose-1', 1, KEY_ID_A),
        makeAutoNamed('pose-2', 5, KEY_ID_B),
      ],
    });
    seed(position);
    render(position);

    openPoseRowMenu(poseEditButtons()[1]);
    await flushPreview();
    act(() => menuItemByText('contextMenu.rename').click());

    const input =
      container.querySelector<HTMLInputElement>('input.caret-accent')!;
    act(() => {
      setInputValue(input, '');
    });
    act(() => input.blur());

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses?.[1]).toMatchObject({
      poseId: 'pose-2',
      name: 'propertiesPanel.spritePose 2',
    });
  });

  it('명시 자동 이름과 무명이 혼재해도 표시 번호가 중복되지 않는다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          name: 'propertiesPanel.spritePose 1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
        {
          imageOverrideMetrics: null,
          poseId: 'pose-2',
          triggers: [KEY_ID_B],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    // 무명 행은 점유된 1을 건너뛰고 2로 표시된다
    const rows = poseEditButtons();
    expect(rows[1].textContent).toContain('propertiesPanel.spritePose 2');

    // 구조 변경에서도 같은 번호로 고정된다
    openPoseRowMenu(rows[1]);
    await flushPreview();
    act(() => menuItemByText('contextMenu.duplicate').click());
    expect(posePopup()!.getAttribute('aria-label')).toBe(
      'propertiesPanel.spritePose 2 common.copySuffix',
    );
  });

  it('상태가 최대 개수면 복제 메뉴 항목이 비활성이다', async () => {
    const poses = Array.from({ length: 64 }, (_, index) => ({
      poseId: `pose-${index}`,
      triggers: [`key-${index}`],
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
      imageOverride: null,
      imageOverrideMetrics: null,
    }));
    const position = spritePosition({ poses });
    seed(position);
    render(position);

    openPoseRowMenu(poseEditButtons()[0]);
    await flushPreview();
    const item = menuItemByText('contextMenu.duplicate');
    expect(item.disabled).toBe(true);

    act(() => item.click());
    expect(poseEditButtons()).toHaveLength(64);
    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  it('복제 draft는 이전 커밋의 늦은 ack 재수화에도 지워지지 않는다', async () => {
    const basePose = {
      poseId: 'pose-1',
      triggers: [KEY_ID_A],
      transform: { x: 10, y: -6, rotation: 15, scale: 1.2 },
      imageOverride: null,
      imageOverrideMetrics: null,
    };
    const position = spritePosition({ poses: [basePose] });
    seed(position);
    render(position);

    openPoseRowMenu(poseEditButtons()[0]);
    await flushPreview();
    act(() => menuItemByText('contextMenu.duplicate').click());
    expect(poseEditButtons()).toHaveLength(2);

    // 사본 이전 내용 그대로의 canonical 스냅샷 도착 - draft와 다르므로 유지돼야 한다
    const ack = spritePosition({
      poses: [{ ...basePose, transform: { ...basePose.transform } }],
    });
    seed(ack);
    render(ack);
    expect(poseEditButtons()).toHaveLength(2);
  });

  it('행 메뉴의 이름 변경은 인라인 입력으로 name을 커밋한다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    openPoseRowMenu(poseEditButtons()[0]);
    await flushPreview();
    act(() => menuItemByText('contextMenu.rename').click());

    const input =
      container.querySelector<HTMLInputElement>('input.caret-accent')!;
    expect(input).toBeTruthy();
    act(() => {
      setInputValue(input, '왼팔');
    });
    act(() => input.blur());

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses?.[0]).toMatchObject({ poseId: 'pose-1', name: '왼팔' });
    // 행 표시가 이름으로 바뀐다 (draft 반영)
    expect(container.textContent).toContain('왼팔');
  });

  it('이름 변경 입력은 표시 중인 기본 이름으로 시작하고 포커스를 가진다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    openPoseRowMenu(poseEditButtons()[0]);
    await flushPreview();
    act(() => menuItemByText('contextMenu.rename').click());

    const input =
      container.querySelector<HTMLInputElement>('input.caret-accent')!;
    expect(input.value).toBe('propertiesPanel.spritePose 1');
    expect(document.activeElement).toBe(input);

    // 기본 표시명 그대로 확정하면 명시 이름을 저장하지 않는다
    act(() => input.blur());
    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  it('이름 변경 Escape는 커밋 없이 닫힌다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    openPoseRowMenu(poseEditButtons()[0]);
    await flushPreview();
    act(() => menuItemByText('contextMenu.rename').click());

    const input =
      container.querySelector<HTMLInputElement>('input.caret-accent')!;
    act(() => {
      setInputValue(input, '버릴 이름');
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(container.querySelector('input.caret-accent')).toBeNull();
  });

  it('선택된 키를 다시 클릭하면 해제로 커밋한다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A, KEY_ID_B],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    await act(async () => triggerDropdownByText('A, S').click());
    await act(async () => menuOptionByText('S').click());

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses?.[0].triggers).toEqual([KEY_ID_A]);
    expect(openListbox()).not.toBeNull();
    expect(menuOptionByText('S').getAttribute('aria-selected')).toBe('false');
  });

  it('죽은 트리거 참조는 드롭다운 항목으로 표시되고 토글로 제거된다', async () => {
    const deadId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A, deadId],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    await act(async () =>
      triggerDropdownByText('propertiesPanel.spriteMissingKey').click(),
    );
    const deadOption = menuOptionByText('propertiesPanel.spriteMissingKey');
    expect(deadOption).toBeTruthy();
    expect(deadOption.className).toContain('text-danger-fg');
    await act(async () => deadOption.click());

    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses?.[0].triggers).toEqual([KEY_ID_A]);
  });

  it('담당 키 드롭다운은 팝업 크롬과 같은 기본 크기 전폭으로 렌더된다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    // 팝업이 닫혀 있으면 패널에 담당 키 드롭다운이 없다 (요약 행뿐)
    expect(triggerDropdownByText('A')).toBeUndefined();

    act(() => poseEditButtons()[0].click());
    const trigger = triggerDropdownByText('A');
    expect(trigger.className).toContain('h-[23px]');
    expect(trigger.className).toContain('w-full');
  });

  it('기본 이미지 카드로 선택과 초기화를 커밋하고 상자를 이미지 비율로 맞춘다', async () => {
    const position = spritePosition({ baseImage: 'hand.png' });
    seed(position);
    render(position);

    // 카드는 팝업 없이 패널 상단에 산다
    expect(posePopup()).toBeNull();

    // 초기화 칩은 baseImage null 커밋
    const reset = container.querySelector<HTMLButtonElement>(
      'button[aria-label="imagePicker.reset"]',
    )!;
    act(() => reset.click());
    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    expect(mocks.patchPosition.mock.calls[0][2]).toEqual({
      baseImage: null,
      referenceNaturalSize: null,
    });

    // 전면 선택 버튼은 파일창 결과를 baseImage로 커밋
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'body.png',
    });
    const select = container.querySelector<HTMLButtonElement>(
      'button[aria-label="propertiesPanel.spriteImageSelect"]',
    )!;
    await act(async () => select.click());
    expect(mocks.patchPosition).toHaveBeenCalledTimes(2);
    // 원본 크기는 디코드 확인이 읽은 값을 경로와 한 커밋으로 싣고, 요소 상자를
    // 그 비율로 줄인다: 200x150에 64x32 → 200x100, 가운데 기준점 유지 → dy 25
    expect(mocks.patchPosition.mock.calls[1][2]).toEqual({
      baseImage: 'body.png',
      referenceNaturalSize: { source: 'body.png', width: 64, height: 32 },
      dx: 0,
      dy: 25,
      width: 200,
      height: 100,
    });
    const generatePatch = mocks.patchPosition.mock.calls[1][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition>;
    expect(
      generatePatch(
        spritePosition({
          dx: 0,
          dy: 0,
          width: 300,
          height: 300,
          pivot: { x: 0.25, y: 0.75 },
        }),
      ),
    ).toMatchObject({
      baseImage: 'body.png',
      dx: 0,
      dy: 112.5,
      width: 300,
      height: 150,
    });
  });

  // 스키마가 빈 문자열을 막지 않아 플러그인·임포트로 들어온다. 그릴 수는 없지만
  // 저장소에는 남아 있으므로, 칩이 그 값을 지우는 유일한 길이다
  it('공백뿐인 이미지 경로는 그리지 않되 초기화로 정리할 수 있다', () => {
    const position = spritePosition({ baseImage: '   ' });
    seed(position);
    render(position);

    expect(container.querySelector('img')).toBeNull();

    const reset = container.querySelector<HTMLButtonElement>(
      'button[aria-label="imagePicker.reset"]',
    )!;
    expect(reset).toBeTruthy();
    act(() => reset.click());
    expect(mocks.patchPosition.mock.calls.at(-1)?.[2]).toEqual({
      baseImage: null,
      referenceNaturalSize: null,
    });
  });

  it('위치 입력은 요소 상자 커밋, 기준점 입력은 이동값 보정을 실은 패치로 커밋한다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 10, y: 0, rotation: 90, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    const xInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.position X"]',
    )!;
    act(() => {
      xInput.focus();
      setInputValue(xInput, '12');
    });
    act(() => xInput.blur());
    expect(mocks.commitBounds).toHaveBeenLastCalledWith(
      'sprite',
      SPRITE_ID,
      { dx: 12, dy: 0, width: 200, height: 150 },
      undefined,
    );

    // 연결 상태는 x/y를 유지해 기본 기준점의 화면 이동을 그대로 따라간다
    const pivotY = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spritePivot Y"]',
    )!;
    act(() => {
      pivotY.focus();
      setInputValue(pivotY, '25');
    });
    act(() => pivotY.blur());
    const patch = mocks.patchPosition.mock.calls.at(-1)?.[2] as {
      pivot: { x: number; y: number };
      idleTransform: { x: number; y: number };
      poses: Array<{ transform: { x: number; y: number; rotation: number } }>;
    };
    expect(patch.pivot).toEqual({ x: 0.5, y: 0.25 });
    expect(patch.idleTransform).toEqual({ x: 0, y: 0, rotation: 0, scale: 1 });
    expect(patch.poses[0].transform.x).toBe(10);
    expect(patch.poses[0].transform.y).toBe(0);
    expect(patch.poses[0].transform.rotation).toBe(90);
  });

  it('90° 배치 회전을 0°로 바꿔도 위치·대기 변환·자세를 수정하지 않는다', async () => {
    const position = spritePosition({
      dx: 125,
      dy: -35,
      rotation: 90,
      idleTransform: { x: 20, y: -10, rotation: 170, scale: 1.2 },
      poses: [
        makeSpritePose({
          triggers: [KEY_ID_A],
          transform: { x: -15, y: 25, rotation: -170, scale: 0.8 },
        }),
      ],
    });
    const initial = structuredClone(position);
    seed(position);
    render(position);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.rotation"]',
    )!;
    expect(input).not.toBeNull();
    expect(parseFloat(input.value)).toBe(90);

    act(() => {
      input.focus();
      setInputValue(input, '0');
    });
    await flushPreview();
    expect(mocks.preview).toHaveBeenLastCalledWith(
      '4key',
      [{ id: SPRITE_ID, patch: { rotation: 0 } }],
      { domain: 'spritePosition' },
    );
    act(() => input.blur());

    expect(mocks.patchPosition).toHaveBeenCalledExactlyOnceWith(
      '4key',
      SPRITE_ID,
      { rotation: 0 },
      undefined,
      undefined,
    );
    expect(mocks.commitBounds).not.toHaveBeenCalled();
    expect(position).toEqual(initial);
    expect(useSpriteStore.getState().positions['4key'][0]).toEqual(initial);
  });

  it('배치 회전 입력의 Escape는 90°로 복원하고 자세 변경이나 저장을 남기지 않는다', async () => {
    const position = spritePosition({
      dx: 125,
      dy: -35,
      rotation: 90,
      poses: [makeSpritePose({ triggers: [KEY_ID_A] })],
    });
    const initial = structuredClone(position);
    seed(position);
    render(position);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.rotation"]',
    )!;
    act(() => {
      input.focus();
      setInputValue(input, '45');
    });
    await flushPreview();
    expect(mocks.preview).toHaveBeenLastCalledWith(
      '4key',
      [{ id: SPRITE_ID, patch: { rotation: 45 } }],
      { domain: 'spritePosition' },
    );
    mocks.gestureCancel.mockClear();

    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    await flushPreview();

    expect(mocks.gestureCancel).toHaveBeenCalledOnce();
    expect(parseFloat(input.value)).toBe(90);
    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(mocks.commitBounds).not.toHaveBeenCalled();
    expect(useSpriteStore.getState().positions['4key'][0]).toEqual(initial);
  });

  it('자세 행 클릭은 자세 팝업을 열어 프리뷰를 발행하고 재클릭은 닫는다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    expect(useSpriteEditPreviewStore.getState().preview).toBeNull();
    act(() => poseEditButtons()[0].click());
    expect(popupByLabel('propertiesPanel.spritePose 1')).toBeTruthy();
    expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
      kind: 'pose',
      positionId: SPRITE_ID,
      poseId: 'pose-1',
    });
    // 캔버스 자세 핸들 세션도 같은 자세로 발행된다
    expect(useSpritePoseHandleStore.getState().session).toMatchObject({
      positionId: SPRITE_ID,
      poseId: 'pose-1',
      width: 200,
      height: 150,
    });

    // 같은 행 재클릭 토글로 닫기 - 프리뷰·세션 회수
    act(() => poseEditButtons()[0].click());
    expect(posePopup()).toBeNull();
    expect(useSpriteEditPreviewStore.getState().preview).toBeNull();
    expect(useSpritePoseHandleStore.getState().session).toBeNull();
  });

  it('자세 이동 프리뷰는 상태 배열 IPC 없이 선택한 자세 스냅샷만 갱신하고 확정 때 한 번 저장한다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    const session = useSpritePoseHandleStore.getState().session!;
    mocks.preview.mockClear();
    mocks.patchPosition.mockClear();

    const moved = { x: 24, y: -12, rotation: 15, scale: 1.2 };
    act(() => session.preview(moved));

    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
      poseId: 'pose-1',
      preferFallback: true,
      fallbackPose: { transform: moved },
    });

    act(() => session.commit(moved));

    expect(mocks.patchPosition).toHaveBeenCalledOnce();
    const patch = mocks.patchPosition.mock.calls[0][2] as {
      poses: Array<{ poseId: string; transform: typeof moved }>;
    };
    expect(patch.poses).toEqual([
      expect.objectContaining({ poseId: 'pose-1', transform: moved }),
    ]);
  });

  it('canonical 착지 전 draft 자세도 프리뷰 스냅샷으로 발행된다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());

    const preview = useSpriteEditPreviewStore.getState().preview;
    expect(preview).toMatchObject({
      kind: 'pose',
      positionId: SPRITE_ID,
      preferFallback: true,
    });
    expect(
      preview?.kind === 'pose' ? preview.fallbackPose.triggers : null,
    ).toEqual([]);
  });

  it('기존 자세를 무효 draft로 만들면 프리뷰가 스냅샷 우선으로 전환된다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
      poseId: 'pose-1',
      preferFallback: false,
    });

    // 유일한 담당 키 해제 - 커밋이 막힌 빈 트리거 draft가 된다
    await act(async () => triggerDropdownByText('A').click());
    await act(async () => menuOptionByText('A').click());

    const preview = useSpriteEditPreviewStore.getState().preview;
    expect(preview).toMatchObject({ kind: 'pose', preferFallback: true });
    expect(
      preview?.kind === 'pose' ? preview.fallbackPose.triggers : null,
    ).toEqual([]);
  });

  it('리사이즈 착지 시 무효 draft 자세가 같은 배율로 rebase된다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 12, y: -6, rotation: 15, scale: 1.2 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    // 유일한 담당 키 해제 - 커밋이 막힌 무효 draft가 transform을 들고 있다
    await act(async () => triggerDropdownByText('A').click());
    await act(async () => menuOptionByText('A').click());
    expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
      preferFallback: true,
    });

    // 리사이즈 착지: canonical 콘텐츠가 projection 결과 그대로 도착 (sx=0.5, sy=2)
    const resized = projectSpriteResize(position, {
      dx: 0,
      dy: 0,
      width: 100,
      height: 300,
    });
    seed(resized);
    render(resized);

    const preview = useSpriteEditPreviewStore.getState().preview;
    expect(
      preview?.kind === 'pose' ? preview.fallbackPose.transform : null,
    ).toEqual({ x: 6, y: -12, rotation: 15, scale: 1.2 });
    expect(
      preview?.kind === 'pose' ? preview.fallbackPose.triggers : null,
    ).toEqual([]);
  });

  it('무효 draft 중 외부에서 poses가 갈리면 초안을 버린다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 12, y: -6, rotation: 15, scale: 1.2 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    // 유일한 담당 키 해제 - 커밋이 막힌 무효 draft가 이전 transform을 들고 있다
    await act(async () => triggerDropdownByText('A').click());
    await act(async () => menuOptionByText('A').click());
    mocks.patchPosition.mockClear();

    // undo가 자세를 이전 값으로 되돌린 상황 (박스는 그대로라 리사이즈 rebase 밖)
    const undone = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(undone);
    render(undone);

    // 초안이 폐기돼 canonical이 그대로 보인다 - 드롭다운은 열린 채로 남아 있다
    expect(openListbox()).not.toBeNull();
    await act(async () => menuOptionByText('S').click());

    // 되돌린 canonical 위에서 커밋된다 - 초안의 옛 배열이 되살아나지 않는다
    const committed = mocks.patchPosition.mock.calls.at(-1)?.[2] as {
      poses: Array<{ transform: unknown; triggers: string[] }>;
    };
    expect(committed.poses[0].triggers).toEqual([KEY_ID_A, KEY_ID_B]);
    expect(committed.poses[0].transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
    });
  });

  it('자세 팝업이 열린 채 리사이즈가 착지하면 진행 중 편집 게스처를 취소한다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 12, y: -6, rotation: 15, scale: 1.2 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    mocks.gestureCancel.mockClear();
    const popupBefore = container.querySelector<HTMLElement>(
      '[data-testid="pose-popup"]',
    );
    expect(popupBefore).not.toBeNull();
    const generationBefore = useSpritePoseHandleStore.getState().generation;

    const resized = projectSpriteResize(position, {
      dx: 0,
      dy: 0,
      width: 100,
      height: 300,
    });
    seed(resized);
    render(resized);

    // 활성 게스처가 없으면 no-op이지만 취소 호출 자체는 착지마다 일어난다
    expect(mocks.gestureCancel).toHaveBeenCalled();
    // 팝업 리마운트 - 진행 중 스크럽 세션이 언마운트 취소로 닫힌다
    expect(popupBefore!.isConnected).toBe(false);
    expect(
      container.querySelector('[data-testid="pose-popup"]'),
    ).not.toBeNull();
    // 기즈모 소유권 세대 무효화 - 진행 중 캔버스 드래그의 pointerup 커밋 차단
    expect(useSpritePoseHandleStore.getState().generation).toBeGreaterThan(
      generationBefore,
    );
  });

  // 기즈모는 드래그 시작 시점 세션을 붙들고 취소를 부르며, 세션 콜백은 ref를 거쳐
  // 패널의 최신 배선을 읽는다. 아래 두 케이스는 그 취소가 같은 커밋의 passive
  // effect에서 올 때 이전 렌더·죽은 패널의 handleTransformCancel이 방금 버린 무효
  // draft를 fallback preview로 되살리지 않는지 본다
  describe('시작 시점 세션의 취소', () => {
    const validPose = makeSpritePose({
      poseId: 'pose-valid',
      triggers: [KEY_ID_A],
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    });
    let capturedSession: SpritePoseHandleSession | null = null;
    // 기즈모처럼 트리상 앞에서 passive effect로 시작 시점 세션의 취소를 부르는 탐침
    const CancelOnTick = ({ tick }: { tick: number }) => {
      useEffect(() => {
        if (tick > 0) capturedSession?.cancel();
      }, [tick]);
      return null;
    };
    const renderWithProbe = (
      pos: CanonicalReactiveSpritePosition | null,
      tick: number,
    ) => {
      act(() => {
        root.render(
          <>
            <CancelOnTick tick={tick} />
            {pos ? (
              <SingleSpritePanel
                setPanelElement={vi.fn()}
                panelElement={container}
                singleSpritePosition={pos}
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
              />
            ) : null}
          </>,
        );
      });
    };
    // 무효 draft(빈 트리거)와 그 자세의 팝업 - 세션과 fallback preview가 발행된다
    const openInvalidDraft = () => {
      const position = spritePosition({ poses: [validPose] });
      seed(position);
      renderWithProbe(position, 0);
      act(() => buttonByText('propertiesPanel.spriteAddPose').click());
      capturedSession = useSpritePoseHandleStore.getState().session;
      expect(capturedSession).not.toBeNull();
      const draftPoseId = capturedSession!.poseId;
      expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
        kind: 'pose',
        poseId: draftPoseId,
        preferFallback: true,
      });
      mocks.gestureCancel.mockClear();
      return draftPoseId;
    };
    const previewPoseId = () =>
      (
        useSpriteEditPreviewStore.getState().preview as {
          poseId?: string;
        } | null
      )?.poseId;

    it('undo가 draft를 버린 커밋에서 낡은 draft preview를 되살리지 않는다', () => {
      const draftPoseId = openInvalidDraft();

      // undo가 canonical 자세를 갈아 draft가 버려지는 커밋
      const undone = spritePosition({
        poses: [
          { ...validPose, transform: { x: 4, y: 0, rotation: 0, scale: 1 } },
        ],
      });
      seed(undone);
      renderWithProbe(undone, 1);

      expect(mocks.gestureCancel).toHaveBeenCalled();
      expect(previewPoseId()).not.toBe(draftPoseId);
    });

    it('패널이 내려간 커밋에서는 게스처만 닫고 낡은 draft preview를 발행하지 않는다', () => {
      openInvalidDraft();

      // 선택 해제 등으로 패널이 언마운트된 커밋 - 기즈모의 세션 소실 effect가
      // 같은 커밋에서 시작 시점 세션의 cancel을 부른다
      renderWithProbe(null, 1);

      expect(mocks.gestureCancel).toHaveBeenCalled();
      expect(useSpriteEditPreviewStore.getState().preview).toBeNull();
    });
  });

  it('박스만 바뀌는 변경은 draft 자세를 건드리지 않는다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 12, y: -6, rotation: 15, scale: 1.2 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    await act(async () => triggerDropdownByText('A').click());
    await act(async () => menuOptionByText('A').click());

    // legacy patch 계열: 상자 치수만 바뀌고 자세는 그대로
    const boxOnly = { ...position, width: 100, height: 300 };
    seed(boxOnly);
    render(boxOnly);

    const preview = useSpriteEditPreviewStore.getState().preview;
    expect(
      preview?.kind === 'pose' ? preview.fallbackPose.transform : null,
    ).toEqual({ x: 12, y: -6, rotation: 15, scale: 1.2 });
  });

  it('스프라이트 전환 시 자세 프리뷰가 회수된다', () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    expect(useSpriteEditPreviewStore.getState().preview).not.toBeNull();

    render(spritePosition({ id: OTHER_SPRITE_ID }));
    expect(useSpriteEditPreviewStore.getState().preview).toBeNull();
  });

  it('파일창 대기 중 언마운트되면 결과를 폐기한다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);

    let resolveLoad!: (value: { success: boolean; imagePath?: string }) => void;
    mocks.imageLoad.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }) as never,
    );
    const select = container.querySelector<HTMLButtonElement>(
      'button[aria-label="propertiesPanel.spriteImageSelect"]',
    )!;
    act(() => select.click());
    act(() => root.unmount());
    // afterEach 정리가 빈 루트를 다시 언마운트하게 교체
    root = createRoot(container);

    await act(async () => {
      resolveLoad({ success: true, imagePath: 'late.png' });
    });
    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  it('위치 입력은 이동 필드만 preview에 흐르고 Escape는 게스처를 취소한다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);

    const xInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.position X"]',
    )!;
    act(() => {
      xInput.focus();
      setInputValue(xInput, '12');
    });
    await flushPreview();

    const previewPatches = mocks.preview.mock.calls.map(
      (call) => (call[1] as Array<{ patch: Record<string, unknown> }>)[0].patch,
    );
    expect(previewPatches.at(-1)).toEqual({
      dx: 12,
      dy: 0,
    });

    act(() => {
      xInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(mocks.gestureCancel).toHaveBeenCalled();
  });

  it('오래된 표시 기준점에서 한 축만 바꿔도 다른 축은 canonical 값을 보존한다', () => {
    const canonical = spritePosition({ pivot: { x: 0.8, y: 0.7 } });
    const staleDisplay = spritePosition({ pivot: { x: 0.1, y: 0.2 } });
    seed(canonical);
    render(staleDisplay);

    const pivotX = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spritePivot X"]',
    )!;
    act(() => {
      pivotX.focus();
      setInputValue(pivotX, '40');
    });
    act(() => pivotX.blur());

    const patch = mocks.patchPosition.mock.calls.at(-1)?.[2] as {
      pivot: { x: number; y: number };
    };
    expect(patch.pivot).toEqual({ x: 0.4, y: 0.7 });
  });

  it('오래된 상태 변환에서 한 축만 바꿔도 나머지는 canonical 값을 보존한다', () => {
    const canonical = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 10, y: 20, rotation: 15, scale: 1.2 },
          imageOverride: null,
        },
      ],
    });
    const staleDisplay = {
      ...canonical,
      poses: [
        {
          ...canonical.poses[0],
          transform: { x: -5, y: -6, rotation: -10, scale: 0.8 },
        },
      ],
    };
    seed(canonical);
    render(staleDisplay);
    act(() => poseEditButtons()[0].click());

    const transformX = posePopup()!.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.position X"]',
    )!;
    act(() => {
      transformX.focus();
      setInputValue(transformX, '30');
    });
    act(() => transformX.blur());

    const patch = mocks.patchPosition.mock.calls.at(-1)?.[2] as {
      poses: Array<{ transform: unknown }>;
    };
    expect(patch.poses[0].transform).toEqual({
      x: 30,
      y: 20,
      rotation: 15,
      scale: 1.2,
    });
  });

  it('오래된 상태 기준점에서 한 축만 바꿔도 다른 축은 canonical 값을 보존한다', () => {
    const canonical = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 10, y: 20, rotation: 15, scale: 1.2 },
          pivot: { x: 0.8, y: 0.7 },
          imageOverride: null,
        },
      ],
    });
    const staleDisplay = {
      ...canonical,
      poses: [
        {
          ...canonical.poses[0],
          pivot: { x: 0.1, y: 0.2 },
        },
      ],
    };
    seed(canonical);
    render(staleDisplay);
    act(() => poseEditButtons()[0].click());

    const pivotX = posePopup()!.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spriteStatePivot X"]',
    )!;
    act(() => {
      pivotX.focus();
      setInputValue(pivotX, '40');
    });
    act(() => pivotX.blur());

    const patch = mocks.patchPosition.mock.calls.at(-1)?.[2] as {
      poses: Array<{ pivot: { x: number; y: number } }>;
    };
    expect(patch.poses[0].pivot).toEqual({ x: 0.4, y: 0.7 });
  });

  it('크기 입력은 비율을 고정하고 하한을 막는다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    // 200x150 → W 0은 하한 10으로, H는 비율(0.75)을 따라 7.5
    const wInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.size W"]',
    )!;
    act(() => {
      wInput.focus();
      setInputValue(wInput, '0');
    });
    act(() => wInput.blur());
    expect(mocks.commitBounds).toHaveBeenLastCalledWith(
      'sprite',
      SPRITE_ID,
      { dx: 0, dy: 0, width: 10, height: 7.5 },
      undefined,
    );

    // H 300 → W 400 (비율 유지, 상자 원점은 그대로)
    const hInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.size H"]',
    )!;
    act(() => {
      hInput.focus();
      setInputValue(hInput, '300');
    });
    act(() => hInput.blur());
    expect(mocks.commitBounds).toHaveBeenLastCalledWith(
      'sprite',
      SPRITE_ID,
      { dx: 0, dy: 0, width: 400, height: 300 },
      undefined,
    );
  });

  // 1024:1처럼 극단 비율이면 한 축의 정상 입력이 반대 축을 상한 밖으로 밀어낸다
  // 곱셈·나눗셈 분기가 따로라 두 방향 모두 고정한다 (9999/1024는 이진 정확)
  it.each<
    [
      axis: 'W' | 'H',
      size: { width: number; height: number },
      expected: { width: number; height: number },
    ]
  >([
    ['H', { width: 1024, height: 1 }, { width: 9999, height: 9.7646484375 }],
    ['W', { width: 1, height: 1024 }, { width: 9.7646484375, height: 9999 }],
  ])(
    '파생 축이 상한을 넘으면 %s 입력을 역산해 두 축을 상한 안에 둔다',
    (axis, size, expected) => {
      const position = spritePosition(size);
      seed(position);
      render(position);

      // 100을 치면 반대 축은 102400 - 반대 축을 9999에 두고 입력 축을 되돌려 계산한다
      const input = container.querySelector<HTMLInputElement>(
        `input[aria-label="propertiesPanel.size ${axis}"]`,
      )!;
      act(() => {
        input.focus();
        setInputValue(input, '100');
      });
      act(() => input.blur());
      expect(mocks.commitBounds).toHaveBeenLastCalledWith(
        'sprite',
        SPRITE_ID,
        { dx: 0, dy: 0, ...expected },
        undefined,
      );
    },
  );

  it('자세 이미지 선택은 파일창 결과를 자세에 커밋한다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'pose.png',
    });

    // 상태 이미지도 기본 이미지와 같은 전면 선택 버튼 문법
    const pickButton = posePopup()!.querySelector<HTMLButtonElement>(
      'button[aria-label="propertiesPanel.spriteImageSelect"]',
    )!;
    await act(async () => pickButton.click());

    expect(mocks.probeImageSize).toHaveBeenCalledWith('pose.png');
    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses?.[0].imageOverride).toBe('pose.png');
    expect(patch.poses?.[0].imageOverrideMetrics).toEqual({
      source: 'pose.png',
      width: 64,
      height: 32,
    });
    const generatePatch = mocks.patchPosition.mock.calls[0][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition> | null;
    expect(generatePatch(spritePosition({ poses: [] }))).toBeNull();
  });

  it('담당 키보다 먼저 고른 첫 상태 이미지의 기준 크기를 후속 저장에 보존한다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'first-pose.png',
    });
    const pickButton = posePopup()!.querySelector<HTMLButtonElement>(
      'button[aria-label="propertiesPanel.spriteImageSelect"]',
    )!;
    await act(async () => pickButton.click());
    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(
      useSpriteEditPreviewStore.getState().preview?.referenceNaturalSize,
    ).toEqual({ source: null, width: 64, height: 32 });

    await act(async () =>
      triggerDropdownByText('propertiesPanel.spriteTriggerPlaceholder').click(),
    );
    await act(async () => menuOptionByText('A').click());

    expect(mocks.patchPosition).toHaveBeenCalledOnce();
    const generatePatch = mocks.patchPosition.mock.calls[0][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition>;
    expect(generatePatch(position).referenceNaturalSize).toEqual({
      source: null,
      width: 64,
      height: 32,
    });
    const restored = JSON.parse(
      JSON.stringify({
        ...position,
        ...generatePatch(position),
      }),
    ) as CanonicalReactiveSpritePosition;
    const secondPose = makeSpritePose({
      imageOverride: 'second-pose.png',
      imageOverrideMetrics: {
        source: 'second-pose.png',
        width: 32,
        height: 32,
      },
    });
    expect(
      placeSpriteVisual(restored, spritePoseVisual(restored, secondPose)).rect,
    ).toEqual({ x: 50, y: 0, width: 100, height: 150 });

    // 대기 중 기본 이미지나 다른 상태가 기준 크기를 먼저 저장했으면 최신값 유지
    expect(
      generatePatch(
        spritePosition({
          baseImage: 'base.png',
          referenceNaturalSize: { source: 'base.png', width: 200, height: 100 },
        }),
      ),
    ).not.toHaveProperty('referenceNaturalSize');
    expect(
      generatePatch(
        spritePosition({
          referenceNaturalSize: { source: null, width: 120, height: 90 },
        }),
      ),
    ).not.toHaveProperty('referenceNaturalSize');
  });

  it('미저장 첫 이미지 기준 크기는 다른 상태 이미지와 핸들에도 같은 배율을 준다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'first-pose.png',
    });
    await act(async () =>
      posePopup()!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="propertiesPanel.spriteImageSelect"]',
        )!
        .click(),
    );

    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'second-pose.png',
    });
    mocks.probeImageSize.mockResolvedValue({ width: 32, height: 32 });
    await act(async () =>
      posePopup()!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="propertiesPanel.spriteImageSelect"]',
        )!
        .click(),
    );

    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(
      useSpriteEditPreviewStore.getState().preview?.referenceNaturalSize,
    ).toEqual({ source: null, width: 64, height: 32 });
    expect(useSpritePoseHandleStore.getState().session?.placement.rect).toEqual(
      { x: 50, y: 0, width: 100, height: 150 },
    );
  });

  it('미완성 형제의 이미지 기준값은 기존 자세 배율 저장에 섞이지 않는다', async () => {
    const position = spritePosition({
      poses: [
        makeSpritePose({
          triggers: [KEY_ID_A],
          imageOverride: 'existing.png',
          imageOverrideMetrics: {
            source: 'existing.png',
            width: 32,
            height: 32,
          },
        }),
      ],
    });
    seed(position);
    render(position);
    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'draft.png',
    });
    await act(async () =>
      posePopup()!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="propertiesPanel.spriteImageSelect"]',
        )!
        .click(),
    );
    expect(mocks.patchPosition).not.toHaveBeenCalled();

    act(() => poseEditButtons()[0].click());
    await act(async () =>
      useSpritePoseHandleStore.getState().session!.commit({
        x: 0,
        y: 0,
        rotation: 0,
        scale: 0.5,
      }),
    );
    const generate = mocks.patchPosition.mock.calls[0][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition>;
    const patch = generate(position);
    expect(patch).not.toHaveProperty('referenceNaturalSize');
    expect(patch.poses).toHaveLength(1);
    expect(patch.poses![0]).toMatchObject({
      imageOverride: 'existing.png',
      transform: { scale: 0.5 },
    });
    expect(poseEditButtons()).toHaveLength(2);
  });

  it('빈 형제를 남겨도 정상 자세의 이미지와 기준 크기는 함께 저장한다', async () => {
    const position = spritePosition({
      poses: [makeSpritePose({ triggers: [KEY_ID_A] })],
    });
    seed(position);
    render(position);
    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    act(() => poseEditButtons()[0].click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'saved.png',
    });
    await act(async () =>
      posePopup()!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="propertiesPanel.spriteImageSelect"]',
        )!
        .click(),
    );

    const generate = mocks.patchPosition.mock.calls[0][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition>;
    const patch = generate(position);
    expect(patch.referenceNaturalSize).toEqual({
      source: null,
      width: 64,
      height: 32,
    });
    expect(patch.poses).toHaveLength(1);
    expect(patch.poses![0].imageOverride).toBe('saved.png');
    expect(poseEditButtons()).toHaveLength(2);
  });

  it('정상 자세 이미지의 부분 저장은 미완성 형제 대신 저장될 이미지에서 기준 크기를 정한다', async () => {
    const position = spritePosition({
      poses: [makeSpritePose({ triggers: [KEY_ID_A] })],
    });
    seed(position);
    render(position);
    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'draft.png',
    });
    const pick = () =>
      posePopup()!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="propertiesPanel.spriteImageSelect"]',
        )!
        .click();
    await act(async () => pick());
    expect(mocks.patchPosition).not.toHaveBeenCalled();

    act(() => poseEditButtons()[0].click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'saved.png',
    });
    mocks.probeImageSize.mockResolvedValue({ width: 32, height: 32 });
    await act(async () => pick());
    const generate = mocks.patchPosition.mock.calls[0][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition>;
    const patch = generate(position);
    expect(patch.referenceNaturalSize).toEqual({
      source: null,
      width: 32,
      height: 32,
    });
    expect(patch.poses).toHaveLength(1);
    expect(patch.poses![0].imageOverride).toBe('saved.png');
  });

  it.each([
    { savedReference: null, keepKeyPose: false },
    {
      savedReference: { source: null, width: 120, height: 90 },
      keepKeyPose: false,
    },
    { savedReference: null, keepKeyPose: true },
    {
      savedReference: { source: null, width: 120, height: 90 },
      keepKeyPose: true,
    },
  ])(
    '이미지 초안 삭제는 보류 기준 크기만 버린다: 저장값 $savedReference, 키 자세 유지 $keepKeyPose',
    async ({ savedReference, keepKeyPose }) => {
      let position = spritePosition({
        referenceNaturalSize: savedReference,
        poses: keepKeyPose ? [makeSpritePose({ triggers: [KEY_ID_A] })] : [],
      });
      seed(position);
      render(position);

      act(() => buttonByText('propertiesPanel.spriteAddPose').click());
      mocks.imageLoad.mockResolvedValue({
        success: true,
        imagePath: 'discarded-pose.png',
      });
      await act(async () =>
        posePopup()!
          .querySelector<HTMLButtonElement>(
            'button[aria-label="propertiesPanel.spriteImageSelect"]',
          )!
          .click(),
      );
      expect(mocks.patchPosition).not.toHaveBeenCalled();

      openPoseRowMenu(poseEditButtons().at(-1)!);
      await flushPreview();
      await act(async () => menuItemByText('propertiesPanel.delete').click());

      const generateDelete = mocks.patchPosition.mock.calls[0][4] as (
        current: CanonicalReactiveSpritePosition,
      ) => Partial<CanonicalReactiveSpritePosition>;
      expect(generateDelete(position)).not.toHaveProperty(
        'referenceNaturalSize',
      );
      position = { ...position, ...generateDelete(position) };
      expect(position.referenceNaturalSize).toEqual(savedReference);
      expect(position.poses).toHaveLength(keepKeyPose ? 1 : 0);
      act(() => seed(position));
      render(position);
      mocks.patchPosition.mockClear();

      act(() => buttonByText('propertiesPanel.spriteAddPose').click());
      mocks.imageLoad.mockResolvedValue({
        success: true,
        imagePath: 'new-pose.png',
      });
      mocks.probeImageSize.mockResolvedValue({ width: 32, height: 32 });
      await act(async () =>
        posePopup()!
          .querySelector<HTMLButtonElement>(
            'button[aria-label="propertiesPanel.spriteImageSelect"]',
          )!
          .click(),
      );
      await act(async () =>
        triggerDropdownByText(
          'propertiesPanel.spriteTriggerPlaceholder',
        ).click(),
      );
      await act(async () => menuOptionByText(keepKeyPose ? 'S' : 'A').click());

      const generateNewPose = mocks.patchPosition.mock.calls[0][4] as (
        current: CanonicalReactiveSpritePosition,
      ) => Partial<CanonicalReactiveSpritePosition>;
      position = { ...position, ...generateNewPose(position) };
      expect(position.referenceNaturalSize).toEqual(
        savedReference ?? { source: null, width: 32, height: 32 },
      );
    },
  );

  it('이미지 초안 초기화 후 키만 지정해도 버린 기준 크기를 저장하지 않는다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);
    act(() => buttonByText('propertiesPanel.spriteAddPose').click());
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'discarded-pose.png',
    });
    await act(async () =>
      posePopup()!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="propertiesPanel.spriteImageSelect"]',
        )!
        .click(),
    );
    await act(async () =>
      posePopup()!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="imagePicker.reset"]',
        )!
        .click(),
    );
    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(
      useSpriteEditPreviewStore.getState().preview?.referenceNaturalSize,
    ).toBeUndefined();

    await act(async () =>
      triggerDropdownByText('propertiesPanel.spriteTriggerPlaceholder').click(),
    );
    await act(async () => menuOptionByText('A').click());

    const generatePatch = mocks.patchPosition.mock.calls[0][4] as (
      current: CanonicalReactiveSpritePosition,
    ) => Partial<CanonicalReactiveSpritePosition>;
    const patch = generatePatch(position);
    expect(patch).not.toHaveProperty('referenceNaturalSize');
    expect(patch.poses).toEqual([
      expect.objectContaining({
        triggers: [KEY_ID_A],
        imageOverride: null,
        imageOverrideMetrics: null,
      }),
    ]);
  });

  it('기준점 커밋 착지는 무효 draft를 같은 보정으로 rebase해 편집 중인 값을 지키지 않는다', async () => {
    const position = spritePosition({
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 10, y: 0, rotation: 90, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => poseEditButtons()[0].click());
    // 유일한 담당 키 해제 - 커밋이 막힌 빈 트리거 draft가 transform을 들고 있다
    await act(async () => triggerDropdownByText('A').click());
    await act(async () => menuOptionByText('A').click());
    mocks.patchPosition.mockClear();

    // 기준점 프리셋 (0.5, 0.25)는 없으니 Y 입력으로 - canonical 자세를 보정한 patch
    const pivotY = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spritePivot Y"]',
    )!;
    act(() => {
      pivotY.focus();
      setInputValue(pivotY, '25');
    });
    act(() => pivotY.blur());
    const patch = mocks.patchPosition.mock.calls.at(-1)?.[2] as Pick<
      CanonicalReactiveSpritePosition,
      'pivot' | 'idleTransform' | 'poses'
    >;
    expect(patch.pivot).toEqual({ x: 0.5, y: 0.25 });
    // draft(빈 트리거)가 아니라 canonical 자세가 실린다
    expect(patch.poses[0].triggers).toEqual([KEY_ID_A]);

    // 낙관 착지 - canonical이 보정된 자세와 새 기준점으로 바뀐다
    const landed = { ...position, ...patch };
    seed(landed);
    render(landed);

    // draft는 버려지지 않고 같은 보정을 받는다: 트리거는 여전히 비어 있고
    // transform은 canonical과 같은 값으로 이동했다
    const preview = useSpriteEditPreviewStore.getState().preview;
    expect(preview?.preferFallback).toBe(true);
    expect(preview?.fallbackPose.triggers).toEqual([]);
    expect(preview?.fallbackPose.transform).toEqual(patch.poses[0].transform);
  });
});
