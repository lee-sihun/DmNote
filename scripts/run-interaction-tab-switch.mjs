import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const itemCounts = process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500';
const iterations = process.env.DMN_BENCHMARK_ITERATIONS ?? '30';
const warmupIterations = process.env.DMN_BENCHMARK_WARMUP ?? '5';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const variants = [
  {
    strategy: 'sync',
    variant: 'sync-baseline',
    output: 'benchmarks/results/base-07-tab-switch-baseline.json',
  },
  {
    strategy: 'after-paint',
    variant: 'improved',
    output: 'benchmarks/results/base-07-tab-switch-improved.json',
  },
];

for (const entry of variants) {
  const result = spawnSync(
    npmCommand,
    ['run', 'benchmark:interaction:tab-switch:raw'],
    {
      cwd: root,
      env: {
        ...process.env,
        DMN_BENCHMARK_OUTPUT: entry.output,
        DMN_BENCHMARK_VARIANT: entry.variant,
        DMN_BENCHMARK_STRATEGY: entry.strategy,
        DMN_BENCHMARK_ITEM_COUNTS: itemCounts,
        DMN_BENCHMARK_ITERATIONS: iterations,
        DMN_BENCHMARK_WARMUP: warmupIterations,
      },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const readResult = async (path) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
const baseline = await readResult(variants[0].output);
const improved = await readResult(variants[1].output);
const baselineCase = baseline.cases.at(-1);
const improvedCase = improved.cases.at(-1);

if (!baselineCase || !improvedCase) {
  throw new Error('BASE-07 benchmark 결과에 비교할 case가 없습니다.');
}
if (baselineCase.itemCount !== improvedCase.itemCount) {
  throw new Error('BASE-07 baseline과 improved의 항목 수가 다릅니다.');
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
const measuredDate = improved.measuredAt.slice(0, 10);
const runtimeLabel = `${improved.runtime.kind}, ${improved.runtime.platform} ${improved.runtime.arch}, ${improved.runtime.node}`;

if (visualImprovement === null || visualImprovement <= 0) {
  throw new Error(
    `BASE-07 시각 DOM commit P95가 개선되지 않았습니다: ${formatMs(
      visualBefore,
    )}ms → ${formatMs(visualAfter)}ms`,
  );
}

const correctnessResult = spawnSync(
  npxCommand,
  ['vitest', 'run', 'src/renderer/components/main/common/TabSwitch.test.tsx'],
  { cwd: root, stdio: 'inherit' },
);
if (correctnessResult.status !== 0) {
  process.exit(correctnessResult.status ?? 1);
}

const resultBlock = `<!-- BASE-07:RESULT:START -->
#### BASE-07 TabSwitch 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | 공통 TabSwitch + 탭 콘텐츠 DOM ${
  baselineCase.itemCount
}개 교체 proxy |
| 반복 | 기준선 ${baselineCase.iterations}회 / 개선 ${
  improvedCase.iterations
}회, 워밍업 각 ${baselineCase.warmupIterations}회 |
| 측정 코드 커밋 | \`${improved.commit}\` |
| 비교 전략 | \`${baseline.commitStrategy}\` → \`${improved.commitStrategy}\` |
| 환경 | ${improved.runtime.platform} ${improved.runtime.arch}, ${
  improved.runtime.node
} |

| P95 지표 | sync 기준선 | after-paint | 개선율 |
| --- | ---: | ---: | ---: |
| 활성 탭 DOM commit | ${formatMs(visualBefore)}ms | ${formatMs(
  visualAfter,
)}ms | ${formatPercent(visualImprovement)} |
| canonical 콘텐츠 commit | ${formatMs(canonicalBefore)}ms | ${formatMs(
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
- 정확성 게이트: \`TabSwitch.test.tsx\` 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-07:RESULT:END -->`;

const sessionRow = (id, stage, result, resultCase, output) =>
  `| ${id} | ${measuredDate} | BASE-07 | ${stage} | \`${result.commit.slice(
    0,
    8,
  )}\` | ${runtimeLabel} | 탭 콘텐츠 ${resultCase.itemCount}개 | ${
    resultCase.iterations
  } | ${formatMs(resultCase.visualDomCommitMs.p50)} | ${formatMs(
    resultCase.visualDomCommitMs.p95,
  )} | ${formatMs(resultCase.visualDomCommitMs.max)} | canonical P95 ${formatMs(
    resultCase.canonicalDomCommitMs.p95,
  )}ms·React P95 ${formatMs(
    resultCase.reactCommitDurationMs.p95,
  )}ms | [JSON](../${output}) | DOM commit proxy |`;
const sessionsBlock = `<!-- BASE-07:SESSIONS:START -->
| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${sessionRow(
  'BASE-07-SYNC',
  '기준선',
  baseline,
  baselineCase,
  variants[0].output,
)}
${sessionRow(
  'BASE-07-PAINT',
  '개선',
  improved,
  improvedCase,
  variants[1].output,
)}
<!-- BASE-07:SESSIONS:END -->`;

const experimentBlock = `<!-- BASE-07:EXPERIMENT:START -->
### EXP-009: 공통 TabSwitch 시각 우선 전환

| 필드 | 내용 |
| --- | --- |
| 항목 ID | BASE-07 |
| 적용 범위 | 키 슬롯, 색상 상태·형식, 이미지 상태, 통합 키 설정, 노트 설정의 6개 탭 전환 |
| 변경 내용 | 활성 인디케이터와 \`aria-pressed\`를 먼저 반영하고 탭 콘텐츠 상태 변경을 첫 paint 뒤 커밋 |
| 적용 기법 | 낙관적 상태 투영·메인 스레드 양보·연속 탭 선택 병합 |
| 커밋·PR | \`${improved.commit.slice(0, 8)}\` |
| P95 변화 | ${formatMs(visualBefore)}ms → ${formatMs(
  visualAfter,
)}ms (${formatPercent(visualImprovement)}) |
| 정확성 검증 | sync 호환·시각 선반영·마지막 탭 병합·언마운트 선택 보존 테스트 통과 |
| 결론 | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지 |
<!-- BASE-07:EXPERIMENT:END -->`;

let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^\| BASE-07\s+\|.*$/m,
  `| BASE-07 | TabSwitch | P3 | DOM P95 ms | ${formatMs(
    visualBefore,
  )} | ${formatMs(visualAfter)} | ${formatPercent(
    visualImprovement,
  )} | 검증 | [기준선](../${variants[0].output}) · [개선](../${
    variants[1].output
  }) |`,
);

const partialRows = [
  [
    'PROP-03',
    '색상 입력',
    'P0',
    'F95 ms/frame',
    '실험',
    '`ad22c019`, 상태 탭 전환만 적용',
  ],
  [
    'PROP-04',
    '그라데이션 입력',
    'P0',
    'F95 ms/frame',
    '실험',
    '`ad22c019`, 형식 탭 전환만 적용',
  ],
  [
    'PROP-07',
    '키 매핑·실입력 캡처',
    'P1/P2',
    'CTP ms',
    '실험',
    '`ad22c019`, 판정 탭 전환만 적용',
  ],
  [
    'PICK-08',
    '이미지 reset·fit·투명도',
    'P1',
    'CTP ms',
    '실험',
    '`ad22c019`, 상태 탭 전환만 적용',
  ],
  [
    'MODAL-02',
    '키·노트·카운터 설정 전체',
    'P1/P2',
    'CTP ms',
    '실험',
    '`ad22c019`, 내부 탭 전환만 적용',
  ],
];
for (const [id, label, priority, metric, status, evidence] of partialRows) {
  tracker = tracker.replace(
    new RegExp(`^\\| ${id}\\s+\\|.*$`, 'm'),
    `| ${id} | ${label} | ${priority} | ${metric} | — | — | — | ${status} | ${evidence} |`,
  );
}
tracker = tracker.replace(
  /^\| PICK-09\s+\|.*$/m,
  '| PICK-09 | 그림자 상태·수치·색상 | P0/P1 | F95 ms/frame | — | — | — | 대기 | 상태 전환 직후 편집의 동기 계약 유지 |',
);

const replaceOrInsert = (start, end, block, before) => {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  return expression.test(tracker)
    ? tracker.replace(expression, block)
    : tracker.replace(before, `${block}\n\n${before}`);
};
tracker = replaceOrInsert(
  '<!-- BASE-07:RESULT:START -->',
  '<!-- BASE-07:RESULT:END -->',
  resultBlock,
  '### 5.1 파일럿·공통 기반',
);
tracker = replaceOrInsert(
  '<!-- BASE-07:SESSIONS:START -->',
  '<!-- BASE-07:SESSIONS:END -->',
  sessionsBlock,
  '### 6.1 실제 브라우저 세션',
);
tracker = replaceOrInsert(
  '<!-- BASE-07:EXPERIMENT:START -->',
  '<!-- BASE-07:EXPERIMENT:END -->',
  experimentBlock,
  '## 8. 완료 게이트',
);

const trackingStart = tracker.indexOf('## 5. 전수 성능 추적표');
const trackingEnd = tracker.indexOf('## 6. 측정 세션');
const summaryStart = tracker.indexOf('## 4. 핵심 현황');
const trackingRows = tracker.slice(trackingStart, trackingEnd);
const pendingCount = (trackingRows.match(/\| 대기 \|/g) ?? []).length;
const validatingCount = (trackingRows.match(/\| (?:실험|검증) \|/g) ?? [])
  .length;
const summary = tracker
  .slice(summaryStart, trackingStart)
  .replace(/^\| 대기\s+\|.*$/m, `| 대기 | ${pendingCount}개 |`)
  .replace(
    /^\| 실험·검증 중\s+\|.*$/m,
    `| 실험·검증 중 | ${validatingCount}개 |`,
  );
tracker = `${tracker.slice(0, summaryStart)}${summary}${tracker.slice(
  trackingStart,
)}`;

await writeFile(trackerPath, tracker, 'utf8');
const formatResult = spawnSync(
  npxCommand,
  ['prettier', '--write', 'docs/interaction-performance-tracker.md'],
  { cwd: root, stdio: 'inherit' },
);
if (formatResult.status !== 0) process.exit(formatResult.status ?? 1);

console.info(
  `BASE-07 visual DOM commit P95: ${formatMs(visualBefore)}ms → ${formatMs(
    visualAfter,
  )}ms (${formatPercent(visualImprovement)})`,
);
