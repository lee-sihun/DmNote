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
    output: 'benchmarks/results/base-03-dropdown-baseline.json',
  },
  {
    strategy: 'after-paint',
    variant: 'improved',
    output: 'benchmarks/results/base-03-dropdown-improved.json',
  },
];

for (const entry of variants) {
  const result = spawnSync(
    npmCommand,
    ['run', 'benchmark:interaction:dropdown:raw'],
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
  throw new Error('BASE-03 benchmark 결과에 비교할 case가 없습니다.');
}
if (baselineCase.itemCount !== improvedCase.itemCount) {
  throw new Error('BASE-03 baseline과 improved의 항목 수가 다릅니다.');
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
const implementationCommit = execFileSync(
  'git',
  [
    'log',
    '-1',
    '--format=%H',
    '--',
    'src/renderer/components/main/common/Dropdown.tsx',
  ],
  { cwd: root, encoding: 'utf8' },
).trim();
const implementationShort = implementationCommit.slice(0, 8);

if (visualImprovement === null || visualImprovement <= 0) {
  throw new Error(
    `BASE-03 시각 DOM commit P95가 개선되지 않았습니다: ${formatMs(
      visualBefore,
    )}ms → ${formatMs(visualAfter)}ms`,
  );
}

const correctnessResult = spawnSync(
  npxCommand,
  ['vitest', 'run', 'src/renderer/components/main/common/Dropdown.test.tsx'],
  { cwd: root, stdio: 'inherit' },
);
if (correctnessResult.status !== 0) {
  process.exit(correctnessResult.status ?? 1);
}

const resultBlock = `<!-- BASE-03:RESULT:START -->
#### BASE-03 Dropdown 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | 공통 Dropdown + 선택 콘텐츠 DOM ${
  baselineCase.itemCount
}개 교체 proxy |
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
| 메뉴 닫힘 DOM commit | ${formatMs(visualBefore)}ms | ${formatMs(
  visualAfter,
)}ms | ${formatPercent(visualImprovement)} |
| canonical 선택 commit | ${formatMs(canonicalBefore)}ms | ${formatMs(
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
- 정확성 게이트: \`Dropdown.test.tsx\` 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-03:RESULT:END -->`;

const sessionRow = (id, stage, result, resultCase, output) =>
  `| ${id} | ${measuredDate} | BASE-03 | ${stage} | \`${result.commit.slice(
    0,
    8,
  )}\` | ${runtimeLabel} | 선택 콘텐츠 ${resultCase.itemCount}개 | ${
    resultCase.iterations
  } | ${formatMs(resultCase.visualDomCommitMs.p50)} | ${formatMs(
    resultCase.visualDomCommitMs.p95,
  )} | ${formatMs(resultCase.visualDomCommitMs.max)} | canonical P95 ${formatMs(
    resultCase.canonicalDomCommitMs.p95,
  )}ms·React P95 ${formatMs(
    resultCase.reactCommitDurationMs.p95,
  )}ms | [JSON](../${output}) | DOM commit proxy |`;
const sessionsBlock = `<!-- BASE-03:SESSIONS:START -->
| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${sessionRow(
  'BASE-03-SYNC',
  '기준선',
  baseline,
  baselineCase,
  variants[0].output,
)}
${sessionRow(
  'BASE-03-PAINT',
  '개선',
  improved,
  improvedCase,
  variants[1].output,
)}
<!-- BASE-03:SESSIONS:END -->`;

const experimentBlock = `<!-- BASE-03:EXPERIMENT:START -->
### EXP-010: 공통 Dropdown 선택 시각 우선 반영

| 필드 | 내용 |
| --- | --- |
| 항목 ID | BASE-03 |
| 적용 범위 | 프로퍼티 패널·통합 설정 모달·피커의 로컬 선택 22곳 |
| 변경 내용 | 메뉴 닫힘·포커스 복원·선택 라벨을 먼저 반영하고 canonical 선택은 첫 paint 뒤 커밋 |
| 적용 기법 | 낙관적 상태 투영·메인 스레드 양보·연속 선택 병합 |
| 구현 커밋 | \`${implementationShort}\` |
| P95 변화 | ${formatMs(visualBefore)}ms → ${formatMs(
  visualAfter,
)}ms (${formatPercent(visualImprovement)}) |
| 정확성 검증 | sync 기본값·메뉴 닫힘·포커스 복원·라벨 선반영·선택 콜백 지연 테스트 통과 |
| 결론 | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지 |
<!-- BASE-03:EXPERIMENT:END -->`;

let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^\| BASE-03\s+\|.*$/m,
  `| BASE-03 | Dropdown | 기반 | DOM P95 ms | ${formatMs(
    visualBefore,
  )} | ${formatMs(visualAfter)} | ${formatPercent(
    visualImprovement,
  )} | 검증 | [기준선](../${variants[0].output}) · [개선](../${
    variants[1].output
  }) |`,
);

const partialRows = [
  [
    'PROP-05',
    '드롭다운 속성 변경',
    'P1',
    'CTP ms',
    `\`${implementationShort}\`, 로컬 선택 after-paint 적용`,
  ],
  [
    'PROP-12',
    '플러그인 설정 number·text·select',
    'P1',
    'CTP ms',
    `\`${implementationShort}\`, select만 적용`,
  ],
  [
    'PICK-01',
    '사운드 선택·검색·필터',
    'P1',
    'CTP ms',
    `\`${implementationShort}\`, 목록 필터만 적용`,
  ],
  [
    'PICK-03',
    '폰트 선택·검색·필터',
    'P1',
    'CTP ms',
    `\`${implementationShort}\`, 목록 필터만 적용`,
  ],
  [
    'PICK-05',
    '카운터 애니메이션 선택·삭제',
    'P2',
    'ETC ms',
    `\`${implementationShort}\`, 선택만 적용`,
  ],
];
for (const [id, label, priority, metric, evidence] of partialRows) {
  tracker = tracker.replace(
    new RegExp(`^\\| ${id}\\s+\\|.*$`, 'm'),
    `| ${id} | ${label} | ${priority} | ${metric} | — | — | — | 실험 | ${evidence} |`,
  );
}
tracker = tracker.replace(
  /^\| PICK-08\s+\|.*$/m,
  `| PICK-08 | 이미지 reset·fit·투명도 | P1 | CTP ms | — | — | — | 실험 | \`ad22c019\` 상태 탭·\`${implementationShort}\` fit 선택 적용 |`,
);
tracker = tracker.replace(
  /^\| MODAL-02\s+\|.*$/m,
  `| MODAL-02 | 키·노트·카운터 설정 전체 | P1/P2 | CTP ms | — | — | — | 실험 | \`ad22c019\` 내부 탭·\`${implementationShort}\` 로컬 Dropdown 적용 |`,
);

const replaceOrInsert = (start, end, block, before) => {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  return expression.test(tracker)
    ? tracker.replace(expression, block)
    : tracker.replace(before, `${block}\n\n${before}`);
};
tracker = replaceOrInsert(
  '<!-- BASE-03:RESULT:START -->',
  '<!-- BASE-03:RESULT:END -->',
  resultBlock,
  '### 5.1 파일럿·공통 기반',
);
tracker = replaceOrInsert(
  '<!-- BASE-03:SESSIONS:START -->',
  '<!-- BASE-03:SESSIONS:END -->',
  sessionsBlock,
  '### 6.1 실제 브라우저 세션',
);
tracker = replaceOrInsert(
  '<!-- BASE-03:EXPERIMENT:START -->',
  '<!-- BASE-03:EXPERIMENT:END -->',
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
  `BASE-03 visual DOM commit P95: ${formatMs(visualBefore)}ms → ${formatMs(
    visualAfter,
  )}ms (${formatPercent(visualImprovement)})`,
);
