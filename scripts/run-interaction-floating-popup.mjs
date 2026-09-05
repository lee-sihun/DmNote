import { execFileSync, spawnSync } from 'node:child_process';
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
    output: 'benchmarks/results/base-08-floating-popup-baseline.json',
  },
  {
    strategy: 'after-paint',
    variant: 'improved',
    output: 'benchmarks/results/base-08-floating-popup-improved.json',
  },
];

for (const entry of variants) {
  const result = spawnSync(
    npmCommand,
    ['run', 'benchmark:interaction:floating-popup:raw'],
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
  throw new Error('BASE-08 benchmark 결과에 비교할 case가 없습니다.');
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
const contentBefore = baselineCase.contentDomCommitMs.p95;
const contentAfter = improvedCase.contentDomCommitMs.p95;
const visualImprovement = improvement(visualBefore, visualAfter);
const measuredDate = improved.measuredAt.slice(0, 10);
const runtimeLabel = `${improved.runtime.kind}, ${improved.runtime.platform} ${improved.runtime.arch}, ${improved.runtime.node}`;
const implementationCommit = execFileSync(
  'git',
  [
    'log',
    '-1',
    '--format=%H',
    '--',
    'src/renderer/components/main/Modal/floatingPopup/FloatingPopup.tsx',
    'src/renderer/components/main/Modal/listPopup/ListPopup.tsx',
  ],
  { cwd: root, encoding: 'utf8' },
).trim();
const implementationShort = implementationCommit.slice(0, 8);
if (visualImprovement === null || visualImprovement <= 0) {
  throw new Error(
    `BASE-08 popup shell DOM commit P95가 개선되지 않았습니다: ${formatMs(
      visualBefore,
    )}ms → ${formatMs(visualAfter)}ms`,
  );
}

const correctnessResult = spawnSync(
  npxCommand,
  [
    'vitest',
    'run',
    'src/renderer/components/main/Modal/floatingPopup/FloatingPopup.test.tsx',
    'src/renderer/components/main/Modal/listPopup/ListPopup.test.tsx',
    'src/renderer/components/main/Modal/floatingPopupLayerOwnership.test.tsx',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (correctnessResult.status !== 0) process.exit(correctnessResult.status ?? 1);

const resultBlock = `<!-- BASE-08:RESULT:START -->
#### BASE-08 ListPopup·FloatingPopup 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | 공통 FloatingPopup + 메뉴 DOM ${
  baselineCase.itemCount
}개 mount proxy |
| 반복 | 기준선 ${baselineCase.iterations}회 / 개선 ${
  improvedCase.iterations
}회, 워밍업 각 ${baselineCase.warmupIterations}회 |
| 구현 코드 커밋 | \`${implementationCommit}\` |
| 측정 코드 커밋 | \`${improved.commit}\` |
| 비교 전략 | \`${baseline.commitStrategy}\` → \`${improved.commitStrategy}\` |
| 환경 | ${improved.runtime.platform} ${improved.runtime.arch}, ${
  improved.runtime.node
} |

| P95 지표 | sync 기준선 | after-paint | 개선율 |
| --- | ---: | ---: | ---: |
| opener·shell DOM commit | ${formatMs(visualBefore)}ms | ${formatMs(
  visualAfter,
)}ms | ${formatPercent(visualImprovement)} |
| popup content mount | ${formatMs(contentBefore)}ms | ${formatMs(
  contentAfter,
)}ms | ${formatPercent(improvement(contentBefore, contentAfter))} |
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
- 정확성 게이트: FloatingPopup 포커스·계층 소유권과 ListPopup 키보드 계약 테스트 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-08:RESULT:END -->`;

const sessionRow = (id, stage, result, resultCase, output) =>
  `| ${id} | ${measuredDate} | BASE-08 | ${stage} | \`${result.commit.slice(
    0,
    8,
  )}\` | ${runtimeLabel} | 메뉴 DOM ${resultCase.itemCount}개 | ${
    resultCase.iterations
  } | ${formatMs(resultCase.visualDomCommitMs.p50)} | ${formatMs(
    resultCase.visualDomCommitMs.p95,
  )} | ${formatMs(resultCase.visualDomCommitMs.max)} | content P95 ${formatMs(
    resultCase.contentDomCommitMs.p95,
  )}ms·event P95 ${formatMs(
    resultCase.eventBlockingMs.p95,
  )}ms | [JSON](../${output}) | DOM commit proxy |`;
const sessionsBlock = `<!-- BASE-08:SESSIONS:START -->
| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${sessionRow(
  'BASE-08-SYNC',
  '기준선',
  baseline,
  baselineCase,
  variants[0].output,
)}
${sessionRow(
  'BASE-08-PAINT',
  '개선',
  improved,
  improvedCase,
  variants[1].output,
)}
<!-- BASE-08:SESSIONS:END -->`;

const experimentBlock = `<!-- BASE-08:EXPERIMENT:START -->
### EXP-014: 공통 팝업 콘텐츠 표시 분리

| 필드 | 내용 |
| --- | --- |
| 항목 ID | BASE-08 |
| 적용 범위 | 공통 ListPopup 전체와 팔레트·커스텀 탭 FloatingPopup |
| 변경 내용 | opener aria-expanded·빈 popup shell을 먼저 반영하고 무거운 children mount를 첫 paint 뒤 실행 |
| 적용 기법 | 시각 피드백 분리·지연 mount·예약 취소·초기 포커스 인계 |
| 구현 커밋 | \`${implementationShort}\` |
| P95 변화 | ${formatMs(visualBefore)}ms → ${formatMs(
  visualAfter,
)}ms (${formatPercent(visualImprovement)}) |
| 정확성 검증 | sync 호환·예약 취소·첫 항목 포커스·키보드·중첩 팝업 계층 계약 테스트 통과 |
| 결론 | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지 |
<!-- BASE-08:EXPERIMENT:END -->`;

let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^\| BASE-08\s+\|.*$/m,
  `| BASE-08 | ListPopup·FloatingPopup | P1/P3 | DOM P95 ms | ${formatMs(
    visualBefore,
  )} | ${formatMs(visualAfter)} | ${formatPercent(
    visualImprovement,
  )} | 검증 | [기준선](../${variants[0].output}) · [개선](../${
    variants[1].output
  }) |`,
);
const affectedRows = [
  ['TOOL-02', '키·통계·그래프·노브 추가 메뉴', 'P1'],
  ['TOOL-03', '팔레트 열기', 'P3'],
  ['TOOL-06', '커스텀 탭 팝업', 'P2/P3'],
  ['GRID-15', 'Grid 컨텍스트 메뉴', 'P3'],
  ['LAYER-10', '레이어 컨텍스트 메뉴', 'P3'],
];
for (const [id, label, priority] of affectedRows) {
  tracker = tracker.replace(
    new RegExp(`^\\| ${id}\\s+\\|.*$`, 'm'),
    `| ${id} | ${label} | ${priority} | CTP ms | — | — | — | 실험 | \`${implementationShort}\`, 공통 popup shell 우선 표시 적용 |`,
  );
}

const replaceOrInsert = (start, end, block, before) => {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  return expression.test(tracker)
    ? tracker.replace(expression, block)
    : tracker.replace(before, `${block}\n\n${before}`);
};
tracker = replaceOrInsert(
  '<!-- BASE-08:RESULT:START -->',
  '<!-- BASE-08:RESULT:END -->',
  resultBlock,
  '### 5.1 파일럿·공통 기반',
);
tracker = replaceOrInsert(
  '<!-- BASE-08:SESSIONS:START -->',
  '<!-- BASE-08:SESSIONS:END -->',
  sessionsBlock,
  '### 6.1 실제 브라우저 세션',
);
tracker = replaceOrInsert(
  '<!-- BASE-08:EXPERIMENT:START -->',
  '<!-- BASE-08:EXPERIMENT:END -->',
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
  ['prettier', '--write', trackerPath],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (formatResult.status !== 0) process.exit(formatResult.status ?? 1);
console.info(
  `BASE-08 popup shell DOM commit P95: ${formatMs(visualBefore)}ms → ${formatMs(
    visualAfter,
  )}ms (${formatPercent(visualImprovement)})`,
);
