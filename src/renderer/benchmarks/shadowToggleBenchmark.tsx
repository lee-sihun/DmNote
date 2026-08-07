/* eslint-disable react-refresh/only-export-components */
import React, { Profiler, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import ShadowControls from '@components/main/Grid/PropertiesPanel/ShadowControls';
import { updateKeyStyle } from '@src/renderer/editor/model/keys';
import type { KeyPosition, KeyPositions } from '@src/types/key/keys';
import {
  elementShadowToCss,
  type ElementShadowSpec,
} from '@src/types/key/shadows';

export interface Distribution {
  p50: number;
  p95: number;
  max: number;
}

export interface ShadowToggleBrowserBenchmarkResult {
  benchmark: 'PILOT-01-shadow-toggle' | 'PILOT-02-batch-shadow-toggle';
  kind: 'browser-render-path';
  selectionMode: 'single' | 'batch';
  enabledCommitStrategy: 'after-paint' | 'sync';
  iterations: number;
  warmupIterations: number;
  elementCount: number;
  eventBlockingMs: Distribution;
  visualDomCommitMs: Distribution;
  canonicalDomCommitMs: Distribution;
  clickToPaintOpportunityMs: Distribution;
  reactCommitDurationMs: Distribution;
  userAgent: string;
  measuredAt: string;
}

export const DISABLED_IDLE_SHADOW: ElementShadowSpec = {
  enabled: false,
  color: 'rgba(0, 0, 0, 0.28)',
  offsetX: 0,
  offsetY: 4,
  blur: 10,
};

export const DISABLED_ACTIVE_SHADOW: ElementShadowSpec = {
  enabled: false,
  color: 'rgba(0, 0, 0, 0.32)',
  offsetX: 0,
  offsetY: 3,
  blur: 8,
};

const createPosition = (index: number): KeyPosition =>
  ({
    dx: index % 20,
    dy: Math.floor(index / 20),
    width: 60,
    height: 60,
    count: 0,
    shadow: { ...DISABLED_IDLE_SHADOW },
    activeShadow: { ...DISABLED_ACTIVE_SHADOW },
  } as KeyPosition);

export const createBenchmarkPositions = (
  elementCount: number,
): KeyPositions => ({
  benchmark: Array.from({ length: elementCount }, (_, index) =>
    createPosition(index),
  ),
});

export const summarizeDistribution = (samples: number[]): Distribution => {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (ratio: number) => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * ratio) - 1),
    );
    return sorted[index] ?? 0;
  };
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  };
};

export const waitForAttribute = (
  element: Element,
  name: string,
  expected: string,
  startedAt: number,
): Promise<number> => {
  if (element.getAttribute(name) === expected) {
    return Promise.resolve(performance.now() - startedAt);
  }
  return new Promise((resolvePromise) => {
    const observer = new MutationObserver(() => {
      if (element.getAttribute(name) !== expected) return;
      observer.disconnect();
      resolvePromise(performance.now() - startedAt);
    });
    observer.observe(element, { attributes: true, attributeFilter: [name] });
  });
};

const nextFrame = (): Promise<void> =>
  new Promise((resolvePromise) =>
    requestAnimationFrame(() => resolvePromise()),
  );

export const afterPaintOpportunity = async (): Promise<void> => {
  await nextFrame();
  await nextFrame();
};

interface ShadowToggleBenchmarkSurfaceProps {
  elementCount: number;
  enabledCommitStrategy?: 'after-paint' | 'sync';
  selectionMode?: 'single' | 'batch';
  onRender?: (durationMs: number) => void;
}

export const ShadowToggleBenchmarkSurface = ({
  elementCount,
  enabledCommitStrategy = 'after-paint',
  selectionMode = 'single',
  onRender = () => undefined,
}: ShadowToggleBenchmarkSurfaceProps) => {
  const [positions, setPositions] = useState<KeyPositions>(() =>
    createBenchmarkPositions(elementCount),
  );
  const selected = positions.benchmark[0];
  const idleShadow = selected.shadow ?? DISABLED_IDLE_SHADOW;
  const activeShadow = selected.activeShadow ?? DISABLED_ACTIVE_SHADOW;
  const canonicalEnabled = idleShadow.enabled || activeShadow.enabled;

  const handleEnabledChange = (enabled: boolean) => {
    setPositions((current) => {
      if (selectionMode === 'single') {
        return updateKeyStyle(current, 'benchmark', 0, {
          shadow: { ...idleShadow, enabled },
          activeShadow: { ...activeShadow, enabled },
        });
      }
      return {
        ...current,
        benchmark: current.benchmark.map((position) => ({
          ...position,
          shadow: {
            ...(position.shadow ?? DISABLED_IDLE_SHADOW),
            enabled,
          },
          activeShadow: {
            ...(position.activeShadow ?? DISABLED_ACTIVE_SHADOW),
            enabled,
          },
        })),
      };
    });
  };

  return (
    <Profiler
      id="shadow-toggle-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-canonical-enabled={canonicalEnabled ? 'true' : 'false'}>
        <ShadowControls
          idleShadow={idleShadow}
          activeShadow={activeShadow}
          onChange={() => undefined}
          onEnabledChange={handleEnabledChange}
          enabledCommitStrategy={enabledCommitStrategy}
          t={(key) => key.split('.').at(-1)}
        />
        <div aria-hidden="true">
          {positions.benchmark.map((position, index) => (
            <div
              key={index}
              style={{
                boxShadow: elementShadowToCss(
                  position.shadow ?? DISABLED_IDLE_SHADOW,
                ),
                width: position.width,
                height: position.height,
              }}
            />
          ))}
        </div>
      </div>
    </Profiler>
  );
};

