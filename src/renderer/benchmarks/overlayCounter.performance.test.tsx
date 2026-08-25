// @vitest-environment jsdom
// OVL-01 오버레이 키 카운터 핫패스 벤치마크
// 측정: press당 이벤트 차단·React 커밋·커밋 수·zod 정규화 호출, 프레임당 rAF 콜백·JS 시간,
// count 변경당 Element.animate 호출. jsdom이라 페인트/합성 비용은 포함되지 않으며
// React Compiler도 적용되지 않는다(vitest 설정에 plugin-react 없음).
import React, { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { summarizeDistribution } from './shadowToggleBenchmark';
import {
  createAnimateStub,
  createBenchmarkLayout,
  createFrameDriver,
  OverlayCounterBenchmarkSurface,
  type CounterPlacementScenario,
} from './overlayCounterBenchmark';
import { setKeyActive } from '@stores/signals/keySignals';
import { setKeyCounter } from '@stores/signals/keyCounterSignals';

const counters = vi.hoisted(() => ({ normalizeCalls: 0 }));

// 정규화 호출 수 집계 — 원본 구현을 그대로 감싼다
vi.mock('@src/types/key/keys', async (importOriginal) => {
  const original = await importOriginal<typeof import('@src/types/key/keys')>();
  return {
    ...original,
    normalizeCounterSettings: (raw: unknown) => {
      counters.normalizeCalls += 1;
      return original.normalizeCounterSettings(raw);
    },
  };
});

const benchmarkDescribe =
  process.env.DMN_OVERLAY_COUNTER_BENCHMARK === '1' ? describe : describe.skip;
const OUTPUT_PATH =
  process.env.DMN_BENCHMARK_OUTPUT ??
  'benchmarks/results/ovl-01-counter-latest.json';
const VARIANT = process.env.DMN_BENCHMARK_VARIANT ?? 'local';
const ITERATIONS = Number(process.env.DMN_BENCHMARK_ITERATIONS ?? 20);
const WARMUP_ITERATIONS = Number(process.env.DMN_BENCHMARK_WARMUP ?? 3);
const KEY_COUNTS = (process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '4,8,30')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const BURST_SIZE = Number(process.env.DMN_BENCHMARK_BURST_SIZE ?? 40);
const DRAIN_FRAME_LIMIT = 40;
const PLACEMENTS: CounterPlacementScenario[] = ['off', 'inside', 'outside'];

interface PressSample {
  eventBlockingMs: number;
  reactCommitDurationMs: number;
  commits: number;
  normalizeCalls: number;
  animateCalls: number;
}

interface FrameSample {
  callbacks: number;
  jsMs: number;
}

const mean = (values: number[]): number =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

benchmarkDescribe('OVL-01 오버레이 키 카운터 핫패스', () => {
  let host: HTMLDivElement;
  let root: Root;
  const frames = createFrameDriver();
  const animate = createAnimateStub();

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    frames.install();
    animate.install();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    // 패치된 performance.now·rAF 스텁이 워커에 남지 않도록 실패 시에도 복원
    try {
      act(() => root.unmount());
      host.remove();
    } finally {
      frames.restore();
      animate.restore();
      globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it('press 버스트의 이벤트·커밋·프레임 작업량 분포를 기록한다', async () => {
    expect(Number.isInteger(ITERATIONS) && ITERATIONS > 0).toBe(true);
    expect(Number.isInteger(WARMUP_ITERATIONS) && WARMUP_ITERATIONS >= 0).toBe(
      true,
    );
    expect(Number.isInteger(BURST_SIZE) && BURST_SIZE > 0).toBe(true);
    expect(KEY_COUNTS.length).toBeGreaterThan(0);
    const cases = [];

    for (const keyCount of KEY_COUNTS) {
      for (const placement of PLACEMENTS) {
        const layout = createBenchmarkLayout(keyCount, placement);
        const counterEnabled = placement !== 'off';
        const mode = `bench-${placement}-${keyCount}`;
        const renderDurations: number[] = [];

        act(() => {
          root.render(
            <OverlayCounterBenchmarkSurface
              layout={layout}
              mode={mode}
              counterEnabled={counterEnabled}
              onRender={(duration) => renderDurations.push(duration)}
            />,
          );
        });
        const mountedCountDisplays =
          host.querySelectorAll('span.counter').length;

        const pressSamples: PressSample[] = [];
        const frameSamples: FrameSample[] = [];
        let pressCounter = 0;

        for (
          let iteration = 0;
          iteration < WARMUP_ITERATIONS + ITERATIONS;
          iteration += 1
        ) {
          const record = iteration >= WARMUP_ITERATIONS;

          for (let burst = 0; burst < BURST_SIZE; burst += 1) {
            const key = layout.keys[burst % layout.keys.length];
            pressCounter += 1;
            const count = pressCounter;
            const renderStartIndex = renderDurations.length;
            const normalizeBefore = counters.normalizeCalls;
            const animateBefore = animate.calls();

            // 실제 IPC와 같이 DOWN·counter·UP이 각각 별도 task로 도착
            const startedAt = performance.now();
            act(() => setKeyActive(key, true));
            if (counterEnabled) act(() => setKeyCounter(mode, key, count));
            act(() => setKeyActive(key, false));
            const eventBlockingMs = performance.now() - startedAt;

            if (record) {
              const commitDurations = renderDurations.slice(renderStartIndex);
              pressSamples.push({
                eventBlockingMs,
                reactCommitDurationMs: commitDurations.reduce(
                  (sum, duration) => sum + duration,
                  0,
                ),
                commits: commitDurations.length,
                normalizeCalls: counters.normalizeCalls - normalizeBefore,
                animateCalls: animate.calls() - animateBefore,
              });
            }

            // press 사이에 한 프레임 — 연타 중 애니메이션이 겹치는 상황 재현
            const frame = frames.runFrame();
            if (record) frameSamples.push(frame);
          }

          // 버스트 종료 후 남은 애니메이션 프레임 배출
          for (
            let drain = 0;
            drain < DRAIN_FRAME_LIMIT && frames.pending() > 0;
            drain += 1
          ) {
            const frame = frames.runFrame();
            if (record) frameSamples.push(frame);
          }
        }

        cases.push({
          keyCount,
          placement,
          counterEnabled,
          burstSize: BURST_SIZE,
          iterations: ITERATIONS,
          warmupIterations: WARMUP_ITERATIONS,
          mountedCountDisplays,
          eventBlockingMs: summarizeDistribution(
            pressSamples.map((sample) => sample.eventBlockingMs),
          ),
          reactCommitDurationMs: summarizeDistribution(
            pressSamples.map((sample) => sample.reactCommitDurationMs),
          ),
          commitsPerPress: mean(pressSamples.map((sample) => sample.commits)),
          normalizeCallsPerPress: mean(
            pressSamples.map((sample) => sample.normalizeCalls),
          ),
          animateCallsPerPress: mean(
            pressSamples.map((sample) => sample.animateCalls),
          ),
          rafCallbacksPerFrame: mean(
            frameSamples.map((sample) => sample.callbacks),
          ),
          frameJsMs: summarizeDistribution(
            frameSamples.map((sample) => sample.jsMs),
          ),
          framesPerBurst: frameSamples.length / ITERATIONS,
        });

        act(() => root.unmount());
        root = createRoot(host);
        animate.reset();
      }
    }

    // 어떤 코드 상태에서 측정했는지 기록 — dirty 파일 목록으로 런타임/하네스 차이를 구분
    const git = (...args: string[]): string =>
      execFileSync('git', args, {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
    const gitHead = git('rev-parse', '--short', 'HEAD').trim();
    // porcelain 첫 열은 공백일 수 있어 전체 trim 금지 — 줄 단위로 상태 열 3자만 제거
    const gitDirtyFiles = git('status', '--porcelain', '--untracked-files=no')
      .split('\n')
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3));

    const outputPath = resolve(process.cwd(), OUTPUT_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          benchmarkId: 'OVL-01',
          variant: VARIANT,
          measuredAt: new Date().toISOString(),
          node: process.version,
          environment: 'jsdom',
          gitHead,
          gitDirtyFiles,
          notes: [
            '페인트·합성 비용 미포함 (jsdom)',
            'React Compiler 미적용 (vitest에 plugin-react 없음)',
            'Element.animate는 no-op 스텁 — animateCallsPerPress는 호출 수, WAAPI 분기의 프레임 비용은 0으로 나오며 측정값이 아님',
            'rafCallbacksPerFrame·frameJsMs는 rAF 경로(baseline)에서만 실제 작업량을 뜻함',
            '모든 키가 같은 counter 객체를 공유 — identity 캐시 최선 케이스. 프로덕션 identity 안정성은 별도 확인 필요',
          ],
          cases,
        },
        null,
        2,
      )}\n`,
    );
  });
});
