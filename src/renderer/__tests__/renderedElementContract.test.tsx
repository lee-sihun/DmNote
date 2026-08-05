// @vitest-environment jsdom
// 렌더 DOM 계약 — data 속성과 --dmn-* fallback 변수가 실제 컴포넌트 루트에 실리는지 고정
// (elementShadowContract 등 기존 계약 테스트는 유틸 반환값·CSS 텍스트만 검증)
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Key } from '@components/shared/Key';
import StatItem from '@components/overlay/counters/StatItem';
import OverlayKnobItem from '@components/overlay/counters/OverlayKnobItem';
import GraphPanel from '@components/shared/GraphPanel';
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
  DEFAULT_ELEMENT_HAIRLINE,
  DEFAULT_ELEMENT_SHADOW,
} from '@utils/core/elementDefaults';
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
      expect(el!.style.getPropertyValue('--dmn-knob-border-default')).toBe(
        'none',
      );
      expect(el!.style.getPropertyValue('--dmn-knob-padding-default')).toBe(
        '0px',
      );
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

  describe('GraphPanel', () => {
    // 앱 빌드는 React Compiler가 history 정규화 결과를 메모하지만 테스트 변환은
    // 컴파일러 없이 실행되어 애니메이션 effect가 매 렌더 재발화 → mount 대신
    // 정적 렌더로 실제 렌더 출력의 DOM 계약만 고정
    it('data 속성과 그래프 변수를 싣는다', () => {
      host.innerHTML = renderToStaticMarkup(
        <GraphPanel history={[1, 2, 3]} avg={2} maxval={3} uid="contract" />,
      );
      const el = host.querySelector<HTMLElement>('[data-graph-element="true"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-state')).toBe('inactive');
      expect(el!.style.getPropertyValue('--dmn-graph-bg-default')).toBe(
        DEFAULT_ELEMENT_BG,
      );
      expect(el!.style.getPropertyValue('--dmn-graph-border-default')).toBe(
        `1px solid ${DEFAULT_ELEMENT_HAIRLINE}`,
      );
      expect(el!.style.getPropertyValue('--dmn-graph-radius-default')).toBe(
        '4px',
      );
      expect(el!.style.getPropertyValue('--dmn-graph-padding-default')).toBe(
        '0px',
      );
    });
  });
});
