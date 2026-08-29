// 이미 publish된 릴리즈의 본문을 CHANGELOG.md 기준으로 다시 쓴다.
//
// 릴리즈 본문은 draft를 처음 만든 workflow가 한 번만 기록하므로, 릴리즈 후에
// 체인지로그에 기여자 크레딧을 추가하면 본문에는 반영되지 않는다. 그때 이 스크립트를 쓴다.
// 자산 표는 실제로 첨부된 자산을 GitHub API로 읽어 만들기 때문에 자산 구성이
// 달랐던 과거 릴리즈에도 그대로 쓸 수 있다.
//
//   node scripts/refresh-release-notes.js 2.0.2          # 미리보기 (기본)
//   node scripts/refresh-release-notes.js 2.0.2 --apply  # 실제 반영
//   node scripts/refresh-release-notes.js --all --apply  # 전체 릴리즈 반영

const { execFileSync } = require('child_process');
const {
  buildReleaseNotes,
  readContributors,
  isVersion,
} = require('./lib/release-notes');

const REPO = process.env.GITHUB_REPOSITORY || 'DmNote-App/DmNote';

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

const listVersions = () =>
  JSON.parse(
    gh([
      'release',
      'list',
      '-R',
      REPO,
      // 진행 중인 draft는 자산이 일부만 올라와 있어 표가 잘못 만들어진다
      '--exclude-drafts',
      '--limit',
      '200',
      '--json',
      'tagName',
    ]),
  )
    .map((release) => release.tagName)
    .filter(isVersion)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

const assetsOf = (version) =>
  JSON.parse(
    gh([
      'release',
      'view',
      version,
      '-R',
      REPO,
      '--json',
      'assets',
      '-q',
      '[.assets[].name]',
    ]),
  );

const liveBodyOf = (version) =>
  gh(['release', 'view', version, '-R', REPO, '--json', 'body', '-q', '.body'])
    .replace(/\r/g, '')
    .trim();

// 본문이 20줄 안팎이라 LCS 전체 테이블로 충분하다
const diffLines = (before, after) => {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push(['keep', a[i]]);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push(['del', a[i]]);
      i += 1;
    } else {
      rows.push(['add', b[j]]);
      j += 1;
    }
  }
  while (i < a.length) rows.push(['del', a[i++]]);
  while (j < b.length) rows.push(['add', b[j++]]);

  // 변경 지점에서 먼 문맥은 접는다
  const near = rows.map((_, index) =>
    rows.some(
      (row, other) => row[0] !== 'keep' && Math.abs(other - index) <= 2,
    ),
  );
  const out = [];
  let folded = false;
  rows.forEach(([kind, line], index) => {
    if (kind === 'keep' && !near[index]) {
      if (!folded) out.push('  ...');
      folded = true;
      return;
    }
    folded = false;
    out.push(`${{ keep: ' ', del: '-', add: '+' }[kind]} ${line}`);
  });
  return out.join('\n');
};

const args = process.argv.slice(2);
const usage =
  '사용법: refresh-release-notes.js <version...> | --all  [--apply]';

// 오타난 플래그(--aply)를 조용히 무시하면 "적용됐다"고 오해하게 된다
const unknown = args.filter(
  (arg) => arg.startsWith('-') && !['--all', '--apply'].includes(arg),
);
if (unknown.length) {
  console.error(`알 수 없는 옵션: ${unknown.join(', ')}\n${usage}`);
  process.exit(1);
}

const apply = args.includes('--apply');
const all = args.includes('--all');
const explicit = args.filter((arg) => !arg.startsWith('-'));

if (all && explicit.length) {
  console.error(`--all과 버전을 함께 지정할 수 없음: ${explicit.join(', ')}`);
  process.exit(1);
}

const versions = all ? listVersions() : explicit;

if (!versions.length) {
  console.error(usage);
  process.exit(1);
}

const invalid = versions.filter((version) => !isVersion(version));
if (invalid.length) {
  console.error(`버전 형식이 X.Y.Z가 아님: ${invalid.join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const version of versions) {
  try {
    const contributors = readContributors(version);
    const body = buildReleaseNotes({
      version,
      assets: assetsOf(version),
      contributors,
    });
    const live = liveBodyOf(version);

    // GitHub은 릴리즈 본문 이력을 보관하지 않는다. 덮어쓰면 이전 본문은 복구 불가라
    // 무엇을 대체하는지 먼저 보여주고, 바뀔 게 없으면 API 호출도 하지 않는다
    if (live === body.trim()) {
      console.log(`${version.padEnd(7)} 변경 없음`);
      continue;
    }

    if (!apply) {
      console.log(
        `${'='.repeat(16)} ${version} (기여자 ${contributors.length}줄)`,
      );
      console.log(diffLines(live, body.trim()));
      console.log();
      continue;
    }

    // 덮어쓴 본문은 GitHub에 남지 않으므로 무엇을 대체했는지 로컬에 남긴다
    console.error(diffLines(live, body.trim()));
    execFileSync(
      'gh',
      ['release', 'edit', version, '-R', REPO, '--notes-file', '-'],
      {
        input: body,
        stdio: ['pipe', 'ignore', 'inherit'],
      },
    );
    console.log(`${version.padEnd(7)} 반영 (기여자 ${contributors.length}줄)`);
  } catch (error) {
    console.error(`${version.padEnd(7)} 실패: ${error.message.split('\n')[0]}`);
    failed += 1;
  }
}

if (failed) process.exit(1);
