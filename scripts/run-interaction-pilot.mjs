import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const elementCount = process.env.DMN_BENCHMARK_ELEMENT_COUNTS ?? '1,100,500';
const iterations = process.env.DMN_BENCHMARK_ITERATIONS ?? '30';
const warmupIterations = process.env.DMN_BENCHMARK_WARMUP ?? '5';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const variants = [
  {
    strategy: 'sync',
    variant: 'sync-baseline',
    output: 'benchmarks/results/pilot-01-baseline.json',
  },
  {
    strategy: 'after-paint',
    variant: 'improved',
    output: 'benchmarks/results/pilot-01-improved.json',
  },
];

for (const entry of variants) {
  const result = spawnSync(npmCommand, ['run', 'benchmark:interaction'], {
    cwd: root,
    env: {
      ...process.env,
      DMN_BENCHMARK_OUTPUT: entry.output,
      DMN_BENCHMARK_VARIANT: entry.variant,
      DMN_BENCHMARK_STRATEGY: entry.strategy,
      DMN_BENCHMARK_ELEMENT_COUNTS: elementCount,
      DMN_BENCHMARK_ITERATIONS: iterations,
      DMN_BENCHMARK_WARMUP: warmupIterations,
    },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const readResult = async (path) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
const baseline = await readResult(variants[0].output);
const improved = await readResult(variants[1].output);
const baselineCase = baseline.cases.at(-1);
const improvedCase = improved.cases.at(-1);

if (!baselineCase || !improvedCase) {
  throw new Error('PILOT-01 benchmark 결과에 비교할 case가 없습니다.');
}
if (baselineCase.elementCount !== improvedCase.elementCount) {
  throw new Error('PILOT-01 baseline과 improved의 요소 수가 다릅니다.');
}

const improvement = (before, after) =>
  before === 0 ? null : ((before - after) / before) * 100;
const formatMs = (value) => value.toFixed(3);
const formatPercent = (value) =>
  value === null
    ? '—'
    : `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(1)}%`;

const visualBefore = baselineCase.visualDomCommitMs.p95;
const visualAfter = improvedCase.visualDomCommitMs.p95;
const canonicalBefore = baselineCase.canonicalDomCommitMs.p95;
const canonicalAfter = improvedCase.canonicalDomCommitMs.p95;
const visualImprovement = improvement(visualBefore, visualAfter);
const canonicalImprovement = improvement(canonicalBefore, canonicalAfter);

const generatedSummary = `<!-- PILOT-01:RESULT:START -->
#### PILOT-01 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | 실제 \`updateKeyStyle\` + 요소 그림자 CSS 렌더의 jsdom DOM commit proxy |
| 요소 수 | ${baselineCase.elementCount}개 |
| 반복 | 기준선 ${baselineCase.iterations}회 / 개선 ${
  improvedCase.iterations
}회, 워밍업 각 ${baselineCase.warmupIterations}회 |
| 측정 코드 커밋 | \`${improved.commit}\` |
| 비교 전략 | \`${baseline.enabledCommitStrategy}\` → \`${
  improved.enabledCommitStrategy
}\` |
| 환경 | ${improved.runtime.platform} ${improved.runtime.arch}, ${
  improved.runtime.node
} |

| P95 지표 | sync 기준선 | after-paint | 개선율 |
| --- | ---: | ---: | ---: |
| 시각 DOM commit | ${formatMs(visualBefore)}ms | ${formatMs(
  visualAfter,
)}ms | ${formatPercent(visualImprovement)} |
| canonical DOM commit | ${formatMs(canonicalBefore)}ms | ${formatMs(
  canonicalAfter,
)}ms | ${formatPercent(canonicalImprovement)} |
| React commit duration | ${formatMs(
  baselineCase.reactCommitDurationMs.p95,
)}ms | ${formatMs(improvedCase.reactCommitDurationMs.p95)}ms | ${formatPercent(
  improvement(
    baselineCase.reactCommitDurationMs.p95,
    improvedCase.reactCommitDurationMs.p95,
  ),
)} |

- 원시 결과: [기준선](../${variants[0].output}) · [개선](../${
  variants[1].output
})
- 실제 WebView click-to-paint 값은 브라우저 또는 Tauri 자동화 표면에서 별도 검증 전까지 기록하지 않는다.
<!-- PILOT-01:RESULT:END -->`;

let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^> 상태: .*$/m,
  '> 상태: PILOT-01 자동 측정·WebView 검증 중',
);
const summaryStart = tracker.indexOf('## 4. 핵심 현황');
const summaryEnd = tracker.indexOf('## 5. 전수 성능 추적표');
if (summaryStart === -1 || summaryEnd === -1) {
  throw new Error('성능 추적표의 핵심 현황 구간을 찾지 못했습니다.');
}
const summary = tracker
  .slice(summaryStart, summaryEnd)
  .replace(/^\| 대기\s+\|.*$/m, '| 대기 | 164개 |')
  .replace(/^\| 실험·검증 중\s+\|.*$/m, '| 실험·검증 중 | 1개 |');
tracker = `${tracker.slice(0, summaryStart)}${summary}${tracker.slice(
  summaryEnd,
)}`;
tracker = tracker.replace(
  /^\| PILOT-01 \|.*$/m,
  `| PILOT-01 | 단일 선택 그림자 사용 토글 | P1 | DOM P95 ms | ${formatMs(
    visualBefore,
  )} | ${formatMs(visualAfter)} | ${formatPercent(
    visualImprovement,
  )} | 검증 | [기준선](../${variants[0].output}) · [개선](../${
    variants[1].output
  }) |`,
);
tracker = tracker.replace(
  /<!-- PILOT-01:RESULT:START -->[\s\S]*?<!-- PILOT-01:RESULT:END -->/,
  generatedSummary,
);

await writeFile(trackerPath, tracker, 'utf8');

const formatResult = spawnSync(
  npxCommand,
  ['prettier', '--write', 'docs/interaction-performance-tracker.md'],
  { cwd: root, stdio: 'inherit' },
);
if (formatResult.status !== 0) process.exit(formatResult.status ?? 1);

console.info(
  `PILOT-01 visual DOM commit P95: ${formatMs(visualBefore)}ms → ${formatMs(
    visualAfter,
  )}ms (${formatPercent(visualImprovement)})`,
);
