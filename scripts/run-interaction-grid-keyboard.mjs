import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const variants = [
  [
    'sync',
    'sync-baseline',
    'benchmarks/results/grid-21-keyboard-baseline.json',
  ],
  ['frame', 'improved', 'benchmarks/results/grid-21-keyboard-improved.json'],
];

for (const [strategy, variant, output] of variants) {
  const result = spawnSync(
    npm,
    ['run', 'benchmark:interaction:grid-keyboard:raw'],
    {
      cwd: root,
      env: {
        ...process.env,
        DMN_BENCHMARK_STRATEGY: strategy,
        DMN_BENCHMARK_VARIANT: variant,
        DMN_BENCHMARK_OUTPUT: output,
        DMN_BENCHMARK_ITEM_COUNTS:
          process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500',
        DMN_BENCHMARK_ITERATIONS: process.env.DMN_BENCHMARK_ITERATIONS ?? '30',
        DMN_BENCHMARK_WARMUP: process.env.DMN_BENCHMARK_WARMUP ?? '5',
        DMN_BENCHMARK_BURST_SIZE: process.env.DMN_BENCHMARK_BURST_SIZE ?? '20',
      },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const read = async (path) => JSON.parse(await readFile(resolve(root, path)));
const baseline = await read(variants[0][2]);
const improved = await read(variants[1][2]);
const before = baseline.cases.at(-1)?.eventBlockingMs.p95;
const after = improved.cases.at(-1)?.eventBlockingMs.p95;
if (typeof before !== 'number' || typeof after !== 'number') {
  throw new Error('GRID-21 측정 case 누락');
}
if (after >= before) {
  throw new Error(
    `GRID-21 event P95 미개선: ${before.toFixed(3)}ms → ${after.toFixed(3)}ms`,
  );
}

const correctness = spawnSync(
  npx,
  ['vitest', 'run', 'src/renderer/hooks/Grid/selection/useGridKeyboard.test.tsx'],
  { cwd: root, stdio: 'inherit' },
);
if (correctness.status !== 0) process.exit(correctness.status ?? 1);
console.info(
  `GRID-21 event P95: ${before.toFixed(3)}ms → ${after.toFixed(3)}ms (${(
    ((before - after) / before) *
    100
  ).toFixed(1)}%)`,
);
const tracking = spawnSync(
  process.execPath,
  ['scripts/update-interaction-continuation-results.mjs'],
  { cwd: root, stdio: 'inherit' },
);
if (tracking.status !== 0) process.exit(tracking.status ?? 1);
