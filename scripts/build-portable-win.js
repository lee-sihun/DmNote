const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    if (value !== undefined) {
      args[key] = value;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureEmptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, options = {}) {
  execSync(command, { stdio: "inherit", shell: true, ...options });
}

function compressFolderToZip(folderPath, zipPath) {
  const folder = folderPath.replace(/'/g, "''");
  const zip = zipPath.replace(/'/g, "''");
  run(
    `powershell -NoProfile -Command "if (Test-Path '${zip}') { Remove-Item -Force '${zip}' }; Compress-Archive -Path '${folder}' -DestinationPath '${zip}' -Force"`
  );
}

function main() {
  if (process.platform !== "win32") {
    throw new Error("This script is intended for Windows portable builds.");
  }

  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      [
        "Usage: node scripts/build-portable-win.js [options]",
        "",
        "Options:",
        "  --major <143>          WebView2 Fixed runtime major (default: 143)",
        "  --arch <x64|x86|arm64> WebView2 runtime arch (default: x64)",
        "  --exe-name <name>      Output exe name (default: DM Note.exe)",
        "  --out <dir>            Output root dir (default: dist/portable)",
        "  --folder <name>        Output folder name (default: DM.NOTE.v.<ver>.portable.win-<arch>)",
        "",
      ].join("\n")
    );
    return;
  }
  const major = String(args.major ?? "143");
  const arch = String(args.arch ?? "x64");
  const exeName = String(args["exe-name"] ?? args.exeName ?? "DM Note.exe");

  const repoRoot = path.resolve(__dirname, "..");
  const pkg = readJson(path.join(repoRoot, "package.json"));
  const version = String(pkg.version ?? "0.0.0");

  const outRoot = path.resolve(
    args.out ?? path.join(repoRoot, "dist", "portable")
  );
  const folderName = String(
    args.folder ?? `DM.NOTE.v.${version}.portable.win-${arch}`
  );
  const outDir = path.join(outRoot, folderName);
  const zipPath = path.join(outRoot, `${folderName}.zip`);

  fs.mkdirSync(outRoot, { recursive: true });

  // 1) Download fixed WebView2 runtime into src-tauri/webview2-fixed-runtime
  run(
    `node "${path.join(
      repoRoot,
      "scripts",
      "download-webview2-fixed-runtime.js"
    )}" --major ${major} --arch ${arch}`
  );

  // 2) Build binary only (no installer)
  run("npx tauri build --no-bundle -f asio-backend", {
    cwd: repoRoot,
    env: { ...process.env, CARGO_PROFILE_RELEASE_PANIC: "abort" }
  });

  const exeSrc = path.join(
    repoRoot,
    "src-tauri",
    "target",
    "release",
    "dm-note.exe"
  );
  if (!fs.existsSync(exeSrc)) {
    throw new Error(`Built exe not found: ${exeSrc}`);
  }

  const runtimeSrc = path.join(
    repoRoot,
    "src-tauri",
    "webview2-fixed-runtime"
  );
  const runtimeExe = path.join(runtimeSrc, "msedgewebview2.exe");
  if (!fs.existsSync(runtimeExe)) {
    throw new Error(
      `Fixed WebView2 runtime missing (expected ${runtimeExe}). Run the download step first.`
    );
  }

  // 3) Stage portable folder
  ensureEmptyDir(outDir);
  fs.copyFileSync(exeSrc, path.join(outDir, exeName));
  fs.cpSync(runtimeSrc, path.join(outDir, "webview2-fixed-runtime"), {
    recursive: true,
  });
  // ASIO SDK(BSD 3-clause) 이진 재배포 고지 동봉
  fs.copyFileSync(
    path.join(repoRoot, "THIRD_PARTY_NOTICES.txt"),
    path.join(outDir, "THIRD_PARTY_NOTICES.txt")
  );

  // 4) Zip
  compressFolderToZip(outDir, zipPath);

  console.log(`[portable] folder: ${outDir}`);
  console.log(`[portable] zip:    ${zipPath}`);
}

try {
  main();
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
