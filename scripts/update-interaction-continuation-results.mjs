import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const readResult = async (path) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
const ms = (value) => value.toFixed(3);
const improvement = (before, after) =>
  before === 0 ? null : ((before - after) / before) * 100;
const percent = (value) =>
  value === null
    ? '—'
    : `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(1)}%`;
const runtime = (result) =>
  `${result.runtime.kind}, ${result.runtime.platform} ${result.runtime.arch}, ${result.runtime.node}`;
const implementationCommit = (path) =>
  execFileSync('git', ['log', '-1', '--format=%H', '--', path], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
const replaceBlock = (source, id, kind, block) => {
  const start = `<!-- ${id}:${kind}:START -->`;
  const end = `<!-- ${id}:${kind}:END -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(source)) {
    throw new Error(`${id} ${kind} 문서 마커 누락`);
  }
  return source.replace(pattern, block);
};
const replaceExperimentMetric = (source, heading, value) => {
  const start = source.indexOf(`### ${heading}`);
  if (start < 0) throw new Error(`${heading} 실험 기록 누락`);
  const nextHeading = source.slice(start + 4).search(/\n#{2,3} /);
  const end = nextHeading < 0 ? source.length : start + 4 + nextHeading;
  const section = source
    .slice(start, end)
    .replace(/^\| P95 변화\s+\|.*$/m, `| P95 변화 | ${value} |`);
  return `${source.slice(0, start)}${section}${source.slice(end)}`;
};
const sessionHeader =
  '| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |';

const panelPaths = [
  'benchmarks/results/base-11-panel-toggle-baseline.json',
  'benchmarks/results/base-11-panel-toggle-improved.json',
];
const gridPaths = [
  'benchmarks/results/grid-21-keyboard-baseline.json',
  'benchmarks/results/grid-21-keyboard-improved.json',
];
const pluginPaths = [
  'benchmarks/results/plug-02-input-baseline.json',
  'benchmarks/results/plug-02-input-improved.json',
];
const [
  panelBaseline,
  panelImproved,
  gridBaseline,
  gridImproved,
  pluginBaseline,
  pluginImproved,
] = await Promise.all([
  ...panelPaths.map(readResult),
  ...gridPaths.map(readResult),
  ...pluginPaths.map(readResult),
]);
const panelBefore = panelBaseline.cases.at(-1);
const panelAfter = panelImproved.cases.at(-1);
const gridBefore = gridBaseline.cases.at(-1);
const gridAfter = gridImproved.cases.at(-1);
const pluginBefore = pluginBaseline.cases.at(-1);
const pluginAfter = pluginImproved.cases.at(-1);
if (
  !panelBefore ||
  !panelAfter ||
  !gridBefore ||
  !gridAfter ||
  !pluginBefore ||
  !pluginAfter
) {
  throw new Error('자동 측정 결과의 최대 부하 case 누락');
}

const panelRate = improvement(
  panelBefore.visualDomCommitMs.p95,
  panelAfter.visualDomCommitMs.p95,
);
const gridRate = improvement(
  gridBefore.eventBlockingMs.p95,
  gridAfter.eventBlockingMs.p95,
);
const pluginRate = improvement(
  pluginBefore.eventBlockingMs.p95,
  pluginAfter.eventBlockingMs.p95,
);
const panelImplementation = implementationCommit(
  'src/renderer/components/main/Grid/PropertiesPanel/PanelToggleButton.tsx',
);
const gridImplementation = implementationCommit(
  'src/renderer/hooks/Grid/useGridKeyboard.ts',
);
const pluginImplementation = implementationCommit(
  'src/renderer/utils/plugin/pluginHandlerDispatcher.ts',
);
const panelBenchmarkCommit = implementationCommit(
  'src/renderer/benchmarks/panelToggle.performance.test.tsx',
);
const gridBenchmarkCommit = implementationCommit(
  'src/renderer/benchmarks/gridKeyboard.performance.test.tsx',
);
const pluginBenchmarkCommit = implementationCommit(
  'src/renderer/benchmarks/pluginInput.performance.test.ts',
);

const panelResult = `<!-- BASE-11:RESULT:START -->
#### BASE-11 패널 토글 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | PanelToggleButton + 패널 DOM ${
  panelBefore.itemCount
}개 mount proxy |
| 반복 | 기준선 ${panelBefore.iterations}회 / 개선 ${
  panelAfter.iterations
}회, 워밍업 각 ${panelBefore.warmupIterations}회 |
| 구현 코드 커밋 | \`${panelImplementation}\` |
| 측정 코드 커밋 | \`${panelBenchmarkCommit}\` |
| 측정 대상 커밋 | \`${panelImproved.commit}\` |
| 비교 전략 | \`${panelBaseline.commitStrategy}\` → \`${
  panelImproved.commitStrategy
}\` |
| 환경 | ${panelImproved.runtime.platform} ${panelImproved.runtime.arch}, ${
  panelImproved.runtime.node
} |

| P95 지표 | sync | after-paint | 개선율 |
| --- | ---: | ---: | ---: |
| 버튼 시각 DOM commit | ${ms(panelBefore.visualDomCommitMs.p95)}ms | ${ms(
  panelAfter.visualDomCommitMs.p95,
)}ms | ${percent(panelRate)} |
| 패널 콘텐츠 DOM commit | ${ms(panelBefore.contentDomCommitMs.p95)}ms | ${ms(
  panelAfter.contentDomCommitMs.p95,
)}ms | ${percent(
  improvement(
    panelBefore.contentDomCommitMs.p95,
    panelAfter.contentDomCommitMs.p95,
  ),
)} |
| React commit duration | ${ms(panelBefore.reactCommitDurationMs.p95)}ms | ${ms(
  panelAfter.reactCommitDurationMs.p95,
)}ms | ${percent(
  improvement(
    panelBefore.reactCommitDurationMs.p95,
    panelAfter.reactCommitDurationMs.p95,
  ),
)} |

- 원시 결과: [기준선](../${panelPaths[0]}) · [개선](../${panelPaths[1]})
- 해석: 콘텐츠 총 작업은 유지하면서 버튼 피드백만 첫 paint 앞으로 분리했다.
- 정확성 게이트: 시각 선반영·동일 프레임 상쇄 테스트 통과
<!-- BASE-11:RESULT:END -->`;

const gridResult = `<!-- GRID-21:RESULT:START -->
#### GRID-21 방향키 burst 최신 자동 측정

DOM ${gridBefore.itemCount}개와 \`keydown\` ${
  gridBefore.burstSize
}회 burst, 기준선·개선 각 ${gridBefore.iterations}회와 워밍업 ${
  gridBefore.warmupIterations
}회 조건이다.

| P95 지표 | sync | frame coalescing | 개선율 |
| --- | ---: | ---: | ---: |
| burst event blocking | ${ms(gridBefore.eventBlockingMs.p95)}ms | ${ms(
  gridAfter.eventBlockingMs.p95,
)}ms | ${percent(gridRate)} |
| 최종 DOM commit | ${ms(gridBefore.visualDomCommitMs.p95)}ms | ${ms(
  gridAfter.visualDomCommitMs.p95,
)}ms | ${percent(
  improvement(
    gridBefore.visualDomCommitMs.p95,
    gridAfter.visualDomCommitMs.p95,
  ),
)} |
| React commit duration | ${ms(gridBefore.reactCommitDurationMs.p95)}ms | ${ms(
  gridAfter.reactCommitDurationMs.p95,
)}ms | ${percent(
  improvement(
    gridBefore.reactCommitDurationMs.p95,
    gridAfter.reactCommitDurationMs.p95,
  ),
)} |

- 구현 코드 커밋: \`${gridImplementation}\`, 측정 코드 커밋: \`${gridBenchmarkCommit}\`, 측정 대상 커밋: \`${
  gridImproved.commit
}\`
- 원시 결과: [기준선](../${gridPaths[0]}) · [개선](../${gridPaths[1]})
- 해석: 입력 이벤트 점유를 줄이고 최종 이동은 다음 프레임에 합산 반영한다.
- 정확성 게이트: delta 합산·keyup flush·history gesture 보존 테스트 통과
<!-- GRID-21:RESULT:END -->`;

const pluginResult = `<!-- PLUG-02:RESULT:START -->
#### PLUG-02 플러그인 입력 burst 최신 자동 측정

handler workload ${pluginBefore.itemCount}개와 \`input\` ${
  pluginBefore.burstSize
}회 burst, 기준선·개선 각 ${pluginBefore.iterations}회와 워밍업 ${
  pluginBefore.warmupIterations
}회 조건이다.

| P95 지표 | sync | frame coalescing | 개선율 |
| --- | ---: | ---: | ---: |
| burst event blocking | ${ms(pluginBefore.eventBlockingMs.p95)}ms | ${ms(
  pluginAfter.eventBlockingMs.p95,
)}ms | ${percent(pluginRate)} |
| handler 완료 | ${ms(pluginBefore.handlerCompleteMs.p95)}ms | ${ms(
  pluginAfter.handlerCompleteMs.p95,
)}ms | ${percent(
  improvement(
    pluginBefore.handlerCompleteMs.p95,
    pluginAfter.handlerCompleteMs.p95,
  ),
)} |
| handler 호출 수 | ${pluginBefore.handlerInvocations.p95}회 | ${
  pluginAfter.handlerInvocations.p95
}회 | ${percent(
  improvement(
    pluginBefore.handlerInvocations.p95,
    pluginAfter.handlerInvocations.p95,
  ),
)} |

- 구현 코드 커밋: \`${pluginImplementation}\`, 측정 코드 커밋: \`${pluginBenchmarkCommit}\`, 측정 대상 커밋: \`${
  pluginImproved.commit
}\`
- 원시 결과: [기준선](../${pluginPaths[0]}) · [개선](../${pluginPaths[1]})
- 정확성 게이트: 최신 이벤트 보존·change 선행 flush·Promise action single-flight 테스트 통과
<!-- PLUG-02:RESULT:END -->`;

const sessionRow = ({
  id,
  stage,
  result,
  resultCase,
  scenario,
  primary,
  auxiliary,
  path,
  note,
}) =>
  `| ${id} | ${result.measuredAt.slice(0, 10)} | ${
    result.benchmarkId
  } | ${stage} | \`${result.commit.slice(0, 8)}\` | ${runtime(
    result,
  )} | ${scenario} | ${resultCase.iterations} | ${ms(primary.p50)} | ${ms(
    primary.p95,
  )} | ${ms(primary.max)} | ${auxiliary} | [JSON](../${path}) | ${note} |`;
const sessions = (id, rows) =>
  `<!-- ${id}:SESSIONS:START -->\n${sessionHeader}\n${rows.join(
    '\n',
  )}\n<!-- ${id}:SESSIONS:END -->`;
const panelSessions = sessions('BASE-11', [
  sessionRow({
    id: 'BASE-11-SYNC',
    stage: '기준선',
    result: panelBaseline,
    resultCase: panelBefore,
    scenario: `패널 DOM ${panelBefore.itemCount}개`,
    primary: panelBefore.visualDomCommitMs,
    auxiliary: `content P95 ${ms(
      panelBefore.contentDomCommitMs.p95,
    )}ms·React P95 ${ms(panelBefore.reactCommitDurationMs.p95)}ms`,
    path: panelPaths[0],
    note: 'DOM commit proxy',
  }),
  sessionRow({
    id: 'BASE-11-PAINT',
    stage: '개선',
    result: panelImproved,
    resultCase: panelAfter,
    scenario: `패널 DOM ${panelAfter.itemCount}개`,
    primary: panelAfter.visualDomCommitMs,
    auxiliary: `content P95 ${ms(
      panelAfter.contentDomCommitMs.p95,
    )}ms·React P95 ${ms(panelAfter.reactCommitDurationMs.p95)}ms`,
    path: panelPaths[1],
    note: 'DOM commit proxy',
  }),
]);
const gridSessions = sessions('GRID-21', [
  sessionRow({
    id: 'GRID-21-SYNC',
    stage: '기준선',
    result: gridBaseline,
    resultCase: gridBefore,
    scenario: `DOM ${gridBefore.itemCount}개·keydown ${gridBefore.burstSize}회`,
    primary: gridBefore.eventBlockingMs,
    auxiliary: `DOM P95 ${ms(
      gridBefore.visualDomCommitMs.p95,
    )}ms·React P95 ${ms(gridBefore.reactCommitDurationMs.p95)}ms`,
    path: gridPaths[0],
    note: 'keyboard burst proxy',
  }),
  sessionRow({
    id: 'GRID-21-FRAME',
    stage: '개선',
    result: gridImproved,
    resultCase: gridAfter,
    scenario: `DOM ${gridAfter.itemCount}개·keydown ${gridAfter.burstSize}회`,
    primary: gridAfter.eventBlockingMs,
    auxiliary: `DOM P95 ${ms(gridAfter.visualDomCommitMs.p95)}ms·React P95 ${ms(
      gridAfter.reactCommitDurationMs.p95,
    )}ms`,
    path: gridPaths[1],
    note: 'keyboard burst proxy',
  }),
]);
const pluginSessions = sessions('PLUG-02', [
  sessionRow({
    id: 'PLUG-02-SYNC',
    stage: '기준선',
    result: pluginBaseline,
    resultCase: pluginBefore,
    scenario: `handler ${pluginBefore.itemCount}개·input ${pluginBefore.burstSize}회`,
    primary: pluginBefore.eventBlockingMs,
    auxiliary: `handler P95 ${ms(pluginBefore.handlerCompleteMs.p95)}ms·${
      pluginBefore.handlerInvocations.p95
    }회 호출`,
    path: pluginPaths[0],
    note: 'handler burst proxy',
  }),
  sessionRow({
    id: 'PLUG-02-FRAME',
    stage: '개선',
    result: pluginImproved,
    resultCase: pluginAfter,
    scenario: `handler ${pluginAfter.itemCount}개·input ${pluginAfter.burstSize}회`,
    primary: pluginAfter.eventBlockingMs,
    auxiliary: `handler P95 ${ms(pluginAfter.handlerCompleteMs.p95)}ms·${
      pluginAfter.handlerInvocations.p95
    }회 호출`,
    path: pluginPaths[1],
    note: 'handler burst proxy',
  }),
]);

let tracker = await readFile(trackerPath, 'utf8');
tracker = replaceBlock(tracker, 'BASE-11', 'RESULT', panelResult);
tracker = replaceBlock(tracker, 'GRID-21', 'RESULT', gridResult);
tracker = replaceBlock(tracker, 'PLUG-02', 'RESULT', pluginResult);
tracker = replaceBlock(tracker, 'BASE-11', 'SESSIONS', panelSessions);
tracker = replaceBlock(tracker, 'GRID-21', 'SESSIONS', gridSessions);
tracker = replaceBlock(tracker, 'PLUG-02', 'SESSIONS', pluginSessions);
tracker = tracker
  .replace(
    /^\| BASE-11\s+\|.*$/m,
    `| BASE-11 | PanelToggleButton | P1 | CTP ms | ${ms(
      panelBefore.visualDomCommitMs.p95,
    )} | ${ms(panelAfter.visualDomCommitMs.p95)} | ${percent(
      panelRate,
    )} | 검증 | \`${panelImplementation.slice(
      0,
      8,
    )}\`·\`${panelBenchmarkCommit.slice(
      0,
      8,
    )}\`, 버튼 시각 상태와 패널 mount 분리 |`,
  )
  .replace(
    /^\| GRID-21\s+\|.*$/m,
    `| GRID-21 | 방향키 이동 | P0 | F95 ms/frame | ${ms(
      gridBefore.eventBlockingMs.p95,
    )} | ${ms(gridAfter.eventBlockingMs.p95)} | ${percent(
      gridRate,
    )} | 검증 | \`${gridImplementation.slice(
      0,
      8,
    )}\`·\`${gridBenchmarkCommit.slice(0, 8)}\`, ${
      gridBefore.burstSize
    }회 burst를 프레임당 1회 병합 |`,
  )
  .replace(
    /^\| PLUG-02\s+\|.*$/m,
    `| PLUG-02 | plugin input onInput | P0/P1 | F95 ms/frame | ${ms(
      pluginBefore.eventBlockingMs.p95,
    )} | ${ms(pluginAfter.eventBlockingMs.p95)} | ${percent(
      pluginRate,
    )} | 검증 | \`${pluginImplementation.slice(
      0,
      8,
    )}\`·\`${pluginBenchmarkCommit.slice(0, 8)}\`, ${
      pluginBefore.burstSize
    }회 입력을 frame당 최신 1회로 병합 |`,
  );
tracker = replaceExperimentMetric(
  tracker,
  'EXP-022: 플러그인 입력·액션 디스패처',
  `PLUG-02 ${ms(pluginBefore.eventBlockingMs.p95)}ms → ${ms(
    pluginAfter.eventBlockingMs.p95,
  )}ms (${percent(pluginRate)}), handler ${
    pluginBefore.handlerInvocations.p95
  }회 → ${pluginAfter.handlerInvocations.p95}회`,
);
tracker = replaceExperimentMetric(
  tracker,
  'EXP-023: 방향키 이동 프레임 병합',
  `${ms(gridBefore.eventBlockingMs.p95)}ms → ${ms(
    gridAfter.eventBlockingMs.p95,
  )}ms (${percent(gridRate)})`,
);
tracker = replaceExperimentMetric(
  tracker,
  'EXP-025: 전역 리스너·패널 토글 비용 분리',
  `BASE-11 ${ms(panelBefore.visualDomCommitMs.p95)}ms → ${ms(
    panelAfter.visualDomCommitMs.p95,
  )}ms (${percent(panelRate)})`,
);

const trackingStart = tracker.indexOf('## 5. 전수 성능 추적표');
const trackingEnd = tracker.indexOf('## 6. 측정 세션');
const summaryStart = tracker.indexOf('## 4. 핵심 현황');
const trackingRows = tracker.slice(trackingStart, trackingEnd);
const itemLines = trackingRows
  .split('\n')
  .filter((line) => /^\| [A-Z]+-\d+\s+\|/.test(line));
const countStatus = (status) =>
  itemLines.filter((line) => line.includes(`| ${status} |`)).length;
const measuredRates = itemLines
  .map((line) => line.split('|').map((cell) => cell.trim())[7])
  .filter((value) => /^-?\d+(?:\.\d+)?%$/.test(value))
  .map((value) => Number.parseFloat(value));
const sortedRates = [...measuredRates].sort((a, b) => a - b);
const median = sortedRates.length
  ? sortedRates.length % 2
    ? sortedRates[(sortedRates.length - 1) / 2]
    : (sortedRates[sortedRates.length / 2 - 1] +
        sortedRates[sortedRates.length / 2]) /
      2
  : null;
const largestLine = itemLines.reduce((best, line) => {
  const cells = line.split('|').map((cell) => cell.trim());
  const value = Number.parseFloat(cells[7]);
  return Number.isFinite(value) && (!best || value > best.value)
    ? { id: cells[1], value }
    : best;
}, null);
const p0Rows = itemLines.filter((line) => /\| P0(?:\/|\s+\|)/.test(line));
const p0Done = p0Rows.filter((line) => line.includes('| 완료 |')).length;
const summary = tracker
  .slice(summaryStart, trackingStart)
  .replace(
    /^\| 전체 추적 항목\s+\|.*$/m,
    `| 전체 추적 항목 | ${itemLines.length}개 |`,
  )
  .replace(/^\| 대기\s+\|.*$/m, `| 대기 | ${countStatus('대기')}개 |`)
  .replace(/^\| 완료\s+\|.*$/m, `| 완료 | ${countStatus('완료')}개 |`)
  .replace(
    /^\| 실험·검증 중\s+\|.*$/m,
    `| 실험·검증 중 | ${countStatus('실험') + countStatus('검증')}개 |`,
  )
  .replace(/^\| 보류\s+\|.*$/m, `| 보류 | ${countStatus('보류')}개 |`)
  .replace(/^\| 회귀\s+\|.*$/m, `| 회귀 | ${countStatus('회귀')}개 |`)
  .replace(
    /^\| P0 완료율\s+\|.*$/m,
    `| P0 완료율 | ${
      p0Rows.length
        ? ((p0Done / p0Rows.length) * 100).toFixed(1).replace('.0', '')
        : 0
    }% |`,
  )
  .replace(
    /^\| 측정 완료 항목의 P95 중앙 개선율\s+\|.*$/m,
    `| 측정 완료 항목의 P95 중앙 개선율 | ${
      median === null ? '—' : `${median.toFixed(1)}%`
    } |`,
  )
  .replace(
    /^\| 가장 큰 개선\s+\|.*$/m,
    `| 가장 큰 개선 | ${
      largestLine ? `${largestLine.id} ${largestLine.value.toFixed(1)}%` : '—'
    } |`,
  );
tracker = `${tracker.slice(0, summaryStart)}${summary}${tracker.slice(
  trackingStart,
)}`;
await writeFile(trackerPath, tracker, 'utf8');

const formatted = spawnSync(npx, ['prettier', '--write', trackerPath], {
  cwd: root,
  stdio: 'inherit',
});
if (formatted.status !== 0) process.exit(formatted.status ?? 1);
console.info('BASE-11·GRID-21·PLUG-02 추적 문서 자동 갱신 완료');