const BenchmarkApp = () => {
  const query = new URLSearchParams(window.location.search);
  const iterations = Math.max(5, Number(query.get('iterations')) || 40);
  const warmupIterations = Math.max(1, Number(query.get('warmup')) || 5);
  const elementCount = Math.max(1, Number(query.get('elements')) || 100);
  const enabledCommitStrategy =
    query.get('strategy') === 'sync' ? 'sync' : 'after-paint';
  const selectionMode = query.get('selection') === 'batch' ? 'batch' : 'single';
  const renderDurationsRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const eventBlockingSamples: number[] = [];
      const visualDomCommitSamples: number[] = [];
      const canonicalDomCommitSamples: number[] = [];
      const clickToPaintOpportunitySamples: number[] = [];
      const reactCommitDurationSamples: number[] = [];
      const totalIterations = warmupIterations + iterations;

      for (let index = 0; index < totalIterations; index += 1) {
        if (cancelled) return;
        await afterPaintOpportunity();
        const toggle = document.querySelector<HTMLElement>('[role="switch"]');
        const canonicalHost = document.querySelector<HTMLElement>(
          '[data-canonical-enabled]',
        );
        if (!toggle || !canonicalHost) {
          throw new Error('그림자 benchmark 표면을 찾지 못했습니다.');
        }

        const expected =
          toggle.getAttribute('aria-checked') === 'true' ? 'false' : 'true';
        const renderStartIndex = renderDurationsRef.current.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          toggle,
          'aria-checked',
          expected,
          startedAt,
        );
        const canonicalCommit = waitForAttribute(
          canonicalHost,
          'data-canonical-enabled',
          expected,
          startedAt,
        );
        toggle.click();
        const eventFinishedAt = performance.now();
        const paintOpportunity = afterPaintOpportunity().then(
          () => performance.now() - startedAt,
        );
        const visualDomCommitMs = await visualCommit;
        const canonicalDomCommitMs = await canonicalCommit;
        const clickToPaintOpportunityMs = await paintOpportunity;

        if (index >= warmupIterations) {
          eventBlockingSamples.push(eventFinishedAt - startedAt);
          visualDomCommitSamples.push(visualDomCommitMs);
          canonicalDomCommitSamples.push(canonicalDomCommitMs);
          clickToPaintOpportunitySamples.push(clickToPaintOpportunityMs);
          reactCommitDurationSamples.push(
            renderDurationsRef.current
              .slice(renderStartIndex)
              .reduce((sum, duration) => sum + duration, 0),
          );
        }
      }

      const result: ShadowToggleBrowserBenchmarkResult = {
        benchmark:
          selectionMode === 'batch'
            ? 'PILOT-02-batch-shadow-toggle'
            : 'PILOT-01-shadow-toggle',
        kind: 'browser-render-path',
        selectionMode,
        enabledCommitStrategy,
        iterations,
        warmupIterations,
        elementCount,
        eventBlockingMs: summarizeDistribution(eventBlockingSamples),
        visualDomCommitMs: summarizeDistribution(visualDomCommitSamples),
        canonicalDomCommitMs: summarizeDistribution(canonicalDomCommitSamples),
        clickToPaintOpportunityMs: summarizeDistribution(
          clickToPaintOpportunitySamples,
        ),
        reactCommitDurationMs: summarizeDistribution(
          reactCommitDurationSamples,
        ),
        userAgent: navigator.userAgent,
        measuredAt: new Date().toISOString(),
      };

      const resultElement = document.getElementById('benchmark-results');
      if (!resultElement) return;
      resultElement.dataset.status = 'complete';
      resultElement.textContent = JSON.stringify(result, null, 2);
      document.title = [
        selectionMode === 'batch' ? 'PILOT-02' : 'PILOT-01',
        selectionMode,
        enabledCommitStrategy,
        `event=${result.eventBlockingMs.p95.toFixed(3)}`,
        `visual=${result.visualDomCommitMs.p95.toFixed(3)}`,
        `canonical=${result.canonicalDomCommitMs.p95.toFixed(3)}`,
        `paint=${result.clickToPaintOpportunityMs.p95.toFixed(3)}`,
        `react=${result.reactCommitDurationMs.p95.toFixed(3)}`,
      ].join('|');

      const reportUrl = query.get('report');
      if (reportUrl) {
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
          return;
        }
        if (control.complete) {
          document.title = `DMN-WEBVIEW-BENCHMARK|COMPLETE|${result.userAgent}`;
        }
      }
    };

    void run().catch((error) => {
      const resultElement = document.getElementById('benchmark-results');
      if (!resultElement) return;
      resultElement.dataset.status = 'error';
      resultElement.textContent = String(error);
    });

    return () => {
      cancelled = true;
    };
  }, [
    elementCount,
    enabledCommitStrategy,
    iterations,
    selectionMode,
    warmupIterations,
  ]);

  return (
    <main className="min-h-screen bg-app text-fg p-[24px]">
      <div className="w-[320px] rounded-panel bg-panel p-[12px]">
        <ShadowToggleBenchmarkSurface
          elementCount={elementCount}
          enabledCommitStrategy={enabledCommitStrategy}
          selectionMode={selectionMode}
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
  );
};

export const mountShadowToggleBenchmark = (): void => {
  const container = document.getElementById('root');
  if (!container) throw new Error('Root container not found');
  createRoot(container).render(<BenchmarkApp />);
};
