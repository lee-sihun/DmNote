import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SingleSpritePanel } from './SingleSpritePanel';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useSpriteEditPreviewStore } from '@stores/grid/useSpriteEditPreviewStore';
import { useSpritePoseGizmoStore } from '@stores/grid/useSpritePoseGizmoStore';
import { projectSpriteResize } from '@utils/sprite/resizeProjection';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const mocks = vi.hoisted(() => ({
  patchPosition: vi.fn(
    (_mode: string, _id: string, _patch: unknown, _gestureId?: string) =>
      Promise.resolve(undefined),
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
}));

vi.mock('@api/modules/itemsApi', () => ({
  spriteItemsApi: { patchPosition: mocks.patchPosition },
}));

vi.mock('@api/modules/resourceApi', () => ({
  imageApi: { load: mocks.imageLoad },
}));

vi.mock('@utils/core/assetProbe', () => ({
  canDecodeImage: mocks.canDecodeImage,
  canLoadFont: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));

// 팝업 표면은 배치 로직 없이 열림 여부만 따라 인라인 렌더.
// 변형별 배치 계약(fallbackHeight/offsetY)은 data 속성으로 남겨 검증한다
vi.mock('@components/main/Grid/PropertiesPanel/PickerSurface', () => ({
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
vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
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
        imageOverride: null,
        contactPoint: { x: 0.5, y: 1 },
      },
    ]);
  });

  it('중복 트리거 집합은 커밋을 막고 경고를 표시한다', async () => {
    const position = spritePosition({
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
    expect(posePopup()!.dataset.fallbackHeight).toBe('297');

    // 같은 행 재클릭 - 토글 닫힘
    act(() => poseEditButtons()[0].click());
    expect(posePopup()).toBeNull();
  });

  it('행 전환은 프리뷰를 회수 없이 교체하고 편집 세션을 새로 연다', () => {
    const position = spritePosition({
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
        {
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
        {
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
          poseId: 'pose-1',
          name: '왼손',
          triggers: [KEY_ID_A],
          transform: { x: 10, y: -6, rotation: 15, scale: 1.2 },
          imageOverride: 'override.png',
        },
        {
          contactPoint: { x: 0.5, y: 1 },
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
        contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
      contactPoint: { x: 0.5, y: 1 },
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
      contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
      contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
          poseId: 'pose-1',
          name: 'propertiesPanel.spritePose 1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
        {
          contactPoint: { x: 0.5, y: 1 },
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
      contactPoint: { x: 0.5, y: 1 },
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
      contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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

  it('이미지 설정 팝업의 미리보기로 선택과 초기화를 커밋한다', async () => {
    const position = spritePosition({ baseImage: 'hand.png' });
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.configure').click());
    const popup = popupByLabel('propertiesPanel.spriteBaseImage');
    expect(popup).toBeTruthy();

    // 초기화 칩은 baseImage null 커밋
    const reset = popup!.querySelector<HTMLButtonElement>(
      'button[aria-label="imagePicker.reset"]',
    )!;
    act(() => reset.click());
    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    expect(mocks.patchPosition.mock.calls[0][2]).toEqual({ baseImage: null });

    // 미리보기 전면 선택 버튼은 파일창 결과를 baseImage로 커밋
    mocks.imageLoad.mockResolvedValue({
      success: true,
      imagePath: 'body.png',
    });
    const select = popup!.querySelector<HTMLButtonElement>(
      'button[aria-label="propertiesPanel.spriteImageSelect"]',
    )!;
    await act(async () => select.click());
    expect(mocks.patchPosition).toHaveBeenCalledTimes(2);
    expect(mocks.patchPosition.mock.calls[1][2]).toEqual({
      baseImage: 'body.png',
    });
  });

  it('이미지 설정 팝업의 위치·기준점 입력은 imageRect·pivot 패치로 커밋한다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.configure').click());
    const popup = popupByLabel('propertiesPanel.spriteBaseImage')!;
    // 표시 드롭다운도 팝업으로 이동했다
    expect(popup.querySelector('button[aria-haspopup="listbox"]')).toBeTruthy();

    const xInput = popup.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spriteImageRect X"]',
    )!;
    act(() => {
      xInput.focus();
      setInputValue(xInput, '12');
    });
    act(() => xInput.blur());
    expect(mocks.patchPosition.mock.calls.at(-1)?.[2]).toEqual({
      imageRect: { x: 12, y: 0, width: 100, height: 100 },
    });

    // 기준점은 팝업이 아니라 패널의 기본 이미지 행 아래에 산다
    const pivotY = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spritePivot Y"]',
    )!;
    act(() => {
      pivotY.focus();
      setInputValue(pivotY, '25');
    });
    act(() => pivotY.blur());
    expect(mocks.patchPosition.mock.calls.at(-1)?.[2]).toEqual({
      pivot: { x: 0.5, y: 0.25 },
    });
  });

  it('이미지 팝업과 자세 팝업은 배타 전환되고 자세 프리뷰는 발행·회수된다', () => {
    const position = spritePosition({
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
          poseId: 'pose-1',
          triggers: [KEY_ID_A],
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: null,
        },
      ],
    });
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.configure').click());
    expect(popupByLabel('propertiesPanel.spriteBaseImage')).toBeTruthy();
    // 이미지 설정 팝업은 캔버스 보조 표시가 없다
    expect(useSpriteEditPreviewStore.getState().preview).toBeNull();

    // 자세 행 클릭 - 이미지 팝업이 닫히고 자세 팝업으로 전환, 프리뷰 발행
    act(() => poseEditButtons()[0].click());
    expect(popupByLabel('propertiesPanel.spriteBaseImage')).toBeNull();
    expect(popupByLabel('propertiesPanel.spritePose 1')).toBeTruthy();
    expect(useSpriteEditPreviewStore.getState().preview).toMatchObject({
      kind: 'pose',
      positionId: SPRITE_ID,
      poseId: 'pose-1',
    });

    // 이미지 팝업으로 되돌아가면 자세 프리뷰는 회수
    act(() => buttonByText('propertiesPanel.configure').click());
    expect(useSpriteEditPreviewStore.getState().preview).toBeNull();
    expect(popupByLabel('propertiesPanel.spriteBaseImage')).toBeTruthy();

    // 같은 버튼 재클릭 토글로 닫기
    act(() => buttonByText('propertiesPanel.configure').click());
    expect(posePopup()).toBeNull();
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
          contactPoint: { x: 0.5, y: 1 },
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
      imageRect: { x: 4, y: 8, width: 96, height: 64 },
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
          contactPoint: { x: 0.5, y: 1 },
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
      imageRect: { x: 4, y: 8, width: 96, height: 64 },
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
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
    const generationBefore = useSpritePoseGizmoStore.getState().generation;

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
    expect(useSpritePoseGizmoStore.getState().generation).toBeGreaterThan(
      generationBefore,
    );
  });

  it('박스만 바뀌는 변경은 draft 자세를 건드리지 않는다', async () => {
    const position = spritePosition({
      imageRect: { x: 4, y: 8, width: 96, height: 64 },
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
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

    // legacy patch 계열: 박스 치수만 바뀌고 imageRect·자세는 그대로
    const boxOnly = { ...position, width: 100, height: 300 };
    seed(boxOnly);
    render(boxOnly);

    const preview = useSpriteEditPreviewStore.getState().preview;
    expect(
      preview?.kind === 'pose' ? preview.fallbackPose.transform : null,
    ).toEqual({ x: 12, y: -6, rotation: 15, scale: 1.2 });
  });

  it('기준점 행을 만지는 동안 축 마커가 발행되고 벗어나면 회수된다', () => {
    const position = spritePosition();
    seed(position);
    render(position);

    const pivotX = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spritePivot X"]',
    )!;
    act(() => pivotX.focus());
    expect(useSpriteEditPreviewStore.getState().preview).toEqual({
      kind: 'pivot',
      positionId: SPRITE_ID,
    });

    act(() => pivotX.blur());
    expect(useSpriteEditPreviewStore.getState().preview).toBeNull();
  });

  it('스프라이트 전환 시 자세 프리뷰가 회수된다', () => {
    const position = spritePosition({
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
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

    act(() => buttonByText('propertiesPanel.configure').click());
    let resolveLoad!: (value: { success: boolean; imagePath?: string }) => void;
    mocks.imageLoad.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }) as never,
    );
    const select = popupByLabel(
      'propertiesPanel.spriteBaseImage',
    )!.querySelector<HTMLButtonElement>(
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

  it('이미지 설정 입력은 preview로 흐르고 Escape는 게스처를 취소한다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.configure').click());
    const popup = popupByLabel('propertiesPanel.spriteBaseImage')!;
    const xInput = popup.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spriteImageRect X"]',
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
      imageRect: { x: 12, y: 0, width: 100, height: 100 },
    });

    act(() => {
      xInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(mocks.gestureCancel).toHaveBeenCalled();
  });

  it('크기 입력은 1 미만을 막고 표시 변경은 imageFit으로 커밋한다', async () => {
    const position = spritePosition();
    seed(position);
    render(position);

    act(() => buttonByText('propertiesPanel.configure').click());
    const popup = popupByLabel('propertiesPanel.spriteBaseImage')!;
    const wInput = popup.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spriteImageSize W"]',
    )!;
    act(() => {
      wInput.focus();
      setInputValue(wInput, '0');
    });
    act(() => wInput.blur());
    expect(mocks.patchPosition.mock.calls.at(-1)?.[2]).toEqual({
      imageRect: { x: 0, y: 0, width: 1, height: 100 },
    });

    await act(async () =>
      popup
        .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
        .click(),
    );
    await act(async () =>
      menuOptionByText('propertiesPanel.imageFitFill').click(),
    );
    expect(mocks.patchPosition.mock.calls.at(-1)?.[2]).toEqual({
      imageFit: 'fill',
    });
  });

  it('자세 이미지 선택은 파일창 결과를 자세에 커밋한다', async () => {
    const position = spritePosition({
      poses: [
        {
          contactPoint: { x: 0.5, y: 1 },
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

    expect(mocks.canDecodeImage).toHaveBeenCalledWith('pose.png');
    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock
      .calls[0][2] as Partial<CanonicalReactiveSpritePosition>;
    expect(patch.poses?.[0].imageOverride).toBe('pose.png');
  });
});
