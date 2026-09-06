/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

import { I18nContext } from '@contexts/I18nContextDef';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useGridViewStore } from '@stores/grid/useGridViewStore';
import { ColorInputBenchmarkSurface } from './controls/colorInputBenchmark';
import { ColorTrackBenchmarkSurface } from './controls/colorTrackBenchmark';
import { DropdownBenchmarkSurface } from './controls/dropdownBenchmark';
import { FloatingPopupBenchmarkSurface } from './controls/floatingPopupBenchmark';
import {
  GRADIENT_BENCHMARK_SPEC,
  GradientAxisBenchmarkSurface,
} from './grid/gradientAxisBenchmark';
import { GridContinuousInputBenchmarkSurface } from './grid/gridContinuousInputBenchmark';
import { GridKeyboardBenchmarkSurface } from './grid/gridKeyboardBenchmark';
import { GridMarqueeBenchmarkSurface } from './grid/gridMarqueeBenchmark';
import { GridMinimapBenchmarkSurface } from './grid/gridMinimapBenchmark';
import { GridResizeBenchmarkSurface } from './grid/gridResizeBenchmark';
import { ModalBenchmarkSurface } from './controls/modalBenchmark';
import { NumberInputBenchmarkSurface } from './controls/numberInputBenchmark';
import { PanelToggleBenchmarkSurface } from './panelToggleBenchmark';
import {
  afterPaintOpportunity,
  summarizeDistribution,
  type Distribution,
} from './controls/shadowToggleBenchmark';
import { TabSwitchBenchmarkSurface } from './controls/tabSwitchBenchmark';
import { TextInputBenchmarkSurface } from './controls/textInputBenchmark';

type ScenarioId =
  | 'BASE-03'
  | 'BASE-04'
  | 'BASE-05'
  | 'BASE-06'
  | 'BASE-07'
  | 'BASE-08'
  | 'BASE-09'
  | 'BASE-11'
  | 'EDIT-01'
  | 'GRID-05'
  | 'GRID-06'
  | 'GRID-08'
  | 'GRID-09'
  | 'GRID-11'
  | 'GRID-21';

type Strategy = 'sync' | 'after-paint' | 'legacy' | 'frame';

interface IterationMeasurement {
  eventBlockingMs: number;
  visualDomCommitMs: number;
  completionDomCommitMs: number;
  clickToPaintOpportunityMs: number;
  reactCommitDurationMs: number;
}

export interface WebViewInteractionBenchmarkResult {
  benchmark: ScenarioId;
  kind: 'browser-render-path';
  interactionKind: 'discrete' | 'continuous';
  strategy: Strategy;
  iterations: number;
  warmupIterations: number;
  itemCount: number;
  burstSize: number | null;
  frameDriver: 'native' | 'timer-0ms';
  round: number;
  eventBlockingMs: Distribution;
  visualDomCommitMs: Distribution;
  completionDomCommitMs: Distribution;
  clickToPaintOpportunityMs: Distribution;
  reactCommitDurationMs: Distribution;
  userAgent: string;
  measuredAt: string;
  samples: IterationMeasurement[];
}

const DISCRETE_SCENARIOS = new Set<ScenarioId>([
  'BASE-03',
  'BASE-04',
  'BASE-05',
  'BASE-06',
  'BASE-07',
  'BASE-08',
  'BASE-09',
  'BASE-11',
]);

const requireElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`benchmark 요소 없음: ${selector}`);
  return element;
};

const waitForCondition = (
  condition: () => boolean,
  startedAt: number,
): Promise<number> => {
  if (condition()) return Promise.resolve(performance.now() - startedAt);
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      rejectPromise(new Error('benchmark DOM commit 10초 timeout'));
    }, 10_000);
    const observer = new MutationObserver(() => {
      if (!condition()) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolvePromise(performance.now() - startedAt);
    });
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
};

