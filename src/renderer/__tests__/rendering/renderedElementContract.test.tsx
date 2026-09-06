// @vitest-environment jsdom
// 렌더 DOM 계약 — data 속성과 --dmn-* fallback 변수가 실제 컴포넌트 루트에 실리는지 고정
// (elementShadowContract 등 기존 계약 테스트는 유틸 반환값·CSS 텍스트만 검증)
import { gradientToCss } from '@src/types/color';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Key } from '@components/shared/key/Key';
import StatItem from '@components/overlay/counters/StatItem';
import OverlayKnobItem from '@components/overlay/counters/OverlayKnobItem';
import OverlaySpriteItem from '@components/overlay/counters/OverlaySpriteItem';
import OutsideCounter from '@components/overlay/counters/OutsideCounter';
import GraphPanel from '@components/shared/graph/GraphPanel';
import { resetAllKeySignals, setKeyActive } from '@stores/signals/keySignals';
import { addAxisDelta, resetAllAxisSignals } from '@stores/signals/axisSignals';
import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';
import {
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_ACTIVE_SHADOW,
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_BORDER_GRADIENT,
  DEFAULT_ELEMENT_SHADOW,
} from '@utils/element/elementDefaults';
import {
  elementShadowToCss,
  type ElementShadowSpec,
} from '@src/types/key/shadows';

const basePosition: KeyElementPosition = {
  dx: 4,
  dy: 8,
  width: 60,
  height: 60,
};

const customShadow: ElementShadowSpec = {
  enabled: true,
  color: 'rgba(12, 34, 56, 0.45)',
  offsetX: -2,
  offsetY: 7,
  blur: 18,
};

// 유틸이 계산한 --dmn-* 변수 전부가 요소 style에 실렸는지 비교
const expectCustomPropsMatch = (
  el: HTMLElement,
  style: React.CSSProperties,
) => {
  const entries = Object.entries(style as Record<string, unknown>).filter(
    ([name, value]) => name.startsWith('--') && value != null,
  );
  expect(entries.length).toBeGreaterThan(0);
  for (const [name, value] of entries) {
    expect(el.style.getPropertyValue(name), name).toBe(String(value));
  }
};

