import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  // true면 편집기 청크가 렌더 시점에 실패한 것으로 친다
  editorBroken: false,
  submitWebFont: vi.fn<() => boolean>(),
  alert: vi.fn<() => Promise<void>>(),
  submitFromEditor: null as null | ((css: string, name: string) => void),
  initialCss: null as string | null,
  customFonts: [] as { id: string; type: string; cssContent: string }[],
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@stores/useFontStore', () => ({
  useFontStore: () => ({ builtinFonts: [], customFonts: mocks.customFonts }),
}));
vi.mock('@hooks/useFontLibrary', () => ({
  useFontLibrary: () => ({
    submitWebFont: mocks.submitWebFont,
    isDuplicateFontFamily: () => false,
  }),
}));
vi.mock('./WebFontInputModal', () => ({
  default: ({
    onSubmit,
    initialCss,
  }: {
    onSubmit: (css: string, displayName: string) => void;
    initialCss?: string;
  }) => {
    if (mocks.editorBroken) {
      throw new TypeError('Importing a module script failed.');
    }
    mocks.submitFromEditor = onSubmit;
    mocks.initialCss = initialCss ?? null;
    return <div data-testid="web-font-editor">editor</div>;
  },
}));

import WebFontEditorSheet from './WebFontEditorSheet';
import { resetWebFontEditorLoader } from './webFontEditorLoader';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const editorNode = () =>
  document.querySelector('[data-testid="web-font-editor"]');

describe('WebFontEditorSheet', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onDone: ReturnType<typeof vi.fn<(outcome: string) => void>>;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onDone = vi.fn<(outcome: string) => void>();
    mocks.editorBroken = false;
    mocks.submitFromEditor = null;
    mocks.initialCss = null;
    mocks.customFonts = [];
    // 테스트마다 import 프라미스를 새로 - 이미 이행된 프라미스를 새 lazy가 다시 쓰면
    // act()의 동기 flush가 재시도를 무한 반복한다(실제 스케줄러에서는 정상, act 한정 특성)
    resetWebFontEditorLoader();
    mocks.submitWebFont.mockReset();
    mocks.alert.mockResolvedValue(undefined);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { dialog: { alert: mocks.alert } } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    mocks.alert.mockReset();
    vi.restoreAllMocks();
  });

  const renderSheet = async () => {
    await act(async () => {
      root.render(<WebFontEditorSheet editingId={null} onDone={onDone} />);
    });
    await flush();
  };

  it('편집기를 못 띄우면 안내하고 failed로 접는다. 창 트리는 산다', async () => {
    mocks.editorBroken = true;
    await renderSheet();

    expect(mocks.alert).toHaveBeenCalledWith('fontPicker.editorLoadFailed', {
      confirmText: 'common.ok',
    });
    expect(onDone).toHaveBeenCalledWith('failed');
    expect(editorNode()).toBeNull();
    expect(host.isConnected).toBe(true);
  });

  it('편집 대상 id가 이 창의 목록에 없으면 열지 않고 failed로 접는다', async () => {
    // 하이드레이션 전이거나 삭제된 폰트. 추가 모드로 열면 제출이 그 id를 덮어쓴다
    await act(async () => {
      root.render(<WebFontEditorSheet editingId="gone" onDone={onDone} />);
    });
    await flush();

    expect(editorNode()).toBeNull();
    expect(mocks.alert).toHaveBeenCalledWith('fontPicker.editTargetMissing', {
      confirmText: 'common.ok',
    });
    expect(onDone).toHaveBeenCalledWith('failed');
    expect(mocks.submitWebFont).not.toHaveBeenCalled();
  });

  it('편집 중 다른 창이 대상을 지워도 쓰던 CSS를 걷어가지 않는다', async () => {
    mocks.customFonts = [{ id: 'f1', type: 'web', cssContent: 'css' }];
    await act(async () => {
      root.render(<WebFontEditorSheet editingId="f1" onDone={onDone} />);
    });
    await flush();
    expect(mocks.initialCss).toBe('css');

    // 다른 창이 폰트를 지운 뒤 이 창이 다시 그려진다
    mocks.customFonts = [];
    await act(async () => {
      root.render(<WebFontEditorSheet editingId="f1" onDone={onDone} />);
    });
    await flush();

    expect(mocks.initialCss).toBe('css');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('편집 대상이 있으면 그 id로 편집 모드로 연다', async () => {
    mocks.customFonts = [{ id: 'f1', type: 'web', cssContent: 'css' }];
    await act(async () => {
      root.render(<WebFontEditorSheet editingId="f1" onDone={onDone} />);
    });
    await flush();

    expect(editorNode()).not.toBeNull();
    mocks.submitWebFont.mockReturnValueOnce(true);
    await act(async () => mocks.submitFromEditor?.('css2', 'F1'));
    expect(mocks.submitWebFont).toHaveBeenLastCalledWith('css2', 'F1', 'f1');
    expect(onDone).toHaveBeenCalledWith('saved');
  });

  it('저장이 성공해야 saved로 닫고, 거절되면 열어 둔다', async () => {
    await renderSheet();
    expect(editorNode()).not.toBeNull();

    mocks.submitWebFont.mockReturnValueOnce(false);
    await act(async () => mocks.submitFromEditor?.('css', 'Dup'));
    expect(onDone).not.toHaveBeenCalled();

    mocks.submitWebFont.mockReturnValueOnce(true);
    await act(async () => mocks.submitFromEditor?.('css', 'Fresh'));
    expect(mocks.submitWebFont).toHaveBeenLastCalledWith('css', 'Fresh', null);
    expect(onDone).toHaveBeenCalledWith('saved');
  });
});
