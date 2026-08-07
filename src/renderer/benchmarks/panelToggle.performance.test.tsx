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
import { PanelToggleBenchmarkSurface } from './panelToggleBenchmark';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const benchmarkDescribe =
  process.env.DMN_PANEL_TOGGLE_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/base-11-panel-toggle-latest.json';
const VARIANT = process.env.DMN_BENCHMARK_VARIANT ?? 'local';
const ITERATIONS = Number(process.env.DMN_BENCHMARK_ITERATIONS ?? 30);
const WARMUP_ITERATIONS = Number(process.env.DMN_BENCHMARK_WARMUP ?? 5);
const ITEM_COUNTS = (process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const COMMIT_STRATEGY =
  process.env.DMN_BENCHMARK_STRATEGY === 'sync' ? 'sync' : 'after-paint';

const waitForPanelContent = (startedAt: number): Promise<number> => {
  if (document.querySelector('[data-benchmark-panel-content="true"]')) {
    return Promise.resolve(performance.now() - startedAt);
  }
  return new Promise((resolvePromise) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-benchmark-panel-content="true"]')) {
        return;
      }
      observer.disconnect();
      resolvePromise(performance.now() - startedAt);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
};

benchmarkDescribe('BASE-11 패널 토글 성능', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) =>
      window.clearTimeout(id),
    );
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
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

  it('버튼 상태와 무거운 패널 mount 분포를 기록한다', async () => {
    const cases = [];
    for (const itemCount of ITEM_COUNTS) {
      const renderDurations: number[] = [];
      await act(async () => {
        root.render(
          <PanelToggleBenchmarkSurface
            commitStrategy={COMMIT_STRATEGY}
            itemCount={itemCount}
            onRender={(duration) => renderDurations.push(duration)}
          />,
        );
      });
      const button = host.querySelector<HTMLButtonElement>(
        'button[aria-expanded]',
      );
      expect(button).not.toBeNull();
      const results = [];

      for (
        let iteration = 0;
        iteration < WARMUP_ITERATIONS + ITERATIONS;
        iteration += 1
      ) {
        const renderStart = renderDurations.length;
        const startedAt = performance.now();
        const visualCommit = waitForAttribute(
          button!,
          'aria-expanded',
          'true',
          startedAt,
        );
        const contentCommit = waitForPanelContent(startedAt);
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
        const contentDomCommitMs = await contentCommit;

        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            visualDomCommitMs,
            contentDomCommitMs,
            reactCommitDurationMs: renderDurations
              .slice(renderStart)
              .reduce((sum, duration) => sum + duration, 0),
          });
        }

        await act(async () => {
          button!.click();
          await new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, 0),
          );
          await new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, 0),
          );
        });
        expect(
          document.querySelector('[data-benchmark-panel-content="true"]'),
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
        contentDomCommitMs: summarizeDistribution(
          results.map((result) => result.contentDomCommitMs),
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
          benchmarkId: 'BASE-11',
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
