/**
 * 스프라이트 이미지 미리보기 카드
 * - 유실 이미지는 깨진 img 대신 자리표시자로 바꾼다
 * - 경로가 바뀌면 실패 집합을 버리고 다시 시도한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpriteImagePreviewCard from './SpriteImagePreviewCard';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MISSING_IMAGE = 'data:image/png;base64,missing';
const RESTORED_IMAGE = 'data:image/png;base64,restored';

describe('SpriteImagePreviewCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (source: string | null) => {
    act(() => {
      root.render(
        <SpriteImagePreviewCard
          source={source}
          imageFit={null}
          onPick={vi.fn()}
          onReset={vi.fn()}
          t={(key) => key}
        />,
      );
    });
  };
  const img = () => container.querySelector('img');
  const placeholder = () =>
    container.querySelector('[data-sprite-placeholder="true"]');

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('이미지 로드 실패는 img를 내리고 자리표시자를 그린다', () => {
    render(MISSING_IMAGE);
    expect(img()).not.toBeNull();
    expect(placeholder()).toBeNull();

    act(() => {
      img()!.dispatchEvent(new Event('error'));
    });
    expect(img()).toBeNull();
    expect(placeholder()).not.toBeNull();
  });

  it('경로가 바뀌면 실패 집합을 버리고 다시 시도한다', () => {
    render(MISSING_IMAGE);
    act(() => {
      img()!.dispatchEvent(new Event('error'));
    });

    render(RESTORED_IMAGE);
    expect(img()?.getAttribute('src')).toBe(RESTORED_IMAGE);
    expect(placeholder()).toBeNull();
  });

  it('이미지가 없으면 자리표시자 없이 격자만 남긴다', () => {
    render(null);
    expect(img()).toBeNull();
    expect(placeholder()).toBeNull();
  });
});
