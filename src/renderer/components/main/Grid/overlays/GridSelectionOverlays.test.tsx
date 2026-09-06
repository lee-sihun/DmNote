// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalEditorDocumentV1,
  CanonicalKeyPosition,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { makeCanonicalSpritePosition } from '@utils/sprite/spriteFixtures';
import GridSelectionOverlays from './GridSelectionOverlays';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import {
  useGridSelectionStore,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import { useSelectionRotationStore } from '@stores/grid/useSelectionRotationStore';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../handles/ResizeHandles', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: Record<string, unknown>) =>
      createElement('div', {
        'data-resize-handles': props.elementId,
        'data-preview-bounds': JSON.stringify(props.previewBounds),
      }),
  };
});

vi.mock('../handles/GroupResizeHandles', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: Record<string, unknown>) =>
      createElement('div', {
        'data-group-resize-handles': String(
          (props.selectedElements as unknown[]).length,
        ),
      }),
  };
});

vi.mock('../handles/GradientAxisHandle', async () => {
  const { createElement } = await import('react');
  return {
    default: () => createElement('div', { 'data-gradient-axis': '' }),
  };
});

vi.mock('../handles/SpriteCanvasHandles', async () => {
  const { createElement } = await import('react');
  return {
    default: () => createElement('div', { 'data-sprite-handles': '' }),
  };
});

const keyPosition = (
  id: string,
  dx: number,
  dy: number,
  rotation = 0,
): CanonicalKeyPosition =>
  ({ id, dx, dy, width: 30, height: 40, rotation } as CanonicalKeyPosition);

const FIRST_ID = '00000000-0000-4000-8000-000000000201';
const SECOND_ID = '00000000-0000-4000-8000-000000000202';
const PLUGIN_ELEMENT: PluginDisplayElementInternal = {
  id: 'one',
  fullId: 'plugin-1',
  pluginId: 'plugin',
  html: '<div>Plugin</div>',
  position: { x: 100, y: 30 },
  measuredSize: { width: 50, height: 20 },
};