const waitForAttribute = (
  element: Element,
  name: string,
  expected: string,
  startedAt: number,
): Promise<number> =>
  waitForCondition(() => element.getAttribute(name) === expected, startedAt);

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pointerEvent = (
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
): PointerEvent => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    pointerType: { value: 'mouse' },
  });
  return event as PointerEvent;
};

const sumRenders = (durations: number[], from: number): number =>
  durations.slice(from).reduce((sum, duration) => sum + duration, 0);

interface MeasureActionOptions {
  renderDurations: number[];
  visual: (startedAt: number) => Promise<number>;
  completion?: (startedAt: number) => Promise<number>;
  action: () => void;
  cleanup?: () => void | Promise<void>;
}

const measureAction = async ({
  renderDurations,
  visual,
  completion = visual,
  action,
  cleanup,
}: MeasureActionOptions): Promise<IterationMeasurement> => {
  const renderStart = renderDurations.length;
  const startedAt = performance.now();
  const visualCommit = visual(startedAt);
  const completionCommit = completion(startedAt);
  action();
  const eventFinishedAt = performance.now();
  const paintOpportunity = afterPaintOpportunity().then(
    () => performance.now() - startedAt,
  );
  const visualDomCommitMs = await visualCommit;
  const completionDomCommitMs = await completionCommit;
  const clickToPaintOpportunityMs = await paintOpportunity;
  await cleanup?.();
  return {
    eventBlockingMs: eventFinishedAt - startedAt,
    visualDomCommitMs,
    completionDomCommitMs,
    clickToPaintOpportunityMs,
    reactCommitDurationMs: sumRenders(renderDurations, renderStart),
  };
};

const runDiscreteIteration = async (
  scenario: ScenarioId,
  renderDurations: number[],
): Promise<IterationMeasurement> => {
  if (scenario === 'BASE-07') {
    const host = requireElement<HTMLElement>('[data-canonical-tab]');
    const expected =
      host.dataset.canonicalTab === 'summary' ? 'details' : 'summary';
    const target = requireElement<HTMLElement>(`[data-tab-id="${expected}"]`);
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(target, 'aria-pressed', 'true', startedAt),
      completion: (startedAt) =>
        waitForAttribute(host, 'data-canonical-tab', expected, startedAt),
      action: () => target.click(),
    });
  }

  if (scenario === 'BASE-03') {
    const trigger = requireElement<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    );
    trigger.click();
    await waitForCondition(
      () => document.querySelector('[role="option"]') !== null,
      performance.now(),
    );
    const host = requireElement<HTMLElement>('[data-canonical-value]');
    const expected =
      host.dataset.canonicalValue === 'summary' ? 'details' : 'summary';
    const label = expected === 'summary' ? '요약' : '상세';
    const target = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes(label));
    if (!target) throw new Error(`Dropdown option 없음: ${label}`);
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(trigger, 'aria-expanded', 'false', startedAt),
      completion: (startedAt) =>
        waitForAttribute(host, 'data-canonical-value', expected, startedAt),
      action: () => target.click(),
    });
  }

  if (scenario === 'BASE-04' || scenario === 'BASE-05') {
    const input = requireElement<HTMLInputElement>('input');
    input.focus();
    const host = requireElement<HTMLElement>('[data-canonical-value]');
    const current = host.dataset.canonicalValue;
    const expected =
      scenario === 'BASE-04'
        ? current === '1'
          ? '2'
          : '1'
        : current === 'a'
        ? 'b'
        : 'a';
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(input, 'value', expected, startedAt),
      completion: (startedAt) =>
        waitForAttribute(host, 'data-canonical-value', expected, startedAt),
      action: () => setInputValue(input, expected),
    });
  }

  if (scenario === 'BASE-06') {
    const button = requireElement<HTMLButtonElement>(
      '[aria-haspopup="dialog"]',
    );
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(button, 'aria-expanded', 'true', startedAt),
      completion: (startedAt) =>
        waitForCondition(
          () => document.querySelector('[role="dialog"]') !== null,
          startedAt,
        ),
      action: () => button.click(),
      cleanup: async () => {
        button.click();
        await waitForCondition(
          () => document.querySelector('[role="dialog"]') === null,
          performance.now(),
        );
      },
    });
  }

  const selector =
    scenario === 'BASE-08'
      ? '[data-benchmark-popup-content="true"]'
      : scenario === 'BASE-09'
      ? '[data-benchmark-modal-content="true"]'
      : '[data-benchmark-panel-content="true"]';
  const opener = requireElement<HTMLButtonElement>('button[aria-expanded]');
  return measureAction({
    renderDurations,
    visual: (startedAt) =>
      waitForAttribute(opener, 'aria-expanded', 'true', startedAt),
    completion: (startedAt) =>
      waitForCondition(
        () => document.querySelector(selector) !== null,
        startedAt,
      ),
    action: () => opener.click(),
    cleanup: async () => {
      opener.click();
      await waitForCondition(
        () => document.querySelector(selector) === null,
        performance.now(),
      );
    },
  });
};

