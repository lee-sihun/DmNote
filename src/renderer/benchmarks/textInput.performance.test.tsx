// @vitest-environment jsdom
import React, { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  summarizeDistribution,
  waitForAttribute,
} from './shadowToggleBenchmark';
import { TextInputBenchmarkSurface } from './textInputBenchmark';

const benchmarkDescribe =
  process.env.DMN_TEXT_INPUT_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/base-05-text-input-latest.json';
const VARIANT = process.env.DMN_BENCHMARK_VARIANT ?? 'local';
const ITERATIONS = Number(process.env.DMN_BENCHMARK_ITERATIONS ?? 30);
const WARMUP_ITERATIONS = Number(process.env.DMN_BENCHMARK_WARMUP ?? 5);
const ITEM_COUNTS = (process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const COMMIT_STRATEGY =
  process.env.DMN_BENCHMARK_STRATEGY === 'sync' ? 'sync' : 'after-paint';

interface IterationResult {
  eventBlockingMs: number;
  visualDomCommitMs: number;
  canonicalDomCommitMs: number;
  reactCommitDurationMs: number;
}

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

benchmarkDescribe('BASE-05 TextInput 성능', () => {
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

  it('로컬 input echo와 무거운 부모 콘텐츠 교체의 DOM commit 분포를 기록한다', async () => {
    expect(ITERATIONS).toBeGreaterThan(0);
    expect(ITEM_COUNTS.length).toBeGreaterThan(0);
    const cases = [];

    for (const itemCount of ITEM_COUNTS) {
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <TextInputBenchmarkSurface
            itemCount={itemCount}
            commitStrategy={COMMIT_STRATEGY}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });
      const input = host.querySelector<HTMLInputElement>('input');
      expect(input).not.toBeNull();
      act(() => input!.focus());

      const results: IterationResult[] = [];
      const totalIterations = WARMUP_ITERATIONS + ITERATIONS;
      for (let iteration = 0; iteration < totalIterations; iteration += 1) {
        const canonicalHost = host.querySelector<HTMLElement>(
          '[data-canonical-value]',
        );
        expect(canonicalHost).not.toBeNull();
        const current = canonicalHost!.getAttribute('data-canonical-value');
        const expected = current === 'a' ? 'b' : 'a';
        const renderStartIndex = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          input!,
          'value',
          expected,
          startedAt,
        );
        const canonicalCommit = waitForAttribute(
          canonicalHost!,
          'data-canonical-value',
          expected,
          startedAt,
        );

        let eventFinishedAt = startedAt;
        act(() => {
          setInputValue(input!, expected);
          eventFinishedAt = performance.now();
        });
        const visualDomCommitMs = await visualCommit;
        if (COMMIT_STRATEGY === 'after-paint') {
          await act(async () => {
            await new Promise((resolvePromise) =>
              window.setTimeout(resolvePromise, 0),
            );
            await new Promise((resolvePromise) =>
              window.setTimeout(resolvePromise, 0),
            );
          });
        }
        const canonicalDomCommitMs = await canonicalCommit;

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
        itemCount,
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
          benchmarkId: 'BASE-05',
          variant: VARIANT,
          commitStrategy: COMMIT_STRATEGY,
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
