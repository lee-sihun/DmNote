const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const edgeBetaPath =
  "C:\\Program Files (x86)\\Microsoft\\Edge Beta\\Application";

try {
  // Edge Beta 폴더가 존재하는지 확인
  if (!fs.existsSync(edgeBetaPath)) {
    console.error("Edge Beta가 설치되지 않았습니다.");
    process.exit(1);
  }

  // 버전 폴더 찾기 (숫자로 시작하는 폴더)
  const folders = fs.readdirSync(edgeBetaPath);
  const versionFolders = folders.filter((folder) => {
    const folderPath = path.join(edgeBetaPath, folder);
    return (
      fs.statSync(folderPath).isDirectory() &&
      /^\d+\.\d+\.\d+\.\d+$/.test(folder)
    );
  });

  if (versionFolders.length === 0) {
    console.error("Edge Beta 버전 폴더를 찾을 수 없습니다.");
    process.exit(1);
  }

  // 최신 버전 선택 (정렬 후 마지막 요소)
  const latestVersion = versionFolders
    .sort((a, b) => {
      const aParts = a.split(".").map(Number);
      const bParts = b.split(".").map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    })
    .pop();

  const webview2Path = path.join(edgeBetaPath, latestVersion);
  console.log(`Edge Beta WebView2 경로: ${webview2Path}`);

  // 환경 변수 설정하고 tauri dev 실행
  process.env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = webview2Path;

  execSync("tauri dev -f asio-backend", {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
} catch (error) {
  console.error("실행 중 오류 발생:", error.message);
  process.exit(1);
}
