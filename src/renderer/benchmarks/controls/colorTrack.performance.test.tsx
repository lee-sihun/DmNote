// @vitest-environment jsdom
import React, { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { ColorTrackBenchmarkSurface } from './colorTrackBenchmark';
import {
  summarizeDistribution,
  waitForAttribute,
} from './shadowToggleBenchmark';

const benchmarkDescribe =
  process.env.DMN_COLOR_TRACK_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/edit-01-color-track-latest.json';
const VARIANT = process.env.DMN_BENCHMARK_VARIANT ?? 'local';
const ITERATIONS = Number(process.env.DMN_BENCHMARK_ITERATIONS ?? 30);
const WARMUP_ITERATIONS = Number(process.env.DMN_BENCHMARK_WARMUP ?? 5);
const ITEM_COUNTS = (process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const BURST_SIZE = Number(process.env.DMN_BENCHMARK_BURST_SIZE ?? 500);
const STRATEGY =
  process.env.DMN_BENCHMARK_STRATEGY === 'legacy' ? 'legacy' : 'frame';

const pointerEvent = (type: string, clientX: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX,
    clientY: 50,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
  });
  return event;
};

benchmarkDescribe('EDIT-01 색상 트랙 드래그 성능', () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pointermove burst의 event blocking과 DOM commit 분포를 기록한다', async () => {
    const cases = [];
    for (const itemCount of ITEM_COUNTS) {
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <ColorTrackBenchmarkSurface
            strategy={STRATEGY}
            itemCount={itemCount}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });
      const output = host.querySelector<HTMLElement>(
        '[data-benchmark-color-track="true"]',
      )!;
      const track = host.querySelector<HTMLElement>(
        '[aria-label="Saturation and brightness"]',
      )!;
      vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: BURST_SIZE,
        height: 100,
        right: BURST_SIZE,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      Object.defineProperties(track, {
        setPointerCapture: { value: vi.fn(), configurable: true },
        hasPointerCapture: {
          value: vi.fn(() => true),
          configurable: true,
        },
        releasePointerCapture: { value: vi.fn(), configurable: true },
      });
      const results = [];
      for (
        let iteration = 0;
        iteration < WARMUP_ITERATIONS + ITERATIONS;
        iteration += 1
      ) {
        act(() => track.dispatchEvent(pointerEvent('pointerdown', 0)));
        const renderStart = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          output,
          'data-saturation',
          '100',
          startedAt,
        );
        let eventFinishedAt = startedAt;
        act(() => {
          for (let index = 0; index < BURST_SIZE; index += 1) {
            track.dispatchEvent(pointerEvent('pointermove', index + 1));
          }
          eventFinishedAt = performance.now();
        });
        const visualDomCommitMs = await visualCommit;
        act(() => track.dispatchEvent(pointerEvent('pointerup', BURST_SIZE)));
        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            visualDomCommitMs,
            reactCommitDurationMs: renderDurations
              .slice(renderStart)
              .reduce((sum, duration) => sum + duration, 0),
          });
        }
        act(() => track.dispatchEvent(pointerEvent('pointerdown', 0)));
        act(() => track.dispatchEvent(pointerEvent('pointerup', 0)));
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
          benchmarkId: 'EDIT-01',
          variant: VARIANT,
          strategy: STRATEGY,
          measuredAt: new Date().toISOString(),
          commit: execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim(),
          runtime: {
            kind: 'vitest-jsdom-color-track-burst-proxy',
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