const mouseEvent = (
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number,
  button = 0,
): MouseEvent =>
  new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    buttons: type === 'mouseup' ? 0 : button === 1 ? 4 : 1,
    clientX,
    clientY,
  });

const runContinuousIteration = async (
  scenario: ScenarioId,
  burstSize: number,
  renderDurations: number[],
): Promise<IterationMeasurement> => {
  if (scenario === 'GRID-05') {
    const surface = requireElement<HTMLElement>(
      '[data-benchmark-grid-container="true"]',
    );
    const target = Number(surface.dataset.panX) + burstSize;
    surface.dispatchEvent(mouseEvent('mousedown', 0, 0, 1));
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(surface, 'data-pan-x', String(target), startedAt),
      action: () => {
        for (let index = 0; index < burstSize; index += 1) {
          document.dispatchEvent(mouseEvent('mousemove', index + 1, 0));
        }
      },
      cleanup: () => {
        document.dispatchEvent(mouseEvent('mouseup', 0, 0));
      },
    });
  }

  if (scenario === 'GRID-09') {
    const surface = requireElement<HTMLElement>(
      '[data-benchmark-marquee="true"]',
    );
    useGridSelectionStore.getState().startMarqueeSelection(0, 0);
    // 실제 브라우저에서는 store 구독 렌더 뒤 document listener가 effect에서 연결됨
    await afterPaintOpportunity();
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(surface, 'data-end-x', String(burstSize), startedAt),
      action: () => {
        for (let index = 0; index < burstSize; index += 1) {
          document.dispatchEvent(mouseEvent('mousemove', index + 1, index + 1));
        }
      },
      cleanup: () => {
        document.dispatchEvent(mouseEvent('mouseup', 0, 0));
      },
    });
  }

  if (scenario === 'GRID-06') {
    const surface = requireElement<HTMLElement>(
      '[data-benchmark-resize="true"]',
    );
    const handle = requireElement<HTMLElement>('[data-resize-handle="se"]');
    handle.dispatchEvent(mouseEvent('mousedown', 0, 0));
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(
          surface,
          'data-width',
          String(100 + burstSize),
          startedAt,
        ),
      action: () => {
        for (let index = 0; index < burstSize; index += 1) {
          document.dispatchEvent(mouseEvent('mousemove', index + 1, index + 1));
        }
      },
      cleanup: () => {
        document.dispatchEvent(mouseEvent('mouseup', 0, 0));
      },
    });
  }

  if (scenario === 'GRID-08') {
    const surface = requireElement<HTMLElement>(
      '[data-benchmark-gradient-axis="true"]',
    );
    const stop = requireElement<HTMLElement>('[aria-label="stop 1"]');
    const stopRect = stop.getBoundingClientRect();
    const startX = stopRect.left + stopRect.width / 2;
    const startY = stopRect.top + stopRect.height / 2;
    stop.dispatchEvent(pointerEvent('pointerdown', startX, startY));
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForCondition(
          () => Number(surface.getAttribute('data-stop-pos')) > 0,
          startedAt,
        ),
      action: () => {
        for (let index = 0; index < burstSize; index += 1) {
          window.dispatchEvent(
            pointerEvent('pointermove', startX + index + 1, startY),
          );
        }
      },
      cleanup: async () => {
        window.dispatchEvent(
          pointerEvent('pointerup', startX + burstSize, startY),
        );
        useGradientEditStore
          .getState()
          .patchSession('benchmark:key:0:backgroundColor:idle', {
            spec: GRADIENT_BENCHMARK_SPEC,
          });
        await afterPaintOpportunity();
      },
    });
  }

  if (scenario === 'GRID-11') {
    const output = requireElement<HTMLElement>(
      '[data-benchmark-grid-minimap="true"]',
    );
    const surface = requireElement<HTMLElement>(
      '[data-grid-minimap-surface="true"]',
    );
    surface.dispatchEvent(mouseEvent('mousedown', 20, 20));
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForCondition(
          () => Number(output.getAttribute('data-pan-x')) !== 0,
          startedAt,
        ),
      action: () => {
        for (let index = 0; index < burstSize; index += 1) {
          document.dispatchEvent(
            mouseEvent('mousemove', 21 + index, 21 + index),
          );
        }
      },
      cleanup: async () => {
        document.dispatchEvent(mouseEvent('mouseup', 0, 0));
        useGridViewStore.getState().setPan('benchmark', 0, 0);
        await afterPaintOpportunity();
      },
    });
  }

  if (scenario === 'EDIT-01') {
    const output = requireElement<HTMLElement>(
      '[data-benchmark-color-track="true"]',
    );
    const track = requireElement<HTMLElement>(
      '[aria-label="Saturation and brightness"]',
    );
    const rect = track.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    track.dispatchEvent(pointerEvent('pointerdown', rect.left, y));
    return measureAction({
      renderDurations,
      visual: (startedAt) =>
        waitForAttribute(output, 'data-saturation', '100', startedAt),
      action: () => {
        for (let index = 0; index < burstSize; index += 1) {
          const ratio = (index + 1) / burstSize;
          track.dispatchEvent(
            pointerEvent('pointermove', rect.left + rect.width * ratio, y),
          );
        }
      },
      cleanup: async () => {
        track.dispatchEvent(pointerEvent('pointerup', rect.right, y));
        track.dispatchEvent(pointerEvent('pointerdown', rect.left, y));
        track.dispatchEvent(pointerEvent('pointerup', rect.left, y));
        await afterPaintOpportunity();
      },
    });
  }

  const surface = requireElement<HTMLElement>(
    '[data-benchmark-grid-keyboard="true"]',
  );
  const target = Number(surface.dataset.offset) + burstSize;
  return measureAction({
    renderDurations,
    visual: (startedAt) =>
      waitForAttribute(surface, 'data-offset', String(target), startedAt),
    action: () => {
      for (let index = 0; index < burstSize; index += 1) {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            code: 'ArrowRight',
            repeat: index > 0,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    cleanup: () => {
      window.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'ArrowRight',
          code: 'ArrowRight',
          bubbles: true,
        }),
      );
    },
  });
};

