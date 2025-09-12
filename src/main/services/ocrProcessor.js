"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createWorker, createScheduler } = require("tesseract.js");

const DEBUG = true;

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function trimOCRText(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Build down/up pairs from events timeline
 * - Pairs by key using a stack (supporting overlapping presses)
 * - If some 'down' have no matching 'up', pair with null up/duration
 * @param {Array<{key:string,state:'down'|'up',timestamp:number}>} events
 * @param {Array<{index:number,file:string,text:string,confidence:number, timestampMs:number}>} ocrOfDownEvents
 *        Must be aligned with the order of global 'down' events across all keys
 */
function buildPairs(events, ocrOfDownEvents) {
  const stacks = new Map(); // key -> array of down entries
  const pairs = [];
  let downGlobalIdx = 0;

  for (const ev of events) {
    const k = ev?.key;
    const ts = Number(ev?.timestamp ?? 0);
    if (!k || !Number.isFinite(ts)) continue;

    if (ev.state === "down") {
      // attach OCR of this down (by global order)
      const ocr = ocrOfDownEvents[downGlobalIdx] || null;
      const entry = {
        key: k,
        downTimestampMs: ts,
        ocrText: ocr?.text ?? null,
        ocrConfidence: ocr?.confidence ?? null,
        ocrFrameFile: ocr?.file ?? null,
        ocrFrameIndex: ocr?.index ?? null,
      };
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k).push(entry);
      downGlobalIdx++;
    } else if (ev.state === "up") {
      const st = stacks.get(k);
      if (st && st.length > 0) {
        const entry = st.pop();
        const upTs = ts;
        pairs.push({
          key: k,
          downTimestampMs: entry.downTimestampMs,
          upTimestampMs: upTs,
          durationMs:
            Number.isFinite(upTs) && Number.isFinite(entry.downTimestampMs)
              ? Math.max(0, upTs - entry.downTimestampMs)
              : null,
          ocrText: entry.ocrText,
          ocrConfidence: entry.ocrConfidence,
          ocrFrameFile: entry.ocrFrameFile,
          ocrFrameIndex: entry.ocrFrameIndex,
        });
      } else {
        // stray up without down; record as incomplete
        pairs.push({
          key: k,
          downTimestampMs: null,
          upTimestampMs: ts,
          durationMs: null,
          ocrText: null,
          ocrConfidence: null,
          ocrFrameFile: null,
          ocrFrameIndex: null,
          warning: "stray_up_without_down",
        });
      }
    }
  }

  // flush remaining downs without up
  for (const [k, st] of stacks.entries()) {
    while (st.length > 0) {
      const entry = st.pop();
      pairs.push({
        key: k,
        downTimestampMs: entry.downTimestampMs,
        upTimestampMs: null,
        durationMs: null,
        ocrText: entry.ocrText,
        ocrConfidence: entry.ocrConfidence,
        ocrFrameFile: entry.ocrFrameFile,
        ocrFrameIndex: entry.ocrFrameIndex,
        warning: "down_without_up",
      });
    }
  }

  // sort by down timestamp (fallback to up)
  pairs.sort((a, b) => {
    const A = Number.isFinite(a.downTimestampMs)
      ? a.downTimestampMs
      : Number.isFinite(a.upTimestampMs)
      ? a.upTimestampMs
      : 0;
    const B = Number.isFinite(b.downTimestampMs)
      ? b.downTimestampMs
      : Number.isFinite(b.upTimestampMs)
      ? b.upTimestampMs
      : 0;
    return A - B;
  });

  return pairs;
}

/**
 * OCR over frames index with concurrency
 * @param {{ outDir:string, shotsDir:string, lang?:string, whitelist?:string, concurrency?:number, onStart?:Function, onProgress?:Function }} opts
 * @returns Promise<{ shotsDir:string, results:Array<{index:number,file:string,key:string,state:string,timestampMs:number,text:string,confidence:number}>, ocrPath:string }>
 */
