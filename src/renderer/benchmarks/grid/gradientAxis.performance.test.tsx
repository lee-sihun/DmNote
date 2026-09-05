// @vitest-environment jsdom
import React, { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import {
  GRADIENT_BENCHMARK_SPEC,
  GradientAxisBenchmarkSurface,
} from './gradientAxisBenchmark';
import {
  summarizeDistribution,
  waitForAttribute,
} from '../controls/shadowToggleBenchmark';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const benchmarkDescribe =
  process.env.DMN_GRADIENT_AXIS_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/grid-08-gradient-axis-latest.json';
const VARIANT = process.env.DMN_BENCHMARK_VARIANT ?? 'local';
const ITERATIONS = Number(process.env.DMN_BENCHMARK_ITERATIONS ?? 30);
const WARMUP_ITERATIONS = Number(process.env.DMN_BENCHMARK_WARMUP ?? 5);
const ITEM_COUNTS = (process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const BURST_SIZE = Number(process.env.DMN_BENCHMARK_BURST_SIZE ?? 20);
const STRATEGY =
  process.env.DMN_BENCHMARK_STRATEGY === 'legacy' ? 'legacy' : 'frame';

const pointerEvent = (
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 150,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
};

benchmarkDescribe('GRID-08 그라데이션 축 성능', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) =>
      window.clearTimeout(id),
    );
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    useGradientEditStore.getState().setSession(null);
    host.remove();
    vi.unstubAllGlobals();
  });

  it('stop pointermove burst의 event blocking과 DOM commit 분포를 기록한다', async () => {
    const cases = [];
    for (const itemCount of ITEM_COUNTS) {
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <GradientAxisBenchmarkSurface
            strategy={STRATEGY}
            itemCount={itemCount}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });
      const surface = host.querySelector<HTMLElement>(
        '[data-benchmark-gradient-axis="true"]',
      )!;
      const stop = host.querySelector<HTMLElement>('[aria-label="stop 1"]')!;
      const results = [];
      for (
        let iteration = 0;
        iteration < WARMUP_ITERATIONS + ITERATIONS;
        iteration += 1
      ) {
        act(() => stop.dispatchEvent(pointerEvent('pointerdown', 100)));
        const renderStart = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          surface,
          'data-stop-pos',
          String((100 + BURST_SIZE - 200) / 200 + 0.5),
          startedAt,
        );
        let eventFinishedAt = startedAt;
        act(() => {
          for (let index = 0; index < BURST_SIZE; index += 1) {
            window.dispatchEvent(pointerEvent('pointermove', 101 + index));
          }
          eventFinishedAt = performance.now();
        });
        const visualDomCommitMs = await visualCommit;
        act(() =>
          window.dispatchEvent(pointerEvent('pointerup', 100 + BURST_SIZE)),
        );
        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            visualDomCommitMs,
            reactCommitDurationMs: renderDurations
              .slice(renderStart)
              .reduce((sum, duration) => sum + duration, 0),
          });
        }
        act(() => {
          useGradientEditStore
            .getState()
            .patchSession('benchmark:key:0:backgroundColor:idle', {
              spec: GRADIENT_BENCHMARK_SPEC,
            });
        });
      }
      cases.push({
        itemCount,
        burstSize: BURST_SIZE,
        iterations: ITERATIONS,
        warmupIterations: WARMUP_ITERATIONS,
        eventBlockingMs: summarizeDistribution(
          results.map((result) => result.eventBlockingMs),
        ),
        visualDomCommitMs: summarizeDistribution(
          results.map((result) => result.visualDomCommitMs),
        ),
        reactCommitDurationMs: summarizeDistribution(
          results.map((result) => result.reactCommitDurationMs),
        ),
      });
      act(() => root.unmount());
      root = createRoot(host);
    }
    const outputPath = resolve(process.cwd(), OUTPUT_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          benchmarkId: 'GRID-08',
          variant: VARIANT,
          strategy: STRATEGY,
          measuredAt: new Date().toISOString(),
          commit: execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim(),
          runtime: {
            kind: 'vitest-jsdom-gradient-stop-burst-proxy',
            node: process.version,
            platform: process.platform,
            arch: process.arch,
          },
          cases,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  });
});
