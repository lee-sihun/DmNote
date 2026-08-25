// OVL-01 오버레이 키 카운터 벤치마크 러너
// 사용: node scripts/run-interaction-overlay-counter.mjs [baseline|optimized|<variant>]
// variant별 결과를 benchmarks/results/ovl-01-counter-<variant>.json에 기록하고,
// baseline·optimized가 모두 있으면 비교표를 출력한다.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const variant = process.argv[2] ?? 'local';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const outputFor = (name) => `benchmarks/results/ovl-01-counter-${name}.json`;

const result = spawnSync(
  npmCommand,
  ['run', 'benchmark:interaction:overlay-counter:raw'],
  {
    cwd: root,
    env: {
      ...process.env,
      DMN_BENCHMARK_OUTPUT: outputFor(variant),
      DMN_BENCHMARK_VARIANT: variant,
      DMN_BENCHMARK_ITEM_COUNTS:
        process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '4,8,30',
      DMN_BENCHMARK_ITERATIONS: process.env.DMN_BENCHMARK_ITERATIONS ?? '20',
      DMN_BENCHMARK_WARMUP: process.env.DMN_BENCHMARK_WARMUP ?? '3',
      DMN_BENCHMARK_BURST_SIZE: process.env.DMN_BENCHMARK_BURST_SIZE ?? '40',
    },
    stdio: 'inherit',
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const baselinePath = resolve(root, outputFor('baseline'));
const optimizedPath = resolve(root, outputFor('optimized'));
if (!existsSync(baselinePath) || !existsSync(optimizedPath)) {
  console.log(`OVL-01 ${variant} 기록 완료: ${outputFor(variant)}`);
  process.exit(0);
}

const readResult = async (path) => JSON.parse(await readFile(path, 'utf8'));
const baseline = await readResult(baselinePath);
const optimized = await readResult(optimizedPath);

const caseKey = (entry) => `${entry.keyCount}:${entry.placement}`;
const optimizedByKey = new Map(
  optimized.cases.map((entry) => [caseKey(entry), entry]),
);

const fmt = (value, digits = 3) =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';
const delta = (before, after) =>
  before > 0 ? `${(((after - before) / before) * 100).toFixed(0)}%` : '—';

console.log('\nOVL-01 baseline → optimized');
console.log(
  '| 키 | 배치 | 이벤트 p50 ms | 이벤트 p95 ms | 커밋 p50 ms | 커밋/press | normalize/press | rAF/frame | 프레임 JS p50 ms | animate/press |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const before of baseline.cases) {
  const after = optimizedByKey.get(caseKey(before));
  if (!after) continue;
  const cell = (pick, digits) =>
    `${fmt(pick(before), digits)} → ${fmt(pick(after), digits)} (${delta(
      pick(before),
      pick(after),
    )})`;
  console.log(
    `| ${before.keyCount} | ${before.placement} | ${cell(
      (entry) => entry.eventBlockingMs.p50,
    )} | ${cell((entry) => entry.eventBlockingMs.p95)} | ${cell(
      (entry) => entry.reactCommitDurationMs.p50,
    )} | ${cell((entry) => entry.commitsPerPress, 2)} | ${cell(
      (entry) => entry.normalizeCallsPerPress,
      2,
    )} | ${cell((entry) => entry.rafCallbacksPerFrame, 2)} | ${cell(
      (entry) => entry.frameJsMs.p50,
    )} | ${cell((entry) => entry.animateCallsPerPress, 2)} |`,
  );
}