async function runOCROverFrames(opts) {
  const {
    outDir,
    shotsDir,
    lang = "eng",
    whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    concurrency,
    onStart,
    onProgress,
  } = opts || {};

  const indexPath = path.join(shotsDir, "index.json");
  const index = readJsonSafe(indexPath);
  if (!index || !Array.isArray(index.frames)) {
    throw new Error(`Invalid frames index: ${indexPath}`);
  }

  const frames = index.frames.slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  const total = frames.length;

  try {
    onStart && onStart({ total, outDir, shotsDir });
  } catch {}

  const cpu = (os.cpus && os.cpus()) ? os.cpus().length : 4;
  const limit = Math.max(2, Math.min(8, Number.isFinite(concurrency) ? concurrency : Math.max(2, cpu - 1)));

  if (DEBUG) console.log("[ocr] scheduler start", { limit, total, shotsDir });

  const scheduler = createScheduler();
  const workers = [];

  // create workers (Tesseract.js v5+: pass lang into createWorker; loadLanguage/initialize not required)
  for (let i = 0; i < limit; i++) {
    const worker = await createWorker(lang);
    if (typeof worker.setParameters === "function") {
      await worker.setParameters({
        tessedit_char_whitelist: whitelist,
        tessedit_pageseg_mode: "7", // treat as a single text line/word
        preserve_interword_spaces: "1",
      });
    }
    scheduler.addWorker(worker);
    workers.push(worker);
  }

  let completed = 0;
  const results = new Array(total);

  await Promise.all(
    frames.map((fr, idx) =>
      scheduler
        .addJob("recognize", path.join(shotsDir, fr.file))
        .then((res) => {
          const text = trimOCRText(res?.data?.text || "");
          const conf = Number(res?.data?.confidence ?? 0);
          results[idx] = {
            index: fr.index,
            file: fr.file,
            key: fr.key ?? null,
            state: fr.state ?? null,
            timestampMs: Number(fr.timestampMs ?? 0),
            text,
            confidence: conf,
          };
        })
        .catch((err) => {
          if (DEBUG) console.error("[ocr] recognize failed", fr.file, err?.message);
          results[idx] = {
            index: fr.index,
            file: fr.file,
            key: fr.key ?? null,
            state: fr.state ?? null,
            timestampMs: Number(fr.timestampMs ?? 0),
            text: "",
            confidence: 0,
            error: err?.message || String(err),
          };
        })
        .finally(() => {
          completed++;
          try {
            onProgress && onProgress({ completed, total, outDir, shotsDir });
          } catch {}
        })
    )
  );

  await scheduler.terminate();

  // save ocr.json
  const ocrPath = path.join(outDir, "ocr.json");
  try {
    fs.writeFileSync(
      ocrPath,
      JSON.stringify(
        {
          version: 1,
          outDir,
          shotsDir,
          total,
          results,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    if (DEBUG) console.error("[ocr] failed to write ocr.json", err?.message);
  }

  if (DEBUG) console.log("[ocr] done", { outDir, shotsDir, total });

  return { shotsDir, results, ocrPath };
}

/**
 * Full pipeline: OCR frames and pair with key down/up durations
 * Produces:
 *  - ocr.json: OCR result per frame
 *  - analysis.json: paired down/up with duration and OCR text
 *
 * @param {{ outDir:string, shotsDir:string, lang?:string, whitelist?:string, concurrency?:number, onStart?:Function, onProgress?:Function }} options
 * @returns Promise<{ ocrPath:string, analysisPath:string, pairs:Array }>
 */
async function processFramesAndPair(options) {
  const { outDir, shotsDir, lang, whitelist, concurrency, onStart, onProgress } = options || {};
  if (!outDir || !shotsDir) throw new Error("outDir and shotsDir are required");

  const metaPath = path.join(outDir, "meta.json");
  const eventsPath = path.join(outDir, "events.json");
  const meta = readJsonSafe(metaPath) || {};
  const evJson = readJsonSafe(eventsPath);
  // overlay writes events as payload.events
  const events = Array.isArray(evJson)
    ? evJson
    : Array.isArray(evJson?.events)
    ? evJson.events
    : Array.isArray(meta?.events)
    ? meta.events
    : [];

  const { results, ocrPath } = await runOCROverFrames({
    outDir,
    shotsDir,
    lang,
    whitelist,
    concurrency,
    onStart,
    onProgress,
  });

  // Build mapping down events (global order) -> OCR results (results sorted by index)
  const downEvents = events.filter((e) => e?.state === "down");
  const ocrSorted = results.slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  const alignedOCR = [];

  for (let i = 0; i < downEvents.length; i++) {
    alignedOCR[i] = {
      index: ocrSorted[i]?.index ?? i + 1,
      file: ocrSorted[i]?.file ?? null,
      text: ocrSorted[i]?.text ?? "",
      confidence: ocrSorted[i]?.confidence ?? 0,
      timestampMs: Number(downEvents[i]?.timestamp ?? 0),
    };
  }

  const pairs = buildPairs(events, alignedOCR);

  const analysisPath = path.join(outDir, "analysis.json");
  try {
    fs.writeFileSync(
      analysisPath,
      JSON.stringify(
        {
          version: 1,
          outDir,
          shotsDir,
          summary: {
            totalEvents: events.length,
            totalDown: downEvents.length,
            totalPairs: pairs.length,
          },
          pairs,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    if (DEBUG) console.error("[ocr] failed to write analysis.json", err?.message);
  }

  return { ocrPath, analysisPath, pairs };
}

module.exports = {
  processFramesAndPair,
};