"use strict";

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");

let child = null;
let session = null;

// 간단한 내부 로깅 토글 (필요 시 true)
const DEBUG = true;

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isoSafeNow() {
  return new Date().toISOString().replace(/[:]/g, "-");
}

function defaultOutDir() {
  const base = path.join(
    app.getPath("documents"),
    "djmax-keyviewer",
    "recordings",
    isoSafeNow()
  );
  ensureDirSync(base);
  return base;
}

function buildArgs({
  x,
  y,
  width,
  height,
  // scale720: true 일 때만 1280x720 으로 스케일 (기본: 원본 크기 그대로)
  scale720 = false,
  showRegion = false,
  outPath,
}) {
  // x264 yuv420p 인코딩 시 짝수 해상도 권장 → 홀수면 내림하여 짝수로 맞춤
  const safeWidth = Math.max(2, Math.floor((width || 2) / 2) * 2);
  const safeHeight = Math.max(2, Math.floor((height || 2) / 2) * 2);

  const args = [
    "-y",
    "-f",
    "gdigrab",
    "-framerate",
    "30",
    "-offset_x",
    String(Math.max(0, Math.floor(x || 0))),
    "-offset_y",
    String(Math.max(0, Math.floor(y || 0))),
    "-video_size",
    `${safeWidth}x${safeHeight}`,
    "-draw_mouse",
    "0",
  ];
  if (showRegion) {
    args.push("-show_region", "1");
  }
  args.push("-i", "desktop");

  // Filters: enforce CFR@30, and optionally scale to 720p
  const vf = scale720 ? "fps=30,scale=1280:720:flags=spline" : "fps=30";
  args.push("-vf", vf);

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-vsync",
    "cfr",
    "-r",
    "30",
    outPath
  );
  return args;
}

function isActive() {
  return !!child;
}

function getSession() {
  return session;
}

function startRecording(options = {}) {
  if (child) {
    throw new Error("ROI recording is already running");
  }
  const {
    x = 0,
    y = 0,
    width = 1280,
    height = 720,
    outDir = null,
    fileName = "video.mp4",
    // 기본값: 더 이상 강제 720p 스케일 하지 않음
    scale720 = false,
    showRegion = false,
  } = options;

  const baseDir = outDir || defaultOutDir();
  ensureDirSync(baseDir);
  const videoPath = path.join(baseDir, fileName);
  const stderrLogPath = path.join(baseDir, "ffmpeg.log");

  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error(`ffmpeg 실행 파일을 찾을 수 없습니다: ${ffmpegPath}`);
  }

  const args = buildArgs({
    x,
    y,
    width,
    height,
    scale720,
    showRegion,
    outPath: videoPath,
  });

  const startedAt = Date.now();

  const logStream = fs.createWriteStream(stderrLogPath, { flags: "a" });

  child = spawn(ffmpegPath, args, {
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });

  if (DEBUG) {
    console.log("[roi] startRecording()", {
      baseDir,
      videoPath,
      ffmpegPath,
      args: args.join(" "),
    });
  }

  child.stderr.on("data", (d) => {
    logStream.write(d);
  });

  child.on("error", (err) => {
    logStream.write(`\n[spawn-error] ${err?.stack || err?.message}\n`);
    if (DEBUG) console.error("[roi] spawn-error", err);
  });

  child.on("close", (code, signal) => {
    logStream.write(`\n[closed] code=${code} signal=${signal}\n`);
    logStream.end();
    child = null;
    if (DEBUG)
      console.log("[roi] closed", {
        code,
        signal,
        videoPathExists: fs.existsSync(videoPath),
      });
  });

  session = {
    id: `${startedAt}`,
    startedAt,
    roi: { x, y, width, height },
    outDir: baseDir,
    videoPath,
    stderrLogPath,
    ffmpegPath,
    args,
  };

  return { success: true, ...session };
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!child) {
      return resolve({ success: false, error: "NOT_RUNNING", session });
    }
    const toStop = child;
    const startedAt = session?.startedAt || Date.now();
    let resolved = false;

    const finish = (status) => {
      if (resolved) return;
      resolved = true;
      const durationMs = Date.now() - startedAt;
      const meta = {
        startedAt: new Date(startedAt).toISOString(),
        durationMs,
        roi: session?.roi,
        outDir: session?.outDir,
        videoPath: session?.videoPath,
        ffmpegArgs: session?.args,
        ffmpegPath: session?.ffmpegPath,
        stderrLogPath: session?.stderrLogPath,
        appVersion: require("../../../package.json").version,
        type: "roi-recording",
      };
      try {
        fs.writeFileSync(
          path.join(session.outDir, "meta.json"),
          JSON.stringify(meta, null, 2),
          "utf8"
        );
      } catch {}
      resolve({
        success: true,
        code: status?.code,
        signal: status?.signal,
        metaPath: path.join(session.outDir, "meta.json"),
        session,
      });
    };

    toStop.once("close", (code, signal) => finish({ code, signal }));

    // Try graceful stop
    try {
      toStop.stdin.write("q");
      toStop.stdin.end();
    } catch {
      try {
        if (process.platform === "win32") {
          toStop.kill("SIGINT");
        } else {
          toStop.kill("SIGTERM");
        }
      } catch {}
    }

    // Fallback hard kill if it hangs
    setTimeout(() => {
      if (toStop.exitCode == null) {
        try {
          toStop.kill("SIGKILL");
        } catch {}
      }
    }, 1500);
  });
}

function debugInfo() {
  let documentsPath = "";
  try {
    documentsPath = app.getPath("documents");
  } catch {}
  return {
    documentsPath,
    defaultRecordingsRoot: path.join(
      documentsPath || "",
      "djmax-keyviewer",
      "recordings"
    ),
    ffmpegPath,
    ffmpegExists: !!ffmpegPath && fs.existsSync(ffmpegPath),
    isActive: !!child,
    session: session
      ? {
          ...session,
          outDirExists: fs.existsSync(session.outDir || ""),
          videoExists: fs.existsSync(session.videoPath || ""),
          stderrLogExists: fs.existsSync(session.stderrLogPath || ""),
        }
      : null,
  };
}

module.exports = {
  startRecording,
  stopRecording,
  isActive,
  getSession,
  debugInfo,
};
