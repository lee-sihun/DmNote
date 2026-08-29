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

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const versions = args.includes('--all')
  ? listVersions()
  : args.filter((arg) => !arg.startsWith('--'));

if (!versions.length) {
  console.error(
    '사용법: refresh-release-notes.js <version...> | --all  [--apply]',
  );
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

    if (!apply) {
      console.log(
        `${'='.repeat(20)} ${version} (기여자 ${
          contributors.length
        }줄) ${'='.repeat(20)}`,
      );
      console.log(body);
      continue;
    }

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
