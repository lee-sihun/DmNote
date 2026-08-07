// @vitest-environment jsdom
import React, { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import {
  summarizeDistribution,
  waitForAttribute,
} from './shadowToggleBenchmark';
import { GridResizeBenchmarkSurface } from './gridResizeBenchmark';

const benchmarkDescribe =
  process.env.DMN_GRID_RESIZE_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/grid-06-resize-latest.json';
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

benchmarkDescribe('GRID-06 단일 리사이즈 성능', () => {
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
    host.remove();
    vi.unstubAllGlobals();
  });

  it('resize mousemove burst의 event blocking과 DOM commit 분포를 기록한다', async () => {
    const cases = [];
    for (const itemCount of ITEM_COUNTS) {
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <GridResizeBenchmarkSurface
            strategy={STRATEGY}
            itemCount={itemCount}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });
      const surface = host.querySelector<HTMLElement>(
        '[data-benchmark-resize="true"]',
      )!;
      const handle = host.querySelector<HTMLElement>(
        '[data-resize-handle="se"]',
      )!;
      const results = [];
      for (
        let iteration = 0;
        iteration < WARMUP_ITERATIONS + ITERATIONS;
        iteration += 1
      ) {
        act(() =>
          handle.dispatchEvent(
            new MouseEvent('mousedown', {
              clientX: 0,
              clientY: 0,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        const renderStart = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          surface,
          'data-width',
          String(100 + BURST_SIZE),
          startedAt,
        );
        let eventFinishedAt = startedAt;
        act(() => {
          for (let index = 0; index < BURST_SIZE; index += 1) {
            document.dispatchEvent(
              new MouseEvent('mousemove', {
                clientX: index + 1,
                clientY: index + 1,
              }),
            );
          }
          eventFinishedAt = performance.now();
        });
        const visualDomCommitMs = await visualCommit;
        act(() => document.dispatchEvent(new MouseEvent('mouseup')));
        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            visualDomCommitMs,
            reactCommitDurationMs: renderDurations
              .slice(renderStart)
              .reduce((sum, duration) => sum + duration, 0),
          });
        }
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
          benchmarkId: 'GRID-06',
          variant: VARIANT,
          strategy: STRATEGY,
          measuredAt: new Date().toISOString(),
          commit: execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim(),
          runtime: {
            kind: 'vitest-jsdom-resize-burst-proxy',
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
