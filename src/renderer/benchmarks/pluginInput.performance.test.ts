// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { summarizeDistribution } from './shadowToggleBenchmark';
import { createPluginHandlerDispatcher } from '@utils/plugin/pluginHandlerDispatcher';

const benchmarkDescribe =
  process.env.DMN_PLUGIN_INPUT_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/plug-02-input-latest.json';
const VARIANT = process.env.DMN_BENCHMARK_VARIANT ?? 'local';
const ITERATIONS = Number(process.env.DMN_BENCHMARK_ITERATIONS ?? 30);
const WARMUP_ITERATIONS = Number(process.env.DMN_BENCHMARK_WARMUP ?? 5);
const ITEM_COUNTS = (process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const BURST_SIZE = Number(process.env.DMN_BENCHMARK_BURST_SIZE ?? 100);
const STRATEGY =
  process.env.DMN_BENCHMARK_STRATEGY === 'sync' ? 'sync' : 'frame';

benchmarkDescribe('PLUG-02 plugin input 성능', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) =>
      window.clearTimeout(id),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('input burst의 event blocking과 handler 완료 분포를 기록한다', async () => {
    const cases = [];
    for (const itemCount of ITEM_COUNTS) {
      const input = document.createElement('input');
      const workload = Array.from({ length: itemCount }, (_, index) => index);
      const dispatcher = createPluginHandlerDispatcher(STRATEGY);
      let completedValue = -1;
      let invocations = 0;
      const handler = () => {
        workload.map((value) => ({ value, selected: value % 2 === 0 }));
        completedValue = Number(input.value);
        invocations += 1;
      };
      const results = [];

      for (
        let iteration = 0;
        iteration < WARMUP_ITERATIONS + ITERATIONS;
        iteration += 1
      ) {
        completedValue = -1;
        invocations = 0;
        const startedAt = performance.now();
        for (let index = 0; index < BURST_SIZE; index += 1) {
          input.value = String(index);
          dispatcher.dispatch(input, handler, new Event('input'));
        }
        const eventFinishedAt = performance.now();
        if (STRATEGY === 'frame') {
          await new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, 0),
          );
        }
        const handlerFinishedAt = performance.now();
        if (completedValue !== BURST_SIZE - 1) {
          throw new Error('plugin input 최신 값 유실');
        }
        if (iteration >= WARMUP_ITERATIONS) {
          results.push({
            eventBlockingMs: eventFinishedAt - startedAt,
            handlerCompleteMs: handlerFinishedAt - startedAt,
            handlerInvocations: invocations,
          });
        }
      }

      dispatcher.cleanup();
      cases.push({
        itemCount,
        burstSize: BURST_SIZE,
        iterations: ITERATIONS,
        warmupIterations: WARMUP_ITERATIONS,
        eventBlockingMs: summarizeDistribution(
          results.map((result) => result.eventBlockingMs),
        ),
        handlerCompleteMs: summarizeDistribution(
          results.map((result) => result.handlerCompleteMs),
        ),
        handlerInvocations: summarizeDistribution(
          results.map((result) => result.handlerInvocations),
        ),
      });
    }

    const outputPath = resolve(process.cwd(), OUTPUT_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          benchmarkId: 'PLUG-02',
          variant: VARIANT,
          strategy: STRATEGY,
          measuredAt: new Date().toISOString(),
          commit: execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim(),
          runtime: {
            kind: 'vitest-jsdom-plugin-input-burst-proxy',
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