describe('GridSelectionOverlays', () => {
  let host: HTMLDivElement;
  let root: Root;

  const renderOverlays = ({
    selectedElements = [
      { type: 'key', id: FIRST_ID, index: 0 },
    ] as SelectedElement[],
    spritePositions = {} as CanonicalEditorDocumentV1['spritePositions'],
    pluginElements = [] as PluginDisplayElementInternal[],
    hasGradientEditSession = false,
    hasSpritePoseSession = false,
    previewElementBounds = null as readonly unknown[] | null,
    firstKeyRotation = 0,
  } = {}) => {
    const positions = {
      '4key': [
        keyPosition(FIRST_ID, 10, 20, firstKeyRotation),
        keyPosition(SECOND_ID, 50, 60),
      ],
    };
    act(() => {
      useKeyStore.setState({
        selectedKeyType: '4key',
        canonicalPositions: positions,
      });
      useGridSelectionStore.setState({ selectedElements });
      useSpriteStore.setState({ positions: spritePositions });
      root.render(
        <GridSelectionOverlays
          selectedElements={selectedElements}
          positions={positions}
          statPositions={{}}
          graphPositions={{}}
          knobPositions={{}}
          spritePositions={spritePositions}
          mode="4key"
          pluginElements={pluginElements}
          zoom={2}
          panX={3}
          panY={4}
          hasGradientEditSession={hasGradientEditSession}
          hasSpritePoseSession={hasSpritePoseSession}
          previewBounds={{ x: 15, y: 25, width: 35, height: 45 }}
          previewGroupBounds={null}
          previewElementBounds={previewElementBounds}
          onResizeStart={vi.fn()}
          onResize={vi.fn()}
          onResizeEnd={vi.fn()}
          onGroupResize={vi.fn()}
          onGroupResizeEnd={vi.fn()}
          getOtherElements={() => []}
        />,
      );
    });
  };

  beforeEach(() => {
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useSpriteStore.setState({ positions: {} });
    useSelectionRotationStore.setState({
      selectionKey: null,
      referenceRotation: 0,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('단일 선택 윤곽과 리사이즈 핸들에 프리뷰 bounds를 적용한다', () => {
    renderOverlays();

    const outline = host.querySelector(
      '[data-grid-selection-outline]',
    ) as HTMLElement;
    expect(outline.style.left).toBe('31px');
    expect(outline.style.top).toBe('52px');
    expect(outline.style.width).toBe('74px');
    expect(outline.style.height).toBe('94px');
    expect(host.querySelector('[data-resize-handles]')).not.toBeNull();
    expect(host.querySelector('[data-group-resize-handles]')).toBeNull();
    expect(host.querySelector('[data-gradient-axis]')).not.toBeNull();
    expect(host.querySelector('[data-sprite-handles]')).not.toBeNull();
  });

  it('스프라이트 자세 편집 중에는 리사이즈 핸들만 숨긴다', () => {
    renderOverlays({ hasSpritePoseSession: true });

    expect(host.querySelector('[data-grid-selection-outline]')).not.toBeNull();
    expect(host.querySelector('[data-resize-handles]')).toBeNull();
    expect(host.querySelector('[data-sprite-handles]')).not.toBeNull();
  });

  it('그라데이션 편집 중에는 윤곽과 리사이즈 핸들만 숨긴다', () => {
    renderOverlays({ hasGradientEditSession: true });

    expect(host.querySelector('[data-grid-selection-outline]')).toBeNull();
    expect(host.querySelector('[data-resize-handles]')).toBeNull();
    expect(host.querySelector('[data-gradient-axis]')).not.toBeNull();
  });

  it('그룹 프리뷰 값은 단일 선택 윤곽에 영향을 주지 않는다', () => {
    renderOverlays({ previewElementBounds: [] });

    expect(host.querySelector('[data-grid-selection-outline]')).not.toBeNull();
  });

  it('다중 선택은 그룹 핸들을 사용하고 그룹 프리뷰 중 개별 윤곽을 숨긴다', () => {
    renderOverlays({
      selectedElements: [
        { type: 'key', id: FIRST_ID, index: 0 },
        { type: 'key', id: SECOND_ID, index: 1 },
      ],
      previewElementBounds: [{ id: FIRST_ID }],
    });

    expect(host.querySelectorAll('[data-grid-selection-outline]')).toHaveLength(
      0,
    );
    expect(
      host
        .querySelector('[data-group-resize-handles]')
        ?.getAttribute('data-group-resize-handles'),
    ).toBe('2');
    expect(host.querySelector('[data-resize-handles]')).toBeNull();
    expect(
      host.querySelector('[data-rotation-handles="selection"]'),
    ).toBeNull();
  });

  it.each([0, 30])(
    '기존 각도 %s°의 다중 선택은 공통 틀만 표시한다',
    (rotation) => {
      renderOverlays({
        selectedElements: [
          { type: 'key', id: FIRST_ID, index: 0 },
          { type: 'key', id: SECOND_ID, index: 1 },
        ],
        firstKeyRotation: rotation,
      });
      expect(
        host.querySelectorAll('[data-grid-selection-outline]'),
      ).toHaveLength(0);
      expect(host.querySelectorAll('[data-group-resize-handles]')).toHaveLength(
        1,
      );
      expect(
        host.querySelectorAll('[data-rotation-handles="selection"]'),
      ).toHaveLength(1);
      expect(host.querySelectorAll('[data-rotate-corner]')).toHaveLength(4);
      expect(host.querySelector('[data-rotation-handles="native"]')).toBeNull();
    },
  );

  it('회전 요소가 든 플러그인 혼합 선택은 공통 틀이 없어 그룹 리사이즈도 닫는다', () => {
    const mixed = [
      { type: 'key', id: FIRST_ID, index: 0 },
      { type: 'plugin', id: 'plugin-1' },
    ] as SelectedElement[];
    renderOverlays({
      selectedElements: mixed,
      pluginElements: [PLUGIN_ELEMENT],
      firstKeyRotation: 30,
    });
    expect(host.querySelector('[data-group-resize-handles]')).toBeNull();
    expect(
      host.querySelector('[data-rotation-handles="selection"]'),
    ).toBeNull();
    const outlines = host.querySelectorAll<HTMLElement>(
      '[data-grid-selection-outline]',
    );
    expect(outlines).toHaveLength(2);
    expect(outlines[0].style.transform).toBe('rotate(30deg)');
    expect(outlines[1].style.transform).toBe('');

    // 회전이 없으면 기존 논리 상자 리사이즈 그대로
    renderOverlays({
      selectedElements: mixed,
      pluginElements: [PLUGIN_ELEMENT],
    });
    expect(host.querySelector('[data-group-resize-handles]')).not.toBeNull();
    expect(host.querySelector('[data-grid-selection-outline]')).toBeNull();
  });

  it.each([0, 30])(
    '스프라이트 자세 45°와 배치 %s°의 플러그인 혼합 선택을 구분한다',
    (rotation) => {
      renderOverlays({
        selectedElements: [
          { type: 'sprite', id: FIRST_ID },
          { type: 'plugin', id: PLUGIN_ELEMENT.fullId },
        ],
        pluginElements: [PLUGIN_ELEMENT],
        spritePositions: {
          '4key': [
            makeCanonicalSpritePosition({
              id: FIRST_ID,
              rotation,
              idleTransform: { x: 10, y: -5, rotation: 45, scale: 1.2 },
            }),
          ],
        },
      });
      const outlines = host.querySelectorAll<HTMLElement>(
        '[data-grid-selection-outline]',
      );
      expect(outlines).toHaveLength(rotation === 0 ? 0 : 2);
      if (rotation === 0) {
        expect(
          host.querySelector('[data-group-resize-handles]'),
        ).not.toBeNull();
      } else {
        expect(host.querySelector('[data-group-resize-handles]')).toBeNull();
        expect(outlines[0].style.transform).toBe('rotate(30deg)');
      }
      expect(
        host.querySelector('[data-rotation-handles="selection"]'),
      ).toBeNull();
    },
  );

  it('그라데이션 편집은 회전 혼합 선택의 개별 윤곽도 숨긴다', () => {
    renderOverlays({
      selectedElements: [
        { type: 'key', id: FIRST_ID },
        { type: 'plugin', id: PLUGIN_ELEMENT.fullId },
      ],
      pluginElements: [PLUGIN_ELEMENT],
      firstKeyRotation: 30,
      hasGradientEditSession: true,
    });
    expect(host.querySelector('[data-grid-selection-outline]')).toBeNull();
    expect(host.querySelector('[data-group-resize-handles]')).toBeNull();
    expect(
      host.querySelector('[data-rotation-handles="selection"]'),
    ).toBeNull();
  });

  it('그라데이션 편집은 다중 선택의 회전 진입점도 숨긴다', () => {
    renderOverlays({
      selectedElements: [
        { type: 'key', id: FIRST_ID, index: 0 },
        { type: 'key', id: SECOND_ID, index: 1 },
      ],
      hasGradientEditSession: true,
    });
    expect(
      host.querySelector('[data-rotation-handles="selection"]'),
    ).toBeNull();
    expect(host.querySelector('[data-group-resize-handles]')).toBeNull();
    expect(host.querySelector('[data-gradient-axis]')).not.toBeNull();
  });

  it('단독 스프라이트는 배치 회전을 표시하고 자세 편집 중에는 자세 핸들에 자리를 내준다', () => {
    const options = {
      selectedElements: [{ type: 'sprite' as const, id: FIRST_ID }],
      spritePositions: {
        '4key': [makeCanonicalSpritePosition({ id: FIRST_ID, rotation: 90 })],
      },
    };
    renderOverlays(options);
    expect(
      host.querySelectorAll('[data-rotation-handles="native"]'),
    ).toHaveLength(1);
    expect(host.querySelectorAll('[data-rotate-corner]')).toHaveLength(4);
    expect(
      (host.querySelector('[data-grid-selection-outline]') as HTMLElement).style
        .transform,
    ).toBe('rotate(90deg)');
    renderOverlays({ ...options, hasSpritePoseSession: true });
    expect(host.querySelector('[data-rotation-handles="native"]')).toBeNull();
    expect(host.querySelector('[data-sprite-handles]')).not.toBeNull();
    renderOverlays(options);
    expect(host.querySelectorAll('[data-rotate-corner]')).toHaveLength(4);
  });
});
