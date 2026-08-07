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
import { ColorInputBenchmarkSurface } from './colorInputBenchmark';

const benchmarkState = vi.hoisted(() => ({ itemCount: 1 }));

vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: () => (
    <div data-benchmark-color-picker="true">
      {Array.from({ length: benchmarkState.itemCount }, (_, index) => (
        <div
          key={index}
          style={{
            transform: `translate3d(${index % 20}px, ${Math.floor(
              index / 20,
            )}px, 0)`,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.28)',
          }}
        >
          picker-{index}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@hooks/pickers/useGradientColorState', () => ({
  useGradientColorState: () => ({
    pickerColor: '#561ecb',
    headerSlot: null,
    footerSlot: null,
    paletteGradientSpec: null,
    handlePickerColorChange: vi.fn(),
    handleGradientSpecSelect: vi.fn(),
  }),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const benchmarkDescribe =
  process.env.DMN_COLOR_INPUT_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/base-06-color-input-latest.json';
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
  pickerDomCommitMs: number;
  reactCommitDurationMs: number;
}

const waitForPicker = (startedAt: number): Promise<number> => {
  if (document.querySelector('[data-benchmark-color-picker="true"]')) {
    return Promise.resolve(performance.now() - startedAt);
  }
  return new Promise((resolvePromise) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-benchmark-color-picker="true"]')) {
        return;
      }
      observer.disconnect();
      resolvePromise(performance.now() - startedAt);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
};

benchmarkDescribe('BASE-06 ColorInput 성능', () => {
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

  it('스와치 열림 표시와 무거운 피커 mount의 DOM commit 분포를 기록한다', async () => {
    expect(ITERATIONS).toBeGreaterThan(0);
    expect(ITEM_COUNTS.length).toBeGreaterThan(0);
    const cases = [];

    for (const itemCount of ITEM_COUNTS) {
      benchmarkState.itemCount = itemCount;
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <ColorInputBenchmarkSurface
            commitStrategy={COMMIT_STRATEGY}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });
      const button = host.querySelector<HTMLButtonElement>(
        '[aria-haspopup="dialog"]',
      );
      expect(button).not.toBeNull();
      const results: IterationResult[] = [];
      const totalIterations = WARMUP_ITERATIONS + ITERATIONS;

      for (let iteration = 0; iteration < totalIterations; iteration += 1) {
        const renderStartIndex = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          button!,
          'aria-expanded',
          'true',
          startedAt,
        );
        const pickerCommit = waitForPicker(startedAt);
        let eventFinishedAt = startedAt;
        act(() => {
          button!.click();
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
        const pickerDomCommitMs = await pickerCommit;

        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            visualDomCommitMs,
            pickerDomCommitMs,
            reactCommitDurationMs: renderDurations
              .slice(renderStartIndex)
              .reduce((sum, duration) => sum + duration, 0),
          });
        }

        act(() => button!.click());
        expect(
          document.querySelector('[data-benchmark-color-picker="true"]'),
        ).toBeNull();
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
        pickerDomCommitMs: summarizeDistribution(
          results.map((result) => result.pickerDomCommitMs),
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
          benchmarkId: 'BASE-06',
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
