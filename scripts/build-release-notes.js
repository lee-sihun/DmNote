// 릴리즈 본문 생성 — macOS·Windows 워크플로가 공통으로 사용
//
// macOS와 Windows workflow는 같은 태그에 대해 병렬로 실행되고, 먼저 도착한 쪽이
// `gh release create --notes-file`로 본문을 확정한다. 두 workflow가 각자 템플릿을
// 들고 있으면 한쪽만 수정했을 때 본문이 실행마다 달라지므로 여기 한 곳에서만 만든다.
//
// 본문은 버전 문자열만으로 결정된다. 체인지로그 파일을 읽지 않으며,
// 앵커는 버전에서 점을 제거해 계산한다 (2.0.1 -> #201).

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`::error::버전 형식이 X.Y.Z가 아님: ${version ?? '(없음)'}`);
  process.exit(1);
}

const anchor = version.replace(/\./g, '');
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const repository = process.env.GITHUB_REPOSITORY || 'DmNote-App/DmNote';
const repoUrl = `${serverUrl}/${repository}`;

process.stdout.write(
  `## 변경 내역

[한국어](${repoUrl}/blob/main/CHANGELOG.md#${anchor}) · [English](${repoUrl}/blob/main/CHANGELOG_en.md#${anchor})

## 다운로드

| 플랫폼 | 파일 | 용도 |
| --- | --- | --- |
| Windows | \`DM.NOTE.v.${version}.zip\` | 에셋 포함 |
| Windows | \`DM.NOTE.exe\` | 에셋 미포함 |
| macOS | \`DM.NOTE_${version}_universal.dmg\` | Intel · Apple Silicon 공용 |

- 리눅스 환경이라면 [커뮤니티 포크 버전](https://github.com/northernorca/DmNote)을 사용해 보는 걸 추천합니다.
- Windows builds include the Steinberg ASIO SDK (GPLv3) · [Third-party notices](${repoUrl}/blob/main/THIRD_PARTY_NOTICES.txt) · ASIO is a trademark of Steinberg Media Technologies GmbH.
`,
);
