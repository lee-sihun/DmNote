// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type { KeyPosition, KeyPositions } from '@src/types/key/keys';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

const api = vi.hoisted(() => ({
  updatePositionsWithGesture: vi.fn(
    async (_positions: KeyPositions, _gestureId?: string) => ({}),
  ),
  updateMappingsAndPositionsWithGesture: vi.fn(async () => ({})),
}));

vi.mock('@api/modules/keysApi', () => ({
  updatePositionsWithGesture: api.updatePositionsWithGesture,
  updateMappingsAndPositionsWithGesture:
    api.updateMappingsAndPositionsWithGesture,
}));
vi.mock('@api/modules/editorApi', () => ({
  editorApi: {
    get: vi.fn(),
    commit: vi.fn(),
    onCommitted: vi.fn(() =>
      Object.assign(() => {}, { ready: Promise.resolve() }),
    ),
  },
}));
vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    cancel: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(async () => 1),
  },
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@components/main/Grid/PropertiesPanel/PickerSurface', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@components/main/common/Checkbox', () => ({ default: () => null }));
vi.mock('@components/main/common/Dropdown', () => ({ default: () => null }));
vi.mock('@components/main/common/TabSwitch', () => ({ default: () => null }));
vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: () => null,
}));
vi.mock('@components/main/Grid/PropertiesPanel/ShadowControls', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/PopupExit', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { PanelNavProvider } from '@components/main/Grid/PropertiesPanel/PanelNavContext';
import { useKeyStore } from '@stores/data/useKeyStore';
import StyleTabContent from '@components/main/Grid/PropertiesPanel/single/StyleTabContent';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID_TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const keyAt = (id: string) =>
  ({ ...createDefaultKeyPosition(), id } as KeyPosition);

const navValue = {
  activePageKey: null,
  renderPageKey: null,
  openPage: vi.fn(),
  closePage: vi.fn(),
  pageHost: null,
};

// 실호출부 통합: StyleTabContent가 completionBinding을 선언하고, 대기 중
// 재정렬·모드 전환이 일어나도 완료가 원 모드의 현재 index에 적용되는지 고정
describe('단일 스타일 패널 비동기 이미지 완료', () => {
  let host: HTMLDivElement;
  let root: Root;
  let resolveLoad: (value: unknown) => void;
  let onKeyUpdate: Mock<
    (data: Partial<KeyPosition> & { index: number }) => void
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    onKeyUpdate = vi.fn();
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [keyAt(ID_OTHER), keyAt(ID_TARGET)] },
      positions: { '4key': [keyAt(ID_OTHER), keyAt(ID_TARGET)] },
    });
    window.api = {
      image: {
        load: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveLoad = resolve;
            }),
        ),
      },
    } as never;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const mountPanel = () => {
    const target = useKeyStore.getState().canonicalPositions['4key'][1];
    act(() => {
      root.render(
        <EditSessionScope>
          <PanelNavProvider value={navValue}>
            <StyleTabContent
              keyIndex={1}
              keyPosition={target}
              keyCode={null}
              keyInfo={null}
              onPositionChange={vi.fn()}
              onKeyUpdate={onKeyUpdate}
              shadowActiveState={false}
              showSoundControls={false}
              showImagePicker
              onToggleImagePicker={vi.fn()}
              imageButtonRef={createRef<HTMLButtonElement>()}
              panelElement={null}
              t={(key) => key}
            />
          </PanelNavProvider>
        </EditSessionScope>,
      );
    });
  };

  const clickPreview = () => {
    const overlay = host.querySelector<HTMLDivElement>(
      'div.absolute.inset-0.bg-black',
    )!;
    act(() => overlay.click());
  };

  const finishLoad = async () => {
    await act(async () => {
      resolveLoad({ success: true, imagePath: '/tmp/picked.png' });
      await Promise.resolve();
    });
  };

  it('대기 중 재정렬·모드 전환에도 원 모드의 현재 index에 적용한다', async () => {
    mountPanel();
    clickPreview();

    // 대기 중 재정렬 (대상이 index 1 -> 0) + 보는 모드 전환
    act(() => {
      const [other, target] = useKeyStore.getState().canonicalPositions['4key'];
      useKeyStore.getState().setPositions({ '4key': [target, other] });
      useKeyStore.setState({ selectedKeyType: '8key' });
    });
    await finishLoad();

    expect(api.updatePositionsWithGesture).toHaveBeenCalledTimes(1);
    const persisted = api.updatePositionsWithGesture.mock.calls[0][0];
    expect(persisted['4key'][0].id).toBe(ID_TARGET);
    expect(persisted['4key'][0].inactiveImage).toBe('/tmp/picked.png');
    expect(persisted['4key'][1].inactiveImage ?? '').toBe('');
    // 레거시 index writer는 우회된다
    expect(onKeyUpdate).not.toHaveBeenCalled();
    // wire에 gestureId 없음
    expect(api.updatePositionsWithGesture.mock.calls[0][1]).toBeUndefined();
  });

  it('대기 중 요소가 삭제되면 아무것도 쓰지 않는다', async () => {
    mountPanel();
    clickPreview();

    act(() => {
      const [other] = useKeyStore.getState().canonicalPositions['4key'];
      useKeyStore.getState().setPositions({ '4key': [other] });
    });
    await finishLoad();

    expect(api.updatePositionsWithGesture).not.toHaveBeenCalled();
    expect(onKeyUpdate).not.toHaveBeenCalled();
  });
});
