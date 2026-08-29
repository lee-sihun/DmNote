// 릴리즈 본문 생성 로직 (공용)
//
// 진입점은 둘이다.
// - scripts/build-release-notes.js  : 릴리즈 workflow가 신규 릴리즈 본문을 만들 때
// - scripts/refresh-release-notes.js: 이미 만들어진 릴리즈 본문을 다시 쓸 때
// 두 진입점이 각자 템플릿을 들고 있으면 본문이 갈라지므로 여기서만 만든다.

const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.resolve(__dirname, '../../CHANGELOG.md');
const CHANGELOG_EN_PATH = path.resolve(__dirname, '../../CHANGELOG_en.md');

// 링크 텍스트가 @handle이고 대상이 같은 handle의 프로필인 형태.
// 체인지로그 생성 시 기계적으로 만들어지므로 표기가 흔들리지 않는다.
const HANDLE_LINK = /\[@([\w-]+)\]\(https:\/\/github\.com\/\1\)/g;

const isVersion = (value) => /^\d+\.\d+\.\d+$/.test(value ?? '');

const anchorOf = (version) => version.replace(/\./g, '');

// 세그먼트를 숫자로 비교 (문자열 비교는 1.10.0 < 1.6.1로 뒤집힌다)
const compareVersions = (a, b) => {
  const [left, right] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
};

const repoUrlOf = () => {
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repository = process.env.GITHUB_REPOSITORY || 'DmNote-App/DmNote';
  return `${server}/${repository}`;
};

// 신규 릴리즈가 첨부할 자산. 릴리즈 생성 시점에는 아직 업로드 전이라 실제 목록을 못 읽는다
const expectedAssets = (version) => [
  `DM.NOTE.v.${version}.zip`,
  'DM.NOTE.exe',
  `DM.NOTE_${version}_universal.dmg`,
];

const describeAsset = (name) => {
  if (/^DM\.NOTE\.v\..*\.zip$/.test(name))
    return { platform: 'Windows', use: '에셋 포함' };
  if (name === 'DM.NOTE.exe')
    return { platform: 'Windows', use: '에셋 미포함' };
  if (/_universal\.dmg$/.test(name))
    return { platform: 'macOS', use: 'Intel · Apple Silicon 공용' };
  if (/_aarch64\.dmg$/.test(name))
    return { platform: 'macOS', use: 'Apple Silicon' };
  if (/_x64\.dmg$/.test(name)) return { platform: 'macOS', use: 'Intel' };
  return null;
};

const readSection = (filePath, version) => {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    // 체인지로그를 못 읽는다고 릴리즈 빌드를 죽이지 않는다.
    // 이 지점은 macOS에서 서명·공증이 모두 끝난 뒤라 실패 비용이 크다
    return null;
  }
  const sections = text.split(/^## /m).slice(1);
  return sections.find((section) => section.startsWith(`[${version}]`)) ?? null;
};

// 해당 버전 섹션에서 기여자 크레딧 줄을 그대로 가져오되 handle 링크만 @멘션으로 바꾼다.
// 릴리즈 본문에서는 @멘션이 프로필 링크로 렌더되지만 blob 마크다운에서는 되지 않기 때문에,
// 체인지로그는 링크 형태로 두고 본문으로 옮길 때만 멘션으로 되돌린다.
const readContributors = (version, changelogPath = CHANGELOG_PATH) => {
  const section = readSection(changelogPath, version);
  if (!section) return [];

  return section
    .split('\n')
    .filter((line) => {
      if (line.startsWith('#')) return false;
      return new RegExp(HANDLE_LINK.source).test(line) || /🎉|🙏/.test(line);
    })
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s*/, '')
        .replace(HANDLE_LINK, '@$1'),
    )
    .filter(Boolean);
};

const hasEnglishChangelog = (version) =>
  readSection(CHANGELOG_EN_PATH, version) !== null;

const buildReleaseNotes = ({ version, assets, contributors }) => {
  if (!isVersion(version))
    throw new Error(`버전 형식이 X.Y.Z가 아님: ${version}`);

  const anchor = anchorOf(version);
  const repoUrl = repoUrlOf();

  const rows = assets.map((name) => {
    const described = describeAsset(name);
    if (!described) throw new Error(`분류되지 않은 자산: ${version} / ${name}`);
    return { name, ...described };
  });
  // Windows 먼저, 그 안에서는 신규 설치용 ZIP 먼저
  const weight = (row) =>
    (row.platform === 'Windows' ? 0 : 10) + (row.use === '에셋 미포함' ? 1 : 0);
  rows.sort((a, b) => weight(a) - weight(b));

  const hasWindows = rows.some((row) => row.platform === 'Windows');
  const hasMac = rows.some((row) => row.platform === 'macOS');
  const older = (target) => compareVersions(version, target) < 0;

  const changelogLine = hasEnglishChangelog(version)
    ? `[한국어](${repoUrl}/blob/main/CHANGELOG.md#${anchor}) · [English](${repoUrl}/blob/main/CHANGELOG_en.md#${anchor})`
    : `[전체 변경 내역](${repoUrl}/blob/main/CHANGELOG.md#${anchor})`;

  const lines = [
    '## 변경 내역',
    '',
    changelogLine,
    '',
    '## 다운로드',
    '',
    '| 플랫폼 | 파일 | 용도 |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.platform} | \`${row.name}\` | ${row.use} |`),
    '',
  ];

  const notes = [];
  // 2.0.0부터 서명·공증되어 xattr 우회가 불필요 — 그 이전 macOS 자산에만 가이드를 남긴다
  if (hasMac && older('2.0.0')) {
    notes.push(
      `- [macOS 설치 및 권한 설정 가이드](${repoUrl}/blob/main/docs/mac_guide.md)`,
    );
  }
  // 리눅스 포크 안내는 1.5.1 본문부터 실렸다
  if (!older('1.5.1')) {
    notes.push(
      '- 리눅스 환경이라면 [커뮤니티 포크 버전](https://github.com/northernorca/DmNote)을 사용해 보는 걸 추천합니다.',
    );
  }
  // ASIO SDK는 1.6.1 Windows 빌드부터 포함된다
  if (hasWindows && !older('1.6.1')) {
    notes.push(
      `- Windows builds include the Steinberg ASIO SDK (GPLv3) · [Third-party notices](${repoUrl}/blob/main/THIRD_PARTY_NOTICES.txt) · ASIO is a trademark of Steinberg Media Technologies GmbH.`,
    );
  }
  lines.push(...notes, '');

  // 기여자는 마지막 섹션. 앞의 안내 목록과 헤딩으로 분리되지 않으면
  // 마크다운이 두 목록을 하나로 합쳐 안내 문구가 기여자 항목처럼 보인다
  if (contributors.length) {
    lines.push('## 기여자', '', ...contributors.map((line) => `- ${line}`), '');
  }

  return lines.join('\n');
};

module.exports = {
  buildReleaseNotes,
  readContributors,
  hasEnglishChangelog,
  expectedAssets,
  isVersion,
};
