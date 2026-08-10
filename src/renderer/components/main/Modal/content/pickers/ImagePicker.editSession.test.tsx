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

import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { useKeyStore } from '@stores/data/useKeyStore';

import ImagePicker from './ImagePicker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

// 네이티브 파일 대화상자가 떠 있는 동안 편집 대상이 갈릴 수 있다.
// 이미 시작된 Promise는 언마운트로 취소되지 않으므로, 연결 직전에 확인해야 한다.
// 파일 복사는 이미 끝났으니 자산은 남기고 연결만 버린다
describe('ImagePicker 비동기 완료와 대상 전환', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onIdleImageChange: Mock<(path: string) => void>;
  let resolveLoad: (value: unknown) => void;

  const mount = (scoped: boolean) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const picker = (
      <ImagePicker
        open
        referenceRef={createRef<HTMLElement>() as never}
        onIdleImageChange={onIdleImageChange}
        onClose={vi.fn()}
        showActiveState={false}
      />
    );
    act(() => {
      root.render(
        scoped ? <EditSessionScope>{picker}</EditSessionScope> : picker,
      );
    });
  };

  // 미리보기 위 호버 오버레이가 파일 선택을 연다
  const clickPreview = () => {
    const overlay = container.querySelector<HTMLDivElement>(
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

  beforeEach(() => {
    onIdleImageChange = vi.fn();
    useKeyStore.setState({ selectedKeyType: '4key' });
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('대상이 그대로면 고른 이미지를 연결한다', async () => {
    mount(true);
    clickPreview();

    await finishLoad();

    expect(onIdleImageChange).toHaveBeenCalledWith('/tmp/picked.png');
  });

  it('대기 중 모드가 바뀌면 연결하지 않는다', async () => {
    mount(true);
    clickPreview();

    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });
    await finishLoad();

    expect(onIdleImageChange).not.toHaveBeenCalled();
  });

  it('캔버스 대상에 묶이지 않은 피커는 모드가 바뀌어도 연결한다', async () => {
    mount(false);
    clickPreview();

    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });
    await finishLoad();

    expect(onIdleImageChange).toHaveBeenCalledWith('/tmp/picked.png');
  });
});