interface BenchmarkSurfaceProps {
  scenario: ScenarioId;
  strategy: Strategy;
  itemCount: number;
  onRender: (durationMs: number) => void;
}

const BenchmarkSurface = ({
  scenario,
  strategy,
  itemCount,
  onRender,
}: BenchmarkSurfaceProps) => {
  const commitStrategy = strategy === 'sync' ? 'sync' : 'after-paint';
  const frameStrategy = strategy === 'legacy' ? 'legacy' : 'frame';

  switch (scenario) {
    case 'BASE-03':
      return (
        <DropdownBenchmarkSurface
          itemCount={itemCount}
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'BASE-04':
      return (
        <NumberInputBenchmarkSurface
          itemCount={itemCount}
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'BASE-05':
      return (
        <TextInputBenchmarkSurface
          itemCount={itemCount}
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'BASE-06':
      return (
        <ColorInputBenchmarkSurface
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'BASE-07':
      return (
        <TabSwitchBenchmarkSurface
          itemCount={itemCount}
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'BASE-08':
      return (
        <FloatingPopupBenchmarkSurface
          itemCount={itemCount}
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'BASE-09':
      return (
        <ModalBenchmarkSurface
          itemCount={itemCount}
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'BASE-11':
      return (
        <PanelToggleBenchmarkSurface
          itemCount={itemCount}
          commitStrategy={commitStrategy}
          onRender={onRender}
        />
      );
    case 'GRID-05':
      return (
        <GridContinuousInputBenchmarkSurface
          strategy={frameStrategy}
          itemCount={itemCount}
          onRender={onRender}
        />
      );
    case 'GRID-06':
      return (
        <GridResizeBenchmarkSurface
          strategy={frameStrategy}
          itemCount={itemCount}
          onRender={onRender}
        />
      );
    case 'GRID-08':
      return (
        <GradientAxisBenchmarkSurface
          strategy={frameStrategy}
          itemCount={itemCount}
          onRender={onRender}
        />
      );
    case 'GRID-09':
      return (
        <GridMarqueeBenchmarkSurface
          strategy={frameStrategy}
          itemCount={itemCount}
          onRender={onRender}
        />
      );
    case 'GRID-11':
      return (
        <GridMinimapBenchmarkSurface
          strategy={frameStrategy}
          itemCount={itemCount}
          onRender={onRender}
        />
      );
    case 'EDIT-01':
      return (
        <ColorTrackBenchmarkSurface
          strategy={frameStrategy}
          itemCount={itemCount}
          onRender={onRender}
        />
      );
    case 'GRID-21':
      return (
        <GridKeyboardBenchmarkSurface
          strategy={strategy === 'sync' ? 'sync' : 'frame'}
          itemCount={itemCount}
          onRender={onRender}
        />
      );
  }
};

const BenchmarkApp = () => {
  const query = new URLSearchParams(window.location.search);
  const scenario = (query.get('scenario') ?? 'BASE-07') as ScenarioId;
  const strategy = (query.get('strategy') ?? 'after-paint') as Strategy;
  const iterations = Math.max(1, Number(query.get('iterations')) || 20);
  const warmupIterations = Math.max(1, Number(query.get('warmup')) || 3);
  const itemCount = Math.max(1, Number(query.get('items')) || 500);
  const burstSize = Math.max(2, Number(query.get('burst')) || 100);
  const round = Math.max(1, Number(query.get('round')) || 1);
  const frameDriver =
    query.get('frameDriver') === 'timer' ? 'timer-0ms' : 'native';
  const reportUrl = query.get('report');
  const renderDurationsRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const reportProgress = async (progress: string) => {
      if (!reportUrl) return;
      await fetch(reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ benchmark: scenario, strategy, progress }),
      });
    };
    const run = async () => {
      await reportProgress('started');
      if (!DISCRETE_SCENARIOS.has(scenario)) {
        await afterPaintOpportunity();
      }
      const samples: IterationMeasurement[] = [];
      const totalIterations = warmupIterations + iterations;
      for (let index = 0; index < totalIterations; index += 1) {
        if (cancelled) return;
        await afterPaintOpportunity();
        const measurement = DISCRETE_SCENARIOS.has(scenario)
          ? await runDiscreteIteration(scenario, renderDurationsRef.current)
          : await runContinuousIteration(
              scenario,
              burstSize,
              renderDurationsRef.current,
            );
        if (index >= warmupIterations) samples.push(measurement);
      }

      const distribution = (key: keyof IterationMeasurement) =>
        summarizeDistribution(samples.map((sample) => sample[key]));
      const result: WebViewInteractionBenchmarkResult = {
        benchmark: scenario,
        kind: 'browser-render-path',
        interactionKind: DISCRETE_SCENARIOS.has(scenario)
          ? 'discrete'
          : 'continuous',
        strategy,
        iterations,
        warmupIterations,
        itemCount,
        burstSize: DISCRETE_SCENARIOS.has(scenario) ? null : burstSize,
        frameDriver,
        round,
        eventBlockingMs: distribution('eventBlockingMs'),
        visualDomCommitMs: distribution('visualDomCommitMs'),
        completionDomCommitMs: distribution('completionDomCommitMs'),
        clickToPaintOpportunityMs: distribution('clickToPaintOpportunityMs'),
        reactCommitDurationMs: distribution('reactCommitDurationMs'),
        userAgent: navigator.userAgent,
        measuredAt: new Date().toISOString(),
        samples,
      };

      const resultElement = requireElement<HTMLElement>('#benchmark-results');
      resultElement.dataset.status = 'complete';
      resultElement.textContent = JSON.stringify(result, null, 2);
      document.title = `${scenario}|${strategy}|event=${result.eventBlockingMs.p95.toFixed(
        3,
      )}|visual=${result.visualDomCommitMs.p95.toFixed(3)}`;

      if (!reportUrl) return;
      const response = await fetch(reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(result),
      });
      if (!response.ok) {
        throw new Error(`benchmark report 실패: ${response.status}`);
      }
      const control = (await response.json()) as {
        complete?: boolean;
        nextSearch?: string;
      };
      if (control.nextSearch) {
        window.location.search = control.nextSearch;
      } else if (control.complete) {
        document.title = `DMN-WEBVIEW-MATRIX|COMPLETE|${result.userAgent}`;
      }
    };

    void run().catch((error) => {
      const resultElement = document.getElementById('benchmark-results');
      if (!resultElement) return;
      resultElement.dataset.status = 'error';
      resultElement.textContent = String(error);
      document.title = `DMN-WEBVIEW-MATRIX|ERROR|${String(error)}`;
      if (reportUrl) {
        void fetch(reportUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({
            benchmark: scenario,
            strategy,
            error: String(error),
          }),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    burstSize,
    frameDriver,
    itemCount,
    iterations,
    reportUrl,
    round,
    scenario,
    strategy,
    warmupIterations,
  ]);

  return (
    <I18nContext.Provider
      value={{ locale: 'ko', setLocale: () => undefined, t: (key) => key }}
    >
      <main className="relative min-h-screen bg-app p-[24px] text-fg">
        <div className="relative min-h-[360px] w-full max-w-[640px] rounded-panel bg-panel p-[12px]">
          <BenchmarkSurface
            scenario={scenario}
            strategy={strategy}
            itemCount={itemCount}
            onRender={(duration) => renderDurationsRef.current.push(duration)}
          />
        </div>
        <pre
          id="benchmark-results"
          data-status="running"
          className="mt-[20px] whitespace-pre-wrap text-body text-fg-muted"
        >
          측정 중
        </pre>
      </main>
    </I18nContext.Provider>
  );
};

export const prepareWebViewInteractionBenchmark = (): void => {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  if (scenario === 'GRID-05' || scenario === 'GRID-11') {
    useGridViewStore.setState({
      viewStates: { benchmark: { zoom: 1, panX: 0, panY: 0 } },
    });
  }
  if (scenario === 'GRID-09') {
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
      isMarqueeSelecting: false,
      marqueeStart: null,
      marqueeEnd: null,
    });
  }
};

export const mountWebViewInteractionBenchmark = (): void => {
  const query = new URLSearchParams(window.location.search);
  if (query.get('frameDriver') === 'timer') {
    let nextFrameId = 0;
    const frameTimers = new Map<number, number>();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      const timer = window.setTimeout(() => {
        frameTimers.delete(id);
        callback(performance.now());
      }, 0);
      frameTimers.set(id, timer);
      return id;
    };
    window.cancelAnimationFrame = (id: number) => {
      const timer = frameTimers.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      frameTimers.delete(id);
    };
  }
  prepareWebViewInteractionBenchmark();
  const container = document.getElementById('root');
  if (!container) throw new Error('Root container not found');
  createRoot(container).render(<BenchmarkApp />);
};
