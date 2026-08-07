// @vitest-environment jsdom
import React, { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ShadowToggleBenchmarkSurface,
  summarizeDistribution,
  waitForAttribute,
} from './shadowToggleBenchmark';

const benchmarkDescribe =
  process.env.DMN_INTERACTION_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ?? 'benchmarks/results/PILOT-01-latest.json';
const VARIANT = process.env.DMN_BENCHMARK_VARIANT ?? 'local';
const ITERATIONS = Number(process.env.DMN_BENCHMARK_ITERATIONS ?? 30);
const WARMUP_ITERATIONS = Number(process.env.DMN_BENCHMARK_WARMUP ?? 5);
const ELEMENT_COUNTS = (process.env.DMN_BENCHMARK_ELEMENT_COUNTS ?? '1,100,500')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);

interface IterationResult {
  eventBlockingMs: number;
  visualDomCommitMs: number;
  canonicalDomCommitMs: number;
  reactCommitDurationMs: number;
}

benchmarkDescribe('PILOT-01 그림자 토글 성능', () => {
  let host: HTMLDivElement;
  let root: Root;
  let nextFrameId: number;
  let frameTimers: Map<number, number>;

  beforeEach(() => {
    nextFrameId = 0;
    frameTimers = new Map();
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback): number => {
        const id = ++nextFrameId;
        const timer = window.setTimeout(() => {
          frameTimers.delete(id);
          callback(performance.now());
        }, 0);
        frameTimers.set(id, timer);
        return id;
      },
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const timer = frameTimers.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      frameTimers.delete(id);
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    frameTimers.forEach((timer) => window.clearTimeout(timer));
    vi.unstubAllGlobals();
  });

  it('실제 상태 변환·요소 렌더 경로의 DOM commit 분포를 기록한다', async () => {
    expect(OUTPUT_PATH).toBeTruthy();
    expect(ITERATIONS).toBeGreaterThan(0);
    expect(ELEMENT_COUNTS.length).toBeGreaterThan(0);

    const cases = [];

    for (const elementCount of ELEMENT_COUNTS) {
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <ShadowToggleBenchmarkSurface
            elementCount={elementCount}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });

      const results: IterationResult[] = [];
      const totalIterations = WARMUP_ITERATIONS + ITERATIONS;

      for (let iteration = 0; iteration < totalIterations; iteration += 1) {
        const toggle = host.querySelector<HTMLElement>('[role="switch"]');
        const canonicalHost = host.querySelector<HTMLElement>(
          '[data-canonical-enabled]',
        );
        expect(toggle).not.toBeNull();
        expect(canonicalHost).not.toBeNull();

        const expected =
          toggle!.getAttribute('aria-checked') === 'true' ? 'false' : 'true';
        const renderStartIndex = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          toggle!,
          'aria-checked',
          expected,
          startedAt,
        );
        const canonicalCommit = waitForAttribute(
          canonicalHost!,
          'data-canonical-enabled',
          expected,
          startedAt,
        );

        let eventFinishedAt = startedAt;
        let visualDomCommitMs = 0;
        let canonicalDomCommitMs = 0;
        await act(async () => {
          toggle!.click();
          eventFinishedAt = performance.now();
          [visualDomCommitMs, canonicalDomCommitMs] = await Promise.all([
            visualCommit,
            canonicalCommit,
          ]);
        });

        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            visualDomCommitMs,
            canonicalDomCommitMs,
            reactCommitDurationMs: renderDurations
              .slice(renderStartIndex)
              .reduce((sum, duration) => sum + duration, 0),
          });
        }
      }

      cases.push({
        elementCount,
        iterations: ITERATIONS,
        warmupIterations: WARMUP_ITERATIONS,
        eventBlockingMs: summarizeDistribution(
          results.map((result) => result.eventBlockingMs),
        ),
        visualDomCommitMs: summarizeDistribution(
          results.map((result) => result.visualDomCommitMs),
        ),
        canonicalDomCommitMs: summarizeDistribution(
          results.map((result) => result.canonicalDomCommitMs),
        ),
        reactCommitDurationMs: summarizeDistribution(
          results.map((result) => result.reactCommitDurationMs),
        ),
      });

      await act(async () => root.unmount());
      root = createRoot(host);
    }

    const outputPath = resolve(process.cwd(), OUTPUT_PATH!);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          benchmarkId: 'PILOT-01',
          variant: VARIANT,
          measuredAt: new Date().toISOString(),
          commit: execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim(),
          runtime: {
            kind: 'vitest-jsdom-dom-commit-proxy',
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
