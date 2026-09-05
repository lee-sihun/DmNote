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
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

import ImagePicker from './ImagePicker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  imageLoad: vi.fn(),
  canDecodeImage: vi.fn(),
}));

vi.mock('@api/modules/resourceApi', () => ({
  imageApi: {
    load: (...args: unknown[]) => apiMocks.imageLoad(...args),
  },
}));

vi.mock('@utils/media/assetProbe', () => ({
  canDecodeImage: (...args: unknown[]) => apiMocks.canDecodeImage(...args),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@components/main/Grid/PropertiesPanel/controls/PickerSurface', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@components/main/common/checkbox/Checkbox', () => ({ default: () => null }));
vi.mock('@components/main/common/dropdown/Dropdown', () => ({ default: () => null }));
vi.mock('@components/main/common/TabSwitch', () => ({ default: () => null }));

// 네이티브 파일 대화상자가 떠 있는 동안 편집 대상이 갈릴 수 있다.
// 이미 시작된 Promise는 언마운트로 취소되지 않으므로, 연결 직전에 확인해야 한다.
// 파일 복사는 이미 끝났으니 자산은 남기고 연결만 버린다
describe('ImagePicker 비동기 완료와 대상 전환', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onIdleImageChange: Mock<(path: string) => void>;
  let alertMock: Mock<(message: string) => Promise<void>>;
  let resolveLoad: (value: unknown) => void;

  const mount = (
    scoped: boolean,
    completionBinding?: 'session-mode' | 'element-id',
  ) => {
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
        completionBinding={completionBinding}
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

  const finishLoad = async (
    result: unknown = { success: true, imagePath: '/tmp/picked.png' },
  ) => {
    await act(async () => {
      resolveLoad(result);
      // 응답 이후 디코드 확인 await가 하나 더 있다
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    onIdleImageChange = vi.fn();
    alertMock = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { api: unknown }).api = {
      ui: { dialog: { alert: alertMock } },
    };
    useKeyStore.setState({ selectedKeyType: '4key' });
    apiMocks.canDecodeImage.mockReset().mockResolvedValue(true);
    apiMocks.imageLoad.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
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

  // 가드를 전체 대상 지문으로 넓히면 이게 깨진다. 옛 index는 여전히 A를
  // 가리키므로 A에 저장하는 것이 맞다
  it('같은 모드에서 선택만 바뀌면 편집을 시작한 대상에 연결한다', async () => {
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'key-0', index: 0 }],
    });
    mount(true);
    clickPreview();

    act(() => {
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id: 'key-1', index: 1 }],
      });
    });
    await finishLoad();

    expect(onIdleImageChange).toHaveBeenCalledWith('/tmp/picked.png');
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

  // 백엔드 시그니처를 통과해도 WebView가 못 그리면 직전 값을 덮으면 안 된다
  it('디코드에 실패한 이미지는 연결하지 않고 알린다', async () => {
    apiMocks.canDecodeImage.mockResolvedValue(false);
    mount(true);
    clickPreview();

    await finishLoad();

    expect(onIdleImageChange).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalled();
  });

  it('백엔드가 errorCode로 거절하면 알린다', async () => {
    mount(true);
    clickPreview();

    await finishLoad({ success: false, errorCode: 'invalid-image-content' });

    expect(onIdleImageChange).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalled();
  });

  it('사용자 취소는 조용히 무시한다', async () => {
    mount(true);
    clickPreview();

    await finishLoad({ success: false });

    expect(onIdleImageChange).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  // element-id 결합은 유효성 판정을 ID applier에 위임한다. 모드가 바뀌어도
  // 콜백은 호출되고, 원 요소 연결·삭제 중단은 applier가 결정한다
  it('element-id 결합이면 모드가 바뀌어도 완료를 콜백에 전달한다', async () => {
    mount(true, 'element-id');
    clickPreview();

    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });
    await finishLoad();

    expect(onIdleImageChange).toHaveBeenCalledWith('/tmp/picked.png');
  });
});

describe('ImagePicker 이미지 미리보기', () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderPicker = (imageFit: string) => {
    act(() => {
      root.render(
        <ImagePicker
          open
          referenceRef={createRef<HTMLElement>() as never}
          idleImage="data:image/png;base64,preview"
          idleImageFit={imageFit}
          idleImageTransform={{
            offsetX: 12.5,
            offsetY: -4,
            rotation: 25,
            scale: 0.5,
          }}
          onIdleImageFitChange={vi.fn()}
          onImageTransformChange={vi.fn()}
          onClose={vi.fn()}
          showActiveState={false}
        />,
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(['cover', 'contain', 'fill', 'none'])(
    '%s 맞춤과 위치·회전·크기를 미리보기 이미지에 적용한다',
    (imageFit) => {
      renderPicker(imageFit);

      const preview = container.querySelector<HTMLImageElement>(
        '[data-image-picker-preview]',
      );

      expect(preview).not.toBeNull();
      expect(preview!.style.objectFit).toBe(imageFit);
      expect(preview!.style.transform).toBe(
        'translate(12.5px, -4px) rotate(25deg) scale(0.5)',
      );
    },
  );

  it('원본에서도 픽셀 크기 안내 없이 렌더링한다', () => {
    renderPicker('none');

    expect(
      container.querySelector('[data-image-picker-dimensions]'),
    ).toBeNull();
  });
});
