// @vitest-environment jsdom
import React, { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridViewStore } from '@stores/grid/useGridViewStore';
import {
  summarizeDistribution,
  waitForAttribute,
} from './shadowToggleBenchmark';
import { GridContinuousInputBenchmarkSurface } from './gridContinuousInputBenchmark';

const benchmarkDescribe =
  process.env.DMN_GRID_CONTINUOUS_INPUT_BENCHMARK === '1'
    ? describe
    : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/grid-04-continuous-input-latest.json';
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

benchmarkDescribe('GRID-04 연속 입력 성능', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) =>
      window.clearTimeout(id),
    );
    useGridViewStore.setState({
      viewStates: { benchmark: { zoom: 1, panX: 0, panY: 0 } },
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('wheel burst의 event blocking과 DOM commit 분포를 기록한다', async () => {
    const cases = [];
    for (const itemCount of ITEM_COUNTS) {
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <GridContinuousInputBenchmarkSurface
            strategy={STRATEGY}
            itemCount={itemCount}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });
      const container = host.querySelector<HTMLElement>(
        '[data-benchmark-grid-container="true"]',
      )!;
      const results = [];
      for (
        let iteration = 0;
        iteration < WARMUP_ITERATIONS + ITERATIONS;
        iteration += 1
      ) {
        const before = Number(container.dataset.panX);
        const target = before - (STRATEGY === 'legacy' ? 1 : BURST_SIZE);
        const renderStart = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          container,
          'data-pan-x',
          String(target),
          startedAt,
        );
        let eventFinishedAt = startedAt;
        act(() => {
          for (let index = 0; index < BURST_SIZE; index += 1) {
            container.dispatchEvent(
              new WheelEvent('wheel', {
                deltaX: 1,
                deltaY: 0,
                cancelable: true,
              }),
            );
          }
          eventFinishedAt = performance.now();
        });
        const visualDomCommitMs = await visualCommit;
        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            visualDomCommitMs,
            reactCommitDurationMs: renderDurations
              .slice(renderStart)
              .reduce((sum, duration) => sum + duration, 0),
          });
        }
        await act(async () => {
          await new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, 0),
          );
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
      useGridViewStore.setState({
        viewStates: { benchmark: { zoom: 1, panX: 0, panY: 0 } },
      });
    }

    const outputPath = resolve(process.cwd(), OUTPUT_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          benchmarkId: 'GRID-04',
          variant: VARIANT,
          strategy: STRATEGY,
          measuredAt: new Date().toISOString(),
          commit: execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim(),
          runtime: {
            kind: 'vitest-jsdom-wheel-burst-proxy',
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