describe('렌더 DOM 계약', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetAllKeySignals();
    resetAllAxisSignals();
  });

  describe('공유 Key', () => {
    const renderKey = (position: KeyElementPosition, globalKey: string) => {
      act(() => {
        root.render(
          <Key keyName="A" globalKey={globalKey} position={position} />,
        );
      });
      return host.querySelector<HTMLElement>('[data-key-element="true"]');
    };

    it('루트에 data 속성과 fallback 변수를 싣는다', () => {
      const el = renderKey(basePosition, 'KeyA');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-state')).toBe('inactive');
      expect(el!.dataset.overlayHit).toBe('true');
      // 일반 모드는 인라인 boxShadow 선언 없이 변수만 제공
      expect(el!.style.boxShadow).toBe('');
      expect(el!.style.getPropertyValue('--dmn-key-shadow-default')).toBe(
        DEFAULT_ELEMENT_SHADOW,
      );
      expect(el!.style.getPropertyValue('--dmn-key-bg-default')).toBe(
        DEFAULT_ELEMENT_BG,
      );
      expectCustomPropsMatch(
        el!,
        computeKeyElementStyles({
          position: basePosition,
          active: false,
          label: 'A',
        }).keyStyle,
      );
    });

    it('투명 키는 화면 없이 저장된 본체 박스만 히트 영역으로 남긴다', () => {
      const el = renderKey(
        { ...basePosition, idleTransparent: true },
        'KeyTransparent',
      );

      expect(el).toBeNull();
      const hitBox = host.querySelector<HTMLElement>(
        '[data-overlay-hit-only="true"]',
      );
      expect(hitBox).not.toBeNull();
      expect(hitBox!.dataset.overlayHit).toBe('true');
      expect(hitBox!.style.width).toBe('60px');
      expect(hitBox!.style.height).toBe('60px');
      expect(hitBox!.style.visibility).toBe('hidden');
    });

    it('키 시그널에 따라 data-state와 상태 변수가 바뀐다', () => {
      const el = renderKey(basePosition, 'KeyB');

      act(() => setKeyActive('KeyB', true));
      expect(el!.getAttribute('data-state')).toBe('active');
      expect(el!.style.getPropertyValue('--dmn-key-shadow-default')).toBe(
        DEFAULT_ELEMENT_ACTIVE_SHADOW,
      );
      expect(el!.style.getPropertyValue('--dmn-key-bg-default')).toBe(
        DEFAULT_ELEMENT_ACTIVE_BG,
      );

      act(() => setKeyActive('KeyB', false));
      expect(el!.getAttribute('data-state')).toBe('inactive');
      expect(el!.style.getPropertyValue('--dmn-key-shadow-default')).toBe(
        DEFAULT_ELEMENT_SHADOW,
      );
    });

    it('사용자 지정 그림자 변수를 그대로 싣는다', () => {
      const position: KeyElementPosition = {
        ...basePosition,
        shadow: customShadow,
      };
      const el = renderKey(position, 'KeyC');
      expect(el!.style.getPropertyValue('--dmn-key-shadow-default')).toBe(
        elementShadowToCss(customShadow),
      );
      expectCustomPropsMatch(
        el!,
        computeKeyElementStyles({ position, active: false, label: 'A' })
          .keyStyle,
      );
    });

    it('useInlineStyles면 변수 대신 인라인 선언으로 승격된다', () => {
      const el = renderKey(
        { ...basePosition, useInlineStyles: true, shadow: customShadow },
        'KeyD',
      );
      expect(el!.style.getPropertyValue('--dmn-key-shadow-default')).toBe('');
      expect(el!.style.boxShadow).toBe(elementShadowToCss(customShadow));
      expect(el!.style.backgroundColor).toBe(DEFAULT_ELEMENT_BG);
    });

    it('이미지 키 루트 배경은 기존처럼 상태 전환된다', () => {
      const position: KeyElementPosition = {
        ...basePosition,
        activeImage: 'data:image/png;base64,aW1hZ2U=',
        activeBackgroundColor: 'rgba(121, 121, 121, 0.9)',
      };
      const el = renderKey(position, 'KeyImageActiveBg');

      // 누르면 명시 입력 배경색이 루트에서 전환
      act(() => setKeyActive('KeyImageActiveBg', true));
      expect(el!.style.getPropertyValue('--dmn-key-bg-default')).toBe(
        'rgba(121, 121, 121, 0.9)',
      );
    });

    it('입력 배경색 없는 이미지 키는 눌리면 몸체가 투명으로 전환된다', () => {
      const position: KeyElementPosition = {
        ...basePosition,
        activeImage: 'data:image/png;base64,aW1hZ2U=',
      };
      const el = renderKey(position, 'KeyImageNoBg');

      act(() => setKeyActive('KeyImageNoBg', true));
      // 이미지가 전부 — 링만 허공에 뜨는 원 계약
      expect(el!.style.getPropertyValue('--dmn-key-bg-default')).toBe(
        'transparent',
      );
    });
  });

  it('입력 이미지가 없으면 대기 이미지를 감광해 재사용한다', () => {
    const position: KeyElementPosition = {
      ...basePosition,
      inactiveImage: 'data:image/png;base64,aW1hZ2U=',
    };
    const idle = computeKeyElementStyles({
      position,
      active: false,
      label: 'A',
    });
    const active = computeKeyElementStyles({
      position,
      active: true,
      label: 'A',
    });

    expect(idle.imageStyle.filter).toBe('none');
    // activeImage 부재 시 대기 이미지 + brightness 감광이 눌림 표현
    expect(active.currentImageSrc).toBe(idle.currentImageSrc);
    expect(active.imageStyle.filter).toBe('brightness(0.62)');
  });

  describe('오버레이 StatItem', () => {
    const renderStat = (active: boolean) => {
      act(() => {
        root.render(
          <StatItem
            statType="kps"
            position={basePosition}
            label="KPS"
            active={active}
          />,
        );
      });
      return host.querySelector<HTMLElement>('[data-key-element="true"]');
    };

    it('data 속성과 상태별 변수를 싣는다', () => {
      const el = renderStat(false);
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-state')).toBe('inactive');
      expectCustomPropsMatch(
        el!,
        computeKeyElementStyles({
          position: basePosition,
          active: false,
          label: 'KPS',
        }).keyStyle,
      );

      const activeEl = renderStat(true);
      expect(activeEl!.getAttribute('data-state')).toBe('active');
      expect(activeEl!.style.getPropertyValue('--dmn-key-shadow-default')).toBe(
        DEFAULT_ELEMENT_ACTIVE_SHADOW,
      );
    });

    it('투명 Stat도 화면 없이 저장된 본체 박스만 히트 영역으로 남긴다', () => {
      act(() => {
        root.render(
          <StatItem
            statType="total"
            position={{ ...basePosition, idleTransparent: true }}
            label="Total"
          />,
        );
      });

      expect(
        host.querySelector<HTMLElement>('[data-key-element="true"]'),
      ).toBeNull();
      const hitBox = host.querySelector<HTMLElement>(
        '[data-overlay-hit-only="true"]',
      );
      expect(hitBox).not.toBeNull();
      expect(hitBox!.style.width).toBe('60px');
      expect(hitBox!.style.height).toBe('60px');
    });
  });

  describe('Key·Stat 공유 face DOM', () => {
    it('border ring → image → label 순서를 공유하고 이미지 실패 시 label을 복구한다', () => {
      const imagePosition: KeyElementPosition = {
        ...basePosition,
        inactiveImage: 'data:image/png;base64,aW1hZ2U=',
        imageMode: 'overlay',
      };
      act(() => {
        root.render(
          <>
            <Key
              keyName="A"
              globalKey="KeySharedFaceImage"
              position={imagePosition}
            />
            <StatItem statType="kps" position={imagePosition} label="KPS" />
          </>,
        );
      });

      const faces = [
        ...host.querySelectorAll<HTMLElement>('[data-key-element="true"]'),
      ];
      expect(faces).toHaveLength(2);
      expect(
        faces.map((face) =>
          [...face.children].map((child) => {
            if (child.hasAttribute('data-gradient-border-ring')) return 'ring';
            if (child.hasAttribute('data-key-image-layer')) return 'image';
            return 'label';
          }),
        ),
      ).toEqual([
        ['ring', 'image', 'label'],
        ['ring', 'image', 'label'],
      ]);

      act(() => {
        faces.forEach((face) => {
          face
            .querySelector<HTMLImageElement>('[data-key-image-layer]')
            ?.dispatchEvent(new Event('error'));
        });
      });

      expect(host.querySelector('[data-key-image-layer]')).toBeNull();
      expect(
        [
          ...host.querySelectorAll<HTMLElement>('[data-key-element="true"]'),
        ].map((face) =>
          [...face.children].map((child) =>
            child.hasAttribute('data-gradient-border-ring') ? 'ring' : 'label',
          ),
        ),
      ).toEqual([
        ['ring', 'label'],
        ['ring', 'label'],
      ]);
      expect(host.textContent).toContain('A');
      expect(host.textContent).toContain('KPS');
    });
  });

  describe('오버레이 KnobItem', () => {
    it('data 속성·노브 변수를 싣고 회전 입력이 active로 전환한다', () => {
      act(() => {
        root.render(
          <OverlayKnobItem
            position={{ ...basePosition, axisId: 'axis-render-test' }}
          />,
        );
      });
      const el = host.querySelector<HTMLElement>('[data-knob-element="true"]');
      expect(el).not.toBeNull();
      expect(
        host.querySelector<HTMLElement>('[data-overlay-hit="true"]'),
      ).not.toBeNull();
      expect(el!.getAttribute('data-knob-state')).toBe('inactive');
      expect(el!.style.getPropertyValue('--dmn-knob-bg-default')).toBe(
        DEFAULT_ELEMENT_BG,
      );
      expect(el!.style.getPropertyValue('--dmn-knob-shadow-default')).toBe(
        DEFAULT_ELEMENT_SHADOW,
      );
      expect(el!.style.getPropertyValue('--dmn-knob-radius-default')).toBe(
        '50%',
      );
      // 미지정 테두리는 기본 글래스 립 - 실보더 대신 1px 링 자식과 패딩 예약
      expect(el!.style.getPropertyValue('--dmn-knob-border-default')).toBe(
        'none',
      );
      expect(el!.style.getPropertyValue('--dmn-knob-padding-default')).toBe(
        '1px',
      );
      const knobRing = el!.querySelector<HTMLElement>(
        '[data-gradient-border-ring="true"]',
      );
      expect(knobRing).not.toBeNull();
      expect(
        knobRing!.style.getPropertyValue('--dmn-border-gradient-image-default'),
      ).toBe(gradientToCss(DEFAULT_ELEMENT_BORDER_GRADIENT));
      expect(el!.style.getPropertyValue('--dmn-knob-indicator-default')).toBe(
        DEFAULT_ELEMENT_FONT,
      );
      expect(host.querySelector('[data-knob-indicator="true"]')).not.toBeNull();

      // 축 시그널 델타 → active 전환 + 회전 각 반영 (0.25회전 = 90deg)
      act(() => addAxisDelta('axis-render-test', 0.25));
      expect(el!.getAttribute('data-knob-state')).toBe('active');
      expect(el!.style.getPropertyValue('--dmn-knob-bg-default')).toBe(
        DEFAULT_ELEMENT_ACTIVE_BG,
      );
      expect(el!.style.getPropertyValue('--dmn-knob-shadow-default')).toBe(
        DEFAULT_ELEMENT_ACTIVE_SHADOW,
      );
      expect(el!.style.transform).toContain('rotate(90deg)');
    });
  });

  describe('오버레이 SpriteItem', () => {
    it('래퍼가 히트 마커를, 안쪽 표면이 data 속성을 싣는다', () => {
      act(() => {
        root.render(
          <OverlaySpriteItem
            position={{
              activation: 'whileHeld',
              pressDurationMs: 300,
              rotation: 0,
              id: 'sprite-contract',
              dx: 4,
              dy: 8,
              width: 60,
              height: 60,
              hidden: false,
              zIndex: null,
              layerName: null,
              groupId: null,
              className: null,
              useInlineStyles: null,
              baseImage: 'data:image/png;base64,base',
              pivot: { x: 0.5, y: 0.5 },
              idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
              poses: [
                {
                  imageOverrideMetrics: null,
                  poseId: 'pose-contract',
                  triggers: ['el-contract'],
                  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
                  imageOverride: null,
                },
              ],
              transitionMs: 90,
              transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
              referenceNaturalSize: null,
            }}
            keyCanonicalMap={new Map()}
          />,
        );
      });
      const el = host.querySelector<HTMLElement>(
        '[data-sprite-element="true"]',
      );
      expect(el).not.toBeNull();
      // 클래스는 위치 래퍼, 표식은 안쪽 표면 - 노브·카운터와 같은 배치라
      // 사용자 CSS의 `.클래스 [data-sprite-element]`가 성립한다
      const wrapper = host.querySelector<HTMLElement>(
        '[data-overlay-hit="true"]',
      );
      expect(wrapper).not.toBeNull();
      expect(wrapper!.contains(el)).toBe(true);
      expect(wrapper).not.toBe(el);
      expect(el!.getAttribute('data-sprite-state')).toBe('inactive');
    });
  });

  describe('오버레이 외부 카운터', () => {
    it('실시간 숫자 노드는 별도 히트 영역을 만들지 않는다', () => {
      host.innerHTML = renderToStaticMarkup(
        <OutsideCounter
          position={{
            ...basePosition,
            counter: { enabled: true, placement: 'outside' },
          }}
          count={123456}
          active={false}
        />,
      );

      expect(
        host.querySelector<HTMLElement>('[data-overlay-hit="true"]'),
      ).toBeNull();
    });
  });

  describe('GraphPanel', () => {
    it('data 속성과 그래프 변수를 싣는다', () => {
      host.innerHTML = renderToStaticMarkup(
        <GraphPanel
          history={[1, 2, 3]}
          avg={2}
          maxval={3}
          uid="contract"
          overlayHitRegion
        />,
      );
      const el = host.querySelector<HTMLElement>('[data-graph-element="true"]');
      expect(el).not.toBeNull();
      expect(el!.dataset.overlayHit).toBe('true');
      expect(el!.getAttribute('data-state')).toBe('inactive');
      expect(el!.style.getPropertyValue('--dmn-graph-bg-default')).toBe(
        DEFAULT_ELEMENT_BG,
      );
      // 미지정 테두리는 기본 글래스 립 - 실보더 대신 1px 링 자식과 패딩 예약
      expect(el!.style.getPropertyValue('--dmn-graph-border-default')).toBe(
        'none',
      );
      expect(el!.style.getPropertyValue('--dmn-graph-radius-default')).toBe(
        '4px',
      );
      expect(el!.style.getPropertyValue('--dmn-graph-padding-default')).toBe(
        '1px',
      );
      const graphRing = el!.querySelector<HTMLElement>(
        '[data-gradient-border-ring="true"]',
      );
      expect(graphRing).not.toBeNull();
      expect(
        graphRing!.style.getPropertyValue(
          '--dmn-border-gradient-image-default',
        ),
      ).toBe(gradientToCss(DEFAULT_ELEMENT_BORDER_GRADIENT));
    });

    it('공유 GraphPanel은 요청한 오버레이 렌더에서만 히트 표식을 단다', () => {
      host.innerHTML = renderToStaticMarkup(
        <GraphPanel history={[1, 2, 3]} avg={2} maxval={3} />,
      );

      const el = host.querySelector<HTMLElement>('[data-graph-element="true"]');
      expect(el?.dataset.overlayHit).toBeUndefined();
    });

    it('store가 null로 직렬화한 두께·반경도 미지정으로 읽어 기본 립을 낸다', () => {
      host.innerHTML = renderToStaticMarkup(
        <GraphPanel
          history={[1, 2, 3]}
          avg={2}
          maxval={3}
          uid="contract-null"
          borderWidth={null as unknown as number}
          borderRadius={null as unknown as number}
        />,
      );
      const el = host.querySelector<HTMLElement>('[data-graph-element="true"]');
      expect(el!.style.getPropertyValue('--dmn-graph-padding-default')).toBe(
        '1px',
      );
      expect(el!.style.getPropertyValue('--dmn-graph-radius-default')).toBe(
        '4px',
      );
      expect(
        el!.querySelector('[data-gradient-border-ring="true"]'),
      ).not.toBeNull();
    });

    it('메인 편집 그래프는 2D 이동 승격과 편집 상태를 독립 적용한다', () => {
      host.innerHTML = renderToStaticMarkup(
        <GraphPanel
          history={[1, 2, 3]}
          interactive
          dataEditing
          promoteTransformLayer={false}
        />,
      );
      const editingEl = host.querySelector<HTMLElement>(
        '[data-graph-element="true"]',
      );
      expect(editingEl?.dataset.editing).toBe('true');
      expect(editingEl?.style.transform).toBe(
        'translate(calc(0px + var(--key-offset-x, 0px)), calc(0px + var(--key-offset-y, 0px)))',
      );
      expect(editingEl?.style.willChange).toBe('auto');
      expect(editingEl?.style.backfaceVisibility).toBe('visible');
      expect(editingEl?.style.transformStyle).toBe('flat');
      expect(editingEl?.style.contain).toBe('layout style');

      host.innerHTML = renderToStaticMarkup(
        <GraphPanel
          history={[1, 2, 3]}
          interactive
          dataEditing
          promoteTransformLayer
        />,
      );
      const dragEl = host.querySelector<HTMLElement>(
        '[data-graph-element="true"]',
      );
      expect(dragEl?.dataset.editing).toBe('true');
      expect(dragEl?.style.transform).toContain('translate(');
      expect(dragEl?.style.transform).not.toContain('translate3d(');
      expect(dragEl?.style.willChange).toBe('transform');
      expect(dragEl?.style.backfaceVisibility).toBe('visible');
      expect(dragEl?.style.transformStyle).toBe('flat');
      expect(dragEl?.style.contain).toBe('layout style');
    });
  });
});
