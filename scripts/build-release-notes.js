// 릴리즈 본문 생성 — macOS·Windows 워크플로가 공통으로 사용
//
// macOS와 Windows workflow는 같은 태그에 대해 병렬로 실행되고, 먼저 도착한 쪽이
// `gh release create --notes-file`로 본문을 확정한다. 두 workflow가 각자 템플릿을
// 들고 있으면 한쪽만 수정했을 때 본문이 실행마다 달라지므로 본문 생성은
// scripts/lib/release-notes.js 한 곳에서만 한다.
//
// 기여자 섹션은 CHANGELOG.md의 해당 버전 섹션에서 추출한다. 파일이나 섹션이 없으면
// 기여자 줄만 생략하고 정상 종료한다 — 체인지로그 때문에 릴리즈 빌드가 죽지 않는다.
//
// 릴리즈 후에 크레딧을 추가했다면 scripts/refresh-release-notes.js로 본문을 다시 쓴다.

const {
  buildReleaseNotes,
  readContributors,
  hasEnglishChangelog,
  expectedAssets,
  isVersion,
} = require('./lib/release-notes');

const version = process.argv[2];

if (!isVersion(version)) {
  console.error(`::error::버전 형식이 X.Y.Z가 아님: ${version ?? '(없음)'}`);
  process.exit(1);
}

// 본문은 draft 생성 시 한 번만 기록되므로 나중에 영문을 추가해도 반영되지 않는다.
// stdout은 본문 전용이라 경고는 stderr로 (workflow 로그에 애노테이션으로 뜬다)
if (!hasEnglishChangelog(version)) {
  console.error(
    `::warning::CHANGELOG_en.md에 ${version} 섹션이 없어 영문 링크를 생략함 —` +
      ' 추가 후 scripts/refresh-release-notes.js로 본문을 다시 쓸 것',
  );
}

process.stdout.write(
  buildReleaseNotes({
    version,
    assets: expectedAssets(version),
    contributors: readContributors(version),
  }),
);
