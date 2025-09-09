"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");

const DEBUG = true;

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function uniqueSubdir(base, name) {
  let dir = path.join(base, name);
  let n = 1;
  while (fs.existsSync(dir)) {
    // 비어있는 기존 폴더면 재사용
    try {
      const entries = fs.readdirSync(dir);
      if (!entries || entries.length === 0) break;
    } catch {}
    dir = path.join(base, `${name}-${n}`);
    n++;
  }
  ensureDirSync(dir);
  return dir;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function sanitizeName(s) {
  return String(s ?? "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function ffmpegExtractSingle({ videoPath, tsMs, outPath }) {
  return new Promise((resolve, reject) => {
    // 정확도 우선: -ss 를 -i 뒤에 배치
    const args = [
      "-y",
      "-i",
      videoPath,
      "-ss",
      (Math.max(0, tsMs) / 1000).toFixed(3),
      "-frames:v",
      "1",
      "-loglevel",
      "error",
      outPath,
    ];

    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    let errBuf = "";
    child.stderr.on("data", (d) => {
      errBuf += d.toString("utf8");
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`ffmpeg shot failed (code=${code}) ${errBuf}`));
    });
  });
}

/**
 * events.json 또는 meta.json(events 포함) 기반으로 프레임 추출
 * @param {{ outDir: string, videoPath?: string, onlyDown?: boolean }} param0
 */
async function extractFramesForOutDir({ outDir, videoPath, onlyDown = true }) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error(`ffmpeg not found: ${ffmpegPath}`);
  }
  if (!outDir || !fs.existsSync(outDir)) {
    throw new Error(`outDir not found: ${outDir}`);
  }

  const metaPath = path.join(outDir, "meta.json");
  const eventsPath = path.join(outDir, "events.json");
  const meta = readJsonSafe(metaPath) || {};
  const durationMs = Number(meta.durationMs ?? 0);
  const vPath = videoPath || meta.videoPath;

  if (!vPath || !fs.existsSync(vPath)) {
    throw new Error(`video file not found: ${vPath}`);
  }

  // shots 폴더를 먼저 만들어 사용자에게 진행상황이 보이도록 함
  const shotsDir = uniqueSubdir(outDir, "frames");

  // 이벤트 읽기: events.json 우선, 없으면 meta.events
  let events = [];
  const evJson = readJsonSafe(eventsPath);
  if (evJson) {
    // overlay payload 구조 호환 (payload 자체가 {startedAt, duration, events} or 배열)
    events = Array.isArray(evJson) ? evJson : evJson.events || [];
  } else if (Array.isArray(meta.events)) {
    events = meta.events;
  }

  // 이벤트가 없는 경우에도 index.json을 남기고 종료
  if (!events || events.length === 0) {
    try {
      fs.writeFileSync(
        path.join(shotsDir, "index.json"),
        JSON.stringify(
          {
            version: 1,
            count: 0,
            reason: "no_events",
            video: path.basename(vPath),
            meta: path.basename(metaPath),
            events: path.basename(eventsPath),
            framesDir: path.basename(shotsDir),
            frames: [],
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {}
    if (DEBUG) console.log("[frames] no events found, wrote empty index.", { outDir, shotsDir });
    return { shotsDir, count: 0, reason: "no_events" };
  }

  // 요청사항: 키 "눌렀을때" 장면. state === 'down' 우선 필터
  const filtered = onlyDown ? events.filter((e) => e?.state === "down") : events.slice();
  if (filtered.length === 0) {
    if (DEBUG) console.log("[frames] no 'down' events, fallback to all events.", { outDir });
  }
  const targets = filtered.length > 0 ? filtered : events;

  const index = [];
  let i = 0;

  for (const ev of targets) {
    const ts = Number(ev?.timestamp ?? ev?.ts ?? 0);
    // 비정상 값 가드
    let safeTs = Math.max(0, ts);
    if (durationMs > 0) {
      // 마지막 프레임 근처 클램프
      safeTs = Math.min(safeTs, Math.max(0, durationMs - 1));
    }

    const fileName = [
      "frame",
      String(i + 1).padStart(4, "0"),
      sanitizeName(ev?.key ?? "key"),
      sanitizeName(ev?.state ?? "down"),
      `${Math.round(safeTs)}ms`,
    ].join("-") + ".png";

    const outPath = path.join(shotsDir, fileName);

    try {
      // 순차 처리(간단/안전). 후속 최적화 여지 있음.
      await ffmpegExtractSingle({ videoPath: vPath, tsMs: safeTs, outPath });
      index.push({
        index: i + 1,
        key: ev?.key ?? null,
        state: ev?.state ?? null,
        timestampMs: Math.round(safeTs),
        file: fileName,
      });
      if (DEBUG && (i + 1) % 20 === 0) {
        console.log(`[frames] progress ${i + 1}/${targets.length}...`);
      }
    } catch (err) {
      if (DEBUG) {
        console.error("[frames] extract failed", { i, event: ev, err: err?.message });
      }
      // 실패 케이스도 인덱스에 기록(파일 없음)
      index.push({
        index: i + 1,
        key: ev?.key ?? null,
        state: ev?.state ?? null,
        timestampMs: Math.round(safeTs),
        file: fileName,
        error: err?.message || String(err),
      });
    }

    i++;
  }

  // 인덱스 저장
  try {
    fs.writeFileSync(
      path.join(shotsDir, "index.json"),
      JSON.stringify(
        {
          version: 1,
          count: index.length,
          video: path.basename(vPath),
          meta: path.basename(metaPath),
          events: path.basename(eventsPath),
          framesDir: path.basename(shotsDir),
          frames: index,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {}

  if (DEBUG) {
    console.log("[frames] done", { outDir, shotsDir, count: index.length });
  }
  return { shotsDir, count: index.length };
}

module.exports = {
  extractFramesForOutDir,
};