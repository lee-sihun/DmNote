import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const elementCounts = process.env.DMN_BENCHMARK_ELEMENT_COUNTS ?? '1,100,500';
const iterations = process.env.DMN_BENCHMARK_ITERATIONS ?? '30';
const warmupIterations = process.env.DMN_BENCHMARK_WARMUP ?? '5';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const variants = [
  {
    strategy: 'sync',
    variant: 'sync-baseline',
    output: 'benchmarks/results/pilot-02-baseline.json',
  },
  {
    strategy: 'after-paint',
    variant: 'improved',
    output: 'benchmarks/results/pilot-02-improved.json',
  },
];

for (const entry of variants) {
  const result = spawnSync(npmCommand, ['run', 'benchmark:interaction'], {
    cwd: root,
    env: {
      ...process.env,
      DMN_BENCHMARK_ID: 'PILOT-02',
      DMN_BENCHMARK_SELECTION_MODE: 'batch',
      DMN_BENCHMARK_OUTPUT: entry.output,
      DMN_BENCHMARK_VARIANT: entry.variant,
      DMN_BENCHMARK_STRATEGY: entry.strategy,
      DMN_BENCHMARK_ELEMENT_COUNTS: elementCounts,
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
  throw new Error('PILOT-02 benchmark 결과에 비교할 case가 없습니다.');
}
if (baselineCase.elementCount !== improvedCase.elementCount) {
  throw new Error('PILOT-02 baseline과 improved의 요소 수가 다릅니다.');
}
if (baseline.selectionMode !== 'batch' || improved.selectionMode !== 'batch') {
  throw new Error(
    'PILOT-02 benchmark가 batch 선택 경로를 사용하지 않았습니다.',
  );
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

if (visualImprovement === null || visualImprovement <= 0) {
  throw new Error(
    `PILOT-02 시각 DOM commit P95가 개선되지 않았습니다: ${formatMs(
      visualBefore,
    )}ms → ${formatMs(visualAfter)}ms`,
  );
}

const correctnessResult = spawnSync(
  npmCommand,
  ['run', 'test:interaction:pilot'],
  { cwd: root, stdio: 'inherit' },
);
if (correctnessResult.status !== 0) {
  process.exit(correctnessResult.status ?? 1);
}

const measuredDate = improved.measuredAt.slice(0, 10);
const runtimeLabel = `${improved.runtime.kind}, ${improved.runtime.platform} ${improved.runtime.arch}, ${improved.runtime.node}`;
const summary = `<!-- PILOT-02:RESULT:START -->
#### PILOT-02 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | 전체 선택 요소 shadow 쌍 배치 변환 + 요소 그림자 CSS 렌더의 jsdom DOM commit proxy |
| 선택·렌더 요소 수 | ${baselineCase.elementCount}개 |
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
- 정확성 게이트: \`npm run test:interaction:pilot\` 통과
- 공통 \`ShadowControls\`의 시각 우선 반영이 배치 canonical 변환 비용과 분리되는지 검증한다.
<!-- PILOT-02:RESULT:END -->`;

const sessionRow = (id, stage, result, resultCase, output) =>
  `| ${id} | ${measuredDate} | PILOT-02 | ${stage} | \`${result.commit.slice(
    0,
    8,
  )}\` | ${runtimeLabel} | 다중 선택·렌더 요소 ${resultCase.elementCount}개 | ${
    resultCase.iterations
  } | ${formatMs(resultCase.visualDomCommitMs.p50)} | ${formatMs(
    resultCase.visualDomCommitMs.p95,
  )} | ${formatMs(resultCase.visualDomCommitMs.max)} | canonical P95 ${formatMs(
    resultCase.canonicalDomCommitMs.p95,
  )}ms·React P95 ${formatMs(
    resultCase.reactCommitDurationMs.p95,
  )}ms | [JSON](../${output}) | batch DOM commit proxy |`;

const sessions = `<!-- PILOT-02:SESSIONS:START -->
| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${sessionRow(
  'PILOT-02-SYNC',
  '기준선',
  baseline,
  baselineCase,
  variants[0].output,
)}
${sessionRow(
  'PILOT-02-PAINT',
  '개선',
  improved,
  improvedCase,
  variants[1].output,
)}
<!-- PILOT-02:SESSIONS:END -->`;

const experiment = `<!-- PILOT-02:EXPERIMENT:START -->
### EXP-002: 다중 선택 그림자 사용 토글 시각 반응 검증

| 필드 | 내용 |
| --- | --- |
| 항목 ID | PILOT-02 |
| 가설 | 공통 컨트롤의 로컬 checked 반영은 전체 선택 요소의 배치 변환보다 먼저 표시된다. |
| 변경 내용 | PILOT-01에서 적용한 공통 \`ShadowControls\` 계약을 다중 선택 경로에서 재사용한다. |
| 적용 기법 | 낙관적 상태 투영·메인 스레드 양보·입력 병합 |
| 커밋·PR | \`${improved.commit.slice(0, 8)}\` |
| 기준선 세션 | PILOT-02-SYNC |
| 개선 후 세션 | PILOT-02-PAINT |
| P95 변화 | ${formatMs(visualBefore)}ms → ${formatMs(
  visualAfter,
)}ms (${formatPercent(visualImprovement)}) |
| canonical P95 변화 | ${formatMs(canonicalBefore)}ms → ${formatMs(
  canonicalAfter,
)}ms (${formatPercent(canonicalImprovement)}) |
| 정확성 검증 | 요소별 그림자 값 보존·통계 activeShadow 차단·연타 마지막 의도 보존 테스트 통과 |
| 플랫폼 검증 | jsdom batch proxy 완료·실제 WebView 대기 |
| 결론 | 공통 최적화가 다중 선택에도 유효하며 WebView 실측 전까지 검증 상태로 유지 |
| 후속 작업 | 공통 Checkbox 확대 전 BASE-01 사용처별 상태 소유권 분류 |
<!-- PILOT-02:EXPERIMENT:END -->`;

let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^> 상태: .*$/m,
  '> 상태: 그림자 토글 파일럿 자동 측정·WebView 검증 중',
);
tracker = tracker.replace(
  /^\| PILOT-02 \|.*$/m,
  `| PILOT-02 | 다중 선택 그림자 사용 토글 | P1 | DOM P95 ms | ${formatMs(
    visualBefore,
  )} | ${formatMs(visualAfter)} | ${formatPercent(
    visualImprovement,
  )} | 검증 | [기준선](../${variants[0].output}) · [개선](../${
    variants[1].output
  }) |`,
);

const summaryStart = tracker.indexOf('## 4. 핵심 현황');
const trackingStart = tracker.indexOf('## 5. 전수 성능 추적표');
const trackingEnd = tracker.indexOf('## 6. 측정 세션');
if (summaryStart === -1 || trackingStart === -1 || trackingEnd === -1) {
  throw new Error('성능 추적표의 핵심 현황·전수 추적 구간을 찾지 못했습니다.');
}
const trackingRows = tracker.slice(trackingStart, trackingEnd);
const pendingCount = (trackingRows.match(/\| 대기 \|/g) ?? []).length;
const validatingCount = (trackingRows.match(/\| 검증 \|/g) ?? []).length;
const currentSummary = tracker
  .slice(summaryStart, trackingStart)
  .replace(/^\| 대기\s+\|.*$/m, `| 대기 | ${pendingCount}개 |`)
  .replace(
    /^\| 실험·검증 중\s+\|.*$/m,
    `| 실험·검증 중 | ${validatingCount}개 |`,
  );
tracker = `${tracker.slice(0, summaryStart)}${currentSummary}${tracker.slice(
  trackingStart,
)}`;
tracker = tracker
  .replace(
    /<!-- PILOT-02:RESULT:START -->[\s\S]*?<!-- PILOT-02:RESULT:END -->/,
    summary,
  )
  .replace(
    /<!-- PILOT-02:SESSIONS:START -->[\s\S]*?<!-- PILOT-02:SESSIONS:END -->/,
    sessions,
  )
  .replace(
    /<!-- PILOT-02:EXPERIMENT:START -->[\s\S]*?<!-- PILOT-02:EXPERIMENT:END -->/,
    experiment,
  );

await writeFile(trackerPath, tracker, 'utf8');
const formatResult = spawnSync(
  npxCommand,
  ['prettier', '--write', 'docs/interaction-performance-tracker.md'],
  { cwd: root, stdio: 'inherit' },
);
if (formatResult.status !== 0) process.exit(formatResult.status ?? 1);

console.info(
  `PILOT-02 visual DOM commit P95: ${formatMs(visualBefore)}ms → ${formatMs(
    visualAfter,
  )}ms (${formatPercent(visualImprovement)})`,
);
