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

function run(command, options = {}) {
  execSync(command, { stdio: "inherit", shell: true, ...options });
}

function main() {
  if (process.platform !== "win32") {
    throw new Error("This script is intended for Windows single-exe builds.");
  }

  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      [
        "Usage: node scripts/build-single-exe-win.js [options]",
        "",
        "Options:",
        "  --major <143>          WebView2 Fixed runtime major (default: 143)",
        "  --arch <x64|x86|arm64> WebView2 runtime arch (default: x64)",
        "  --out <dir>            Output dir (default: dist/single-exe)",
        "  --name <file.exe>      Output exe filename (default: DM.NOTE.v.<ver>.single.win-<arch>.exe)",
        "",
      ].join("\n")
    );
    return;
  }

  const major = String(args.major ?? "143");
  const arch = String(args.arch ?? "x64");

  const repoRoot = path.resolve(__dirname, "..");
  const pkg = readJson(path.join(repoRoot, "package.json"));
  const version = String(pkg.version ?? "0.0.0");

  const outDir = path.resolve(args.out ?? path.join(repoRoot, "dist", "single-exe"));
  fs.mkdirSync(outDir, { recursive: true });

  const defaultName = `DM.NOTE.v.${version}.single.win-${arch}.exe`;
  const outName = String(args.name ?? defaultName);
  const outPath = path.join(outDir, outName);

  // 1) Download fixed WebView2 runtime into src-tauri/webview2-fixed-runtime
  run(
    `node "${path.join(
      repoRoot,
      "scripts",
      "download-webview2-fixed-runtime.js"
    )}" --major ${major} --arch ${arch}`
  );

  const embeddedVersionFile = path.join(
    repoRoot,
    "src-tauri",
    "webview2-fixed-runtime",
    "dmnote-webview2-fixed-runtime-version.txt"
  );
  const embeddedVersion = fs.existsSync(embeddedVersionFile)
    ? String(fs.readFileSync(embeddedVersionFile, "utf8")).trim().split(/\r?\n/)[0]
    : `${major}.x`;

  // 2) Build binary only, embedding the fixed runtime zip into the exe (huge output).
  const buildEnv = {
    ...process.env,
    DMNOTE_EMBED_WEBVIEW2_FIXED_RUNTIME: "1",
    DMNOTE_WEBVIEW2_ARCH: arch,
  };
  run("npx tauri build --no-bundle -f asio-backend", { cwd: repoRoot, env: buildEnv });

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

  fs.copyFileSync(exeSrc, outPath);
  console.log(`[single-exe] output: ${outPath}`);
  console.log(
    `[single-exe] first run extracts WebView2 Fixed runtime to %LOCALAPPDATA%\\com.dmnote.desktop\\webview2-fixed-runtime\\${embeddedVersion}-${arch}`
  );
}

try {
  main();
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
