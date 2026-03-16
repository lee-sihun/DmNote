import argparse
import json
import os
import sys
import time
from pathlib import Path
import threading

import frida


HOOKS = [
    {"module": "user32.dll", "function": "EnumWindows", "arg_count": 2, "utf16_args": []},
    {"module": "user32.dll", "function": "CreateWindowExW", "arg_count": 4, "utf16_args": [1, 2]},
    {"module": "user32.dll", "function": "CreateWindowInBand", "arg_count": 5, "utf16_args": [1, 2]},
    {"module": "user32.dll", "function": "CreateWindowInBandEx", "arg_count": 6, "utf16_args": [1, 2]},
    {"module": "user32.dll", "function": "GetAncestor", "arg_count": 2, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "GetWindowRect", "arg_count": 2, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "GetWindowThreadProcessId", "arg_count": 2, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "GetForegroundWindow", "arg_count": 0, "utf16_args": []},
    {"module": "user32.dll", "function": "GetClassNameW", "arg_count": 3, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "GetWindowTextW", "arg_count": 3, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "MonitorFromWindow", "arg_count": 2, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "GetMonitorInfoW", "arg_count": 2, "utf16_args": []},
    {"module": "user32.dll", "function": "QueryDisplayConfig", "arg_count": 5, "utf16_args": []},
    {"module": "user32.dll", "function": "ShowWindow", "arg_count": 2, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "SetWindowPos", "arg_count": 7, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "SetWindowRgn", "arg_count": 3, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "SetWindowLongW", "arg_count": 3, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "SetWindowLongPtrW", "arg_count": 3, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "SetWinEventHook", "arg_count": 7, "utf16_args": []},
    {"module": "user32.dll", "function": "SetParent", "arg_count": 2, "utf16_args": [], "hwnd_args": [0, 1]},
    {"module": "user32.dll", "function": "SetWindowBand", "arg_count": 3, "utf16_args": [], "hwnd_args": [0]},
    {"module": "user32.dll", "function": "GetWindowBand", "arg_count": 2, "utf16_args": [], "hwnd_args": [0]},
    {"module": "dwmapi.dll", "function": "DwmSetWindowAttribute", "arg_count": 4, "utf16_args": [], "hwnd_args": [0]},
    {"module": "dwmapi.dll", "function": "DwmpDxGetWindowSharedSurface", "arg_count": 4, "utf16_args": []},
    {"module": "dxgi.dll", "function": "CreateDXGIFactory1", "arg_count": 2, "utf16_args": []},
    {"module": "dxgi.dll", "function": "CreateDXGIFactory2", "arg_count": 3, "utf16_args": []},
    {"module": "dcomp.dll", "function": "DCompositionCreateDevice", "arg_count": 3, "utf16_args": []},
    {"module": "dcomp.dll", "function": "DCompositionCreateDevice2", "arg_count": 3, "utf16_args": []},
    {"module": "dcomp.dll", "function": "DCompositionCreateDevice3", "arg_count": 3, "utf16_args": []},
    {"module": "dcomp.dll", "function": "DCompositionCreateSurfaceHandle", "arg_count": 4, "utf16_args": []},
    {"module": "coremessaging.dll", "function": "CreateDispatcherQueueController", "arg_count": 2, "utf16_args": []},
    {
        "module": "kernel32.dll",
        "function": "GetProcAddress",
        "arg_count": 2,
        "utf16_args": [],
        "utf8_args": [1],
        "interesting_args": [
            "createwindowinband",
            "setwindowband",
            "getwindowband",
            "dwmpdxgetwindowsharedsurface",
            "dcompositioncreatedevice",
            "dcompositioncreatesurfacehandle",
            "createdxgifactory",
            "setgamingfullscreenexperience",
            "registergamingfullscreenexperiencechangenotification",
        ],
    },
    {
        "module": "kernelbase.dll",
        "function": "GetProcAddress",
        "arg_count": 2,
        "utf16_args": [],
        "utf8_args": [1],
        "interesting_args": [
            "createwindowinband",
            "setwindowband",
            "getwindowband",
            "dwmpdxgetwindowsharedsurface",
            "dcompositioncreatedevice",
            "dcompositioncreatesurfacehandle",
            "createdxgifactory",
            "setgamingfullscreenexperience",
            "registergamingfullscreenexperiencechangenotification",
        ],
    },
    {
        "module": "ntdll.dll",
        "function": "LdrGetProcedureAddress",
        "arg_count": 4,
        "utf16_args": [],
        "utf8_args": [1],
        "interesting_args": [
            "createwindowinband",
            "setwindowband",
            "getwindowband",
            "dwmpdxgetwindowsharedsurface",
            "dcompositioncreatedevice",
            "dcompositioncreatesurfacehandle",
            "createdxgifactory",
            "setgamingfullscreenexperience",
            "registergamingfullscreenexperiencechangenotification",
        ],
    },
    {
        "module": "kernelbase.dll",
        "function": "LoadLibraryExW",
        "arg_count": 3,
        "utf16_args": [0],
        "utf8_args": [],
        "interesting_args": [
            "user32.dll",
            "dwmapi.dll",
            "dcomp.dll",
            "dxgi.dll",
            "coremessaging.dll",
        ],
    },
    {
        "module": "kernelbase.dll",
        "function": "LoadPackagedLibrary",
        "arg_count": 2,
        "utf16_args": [0],
        "utf8_args": [],
        "interesting_args": [
            "windows.gamebaruiextension",
            "dcomp.dll",
            "dxgi.dll",
            "coremessaging.dll",
        ],
    },
]


JS_TEMPLATE = r"""
const processName = %PROCESS_NAME%;
const hooks = %HOOKS%;
const maxSamples = %MAX_SAMPLES%;
const watchedHwnds = %WATCH_HWNDS%;
const backtraceDepth = %BACKTRACE_DEPTH%;
const captureAllBacktraces = %CAPTURE_ALL_BACKTRACES%;
const counts = {};

const DWM_WINDOW_ATTRIBUTES = {
  1: "DWMWA_NCRENDERING_ENABLED",
  2: "DWMWA_NCRENDERING_POLICY",
  3: "DWMWA_TRANSITIONS_FORCEDISABLED",
  4: "DWMWA_ALLOW_NCPAINT",
  5: "DWMWA_CAPTION_BUTTON_BOUNDS",
  6: "DWMWA_NONCLIENT_RTL_LAYOUT",
  7: "DWMWA_FORCE_ICONIC_REPRESENTATION",
  8: "DWMWA_FLIP3D_POLICY",
  9: "DWMWA_EXTENDED_FRAME_BOUNDS",
  10: "DWMWA_HAS_ICONIC_BITMAP",
  11: "DWMWA_DISALLOW_PEEK",
  12: "DWMWA_EXCLUDED_FROM_PEEK",
  13: "DWMWA_CLOAK",
  14: "DWMWA_CLOAKED",
  15: "DWMWA_FREEZE_REPRESENTATION",
  16: "DWMWA_PASSIVE_UPDATE_MODE",
  17: "DWMWA_USE_HOSTBACKDROPBRUSH"
};

function resolveExport(moduleName, functionName) {
  try {
    if (typeof Module.findExportByName === "function") {
      return Module.findExportByName(moduleName, functionName);
    }
  } catch (_) {
  }

  try {
    if (typeof Module.getExportByName === "function") {
      return Module.getExportByName(moduleName, functionName);
    }
  } catch (_) {
  }

  try {
    const modules = Process.enumerateModules();
    const targetName = moduleName.toLowerCase();
    for (const module of modules) {
      if (module.name.toLowerCase() === targetName) {
        return module.getExportByName(functionName);
      }
    }
  } catch (_) {
  }

  return null;
}

function safeReadUtf16(ptrValue) {
  try {
    if (ptrValue.isNull()) {
      return null;
    }
    return Memory.readUtf16String(ptrValue);
  } catch (_) {
    return null;
  }
}

function safeReadUtf8(ptrValue) {
  try {
    if (ptrValue.isNull()) {
      return null;
    }
    return Memory.readUtf8String(ptrValue);
  } catch (_) {
    return null;
  }
}

function safeReadU32(ptrValue) {
  try {
    if (ptrValue.isNull()) {
      return null;
    }
    return Memory.readU32(ptrValue);
  } catch (_) {
    return null;
  }
}

function safeReadS32(ptrValue) {
  try {
    if (ptrValue.isNull()) {
      return null;
    }
    return Memory.readS32(ptrValue);
  } catch (_) {
    return null;
  }
}

function safeReadU16(ptrValue) {
  try {
    if (ptrValue.isNull()) {
      return null;
    }
    return Memory.readU16(ptrValue);
  } catch (_) {
    return null;
  }
}

let hwndApiCache = null;

function getHwndApis() {
  if (hwndApiCache !== null) {
    return hwndApiCache;
  }

  hwndApiCache = {};
  const tryMake = function(moduleName, exportName, returnType, argTypes) {
    try {
      const address = resolveExport(moduleName, exportName);
      if (address !== null) {
        return new NativeFunction(address, returnType, argTypes);
      }
    } catch (_) {
    }
    return null;
  };

  hwndApiCache.getClassName = tryMake("user32.dll", "GetClassNameW", "int", ["pointer", "pointer", "int"]);
  hwndApiCache.getWindowText = tryMake("user32.dll", "GetWindowTextW", "int", ["pointer", "pointer", "int"]);
  hwndApiCache.getWindowThreadProcessId = tryMake("user32.dll", "GetWindowThreadProcessId", "uint32", ["pointer", "pointer"]);
  hwndApiCache.isWindow = tryMake("user32.dll", "IsWindow", "bool", ["pointer"]);
  hwndApiCache.isWindowVisible = tryMake("user32.dll", "IsWindowVisible", "bool", ["pointer"]);
  hwndApiCache.getWindowRect = tryMake("user32.dll", "GetWindowRect", "bool", ["pointer", "pointer"]);
  hwndApiCache.getWindowBand = tryMake("user32.dll", "GetWindowBand", "bool", ["pointer", "pointer"]);
  return hwndApiCache;
}

function resolveHwndInfo(hwndValue) {
  try {
    if (!hwndValue || hwndValue.isNull()) {
      return null;
    }
    const apis = getHwndApis();
    if (!apis.isWindow) {
      return null;
    }

    const exists = !!apis.isWindow(hwndValue);
    const info = {
      hwnd: hwndValue.toString(),
      exists: exists
    };
    if (!exists) {
      return info;
    }

    const classBuffer = Memory.alloc(512);
    const titleBuffer = Memory.alloc(1024);
    const pidBuffer = Memory.alloc(4);
    const rectBuffer = Memory.alloc(16);
    const bandBuffer = Memory.alloc(4);

    if (apis.getClassName && apis.getClassName(hwndValue, classBuffer, 256) > 0) {
      info.className = safeReadUtf16(classBuffer);
    }
    if (apis.getWindowText && apis.getWindowText(hwndValue, titleBuffer, 512) > 0) {
      info.title = safeReadUtf16(titleBuffer);
    }

    if (apis.getWindowThreadProcessId) {
      info.threadId = apis.getWindowThreadProcessId(hwndValue, pidBuffer);
      info.processId = safeReadU32(pidBuffer);
    }
    if (apis.isWindowVisible) {
      info.visible = !!apis.isWindowVisible(hwndValue);
    }

    if (apis.getWindowRect && apis.getWindowRect(hwndValue, rectBuffer)) {
      info.rect = {
        left: safeReadS32(rectBuffer),
        top: safeReadS32(rectBuffer.add(4)),
        right: safeReadS32(rectBuffer.add(8)),
        bottom: safeReadS32(rectBuffer.add(12))
      };
    }

    if (apis.getWindowBand && apis.getWindowBand(hwndValue, bandBuffer)) {
      info.band = safeReadU32(bandBuffer);
    }

    return info;
  } catch (_) {
    return null;
  }
}

function parseRawNumber(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  const text = String(rawValue).trim().toLowerCase();
  if (text.length === 0) {
    return null;
  }
  if (text.indexOf("0x") === 0) {
    const parsedHex = parseInt(text, 16);
    return isNaN(parsedHex) ? null : parsedHex;
  }
  const parsed = parseInt(text, 10);
  return isNaN(parsed) ? null : parsed;
}

function normalizeHwndText(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  const text = String(rawValue).trim().toLowerCase();
  if (text.length === 0) {
    return null;
  }
  return text.indexOf("0x") === 0 ? text : "0x" + text;
}

function matchesWatchedHwnd(samples) {
  if (!watchedHwnds || watchedHwnds.length === 0) {
    return false;
  }
  for (const sample of samples) {
    const normalized = normalizeHwndText(sample.raw);
    if (normalized !== null && watchedHwnds.indexOf(normalized) !== -1) {
      return true;
    }
  }
  return false;
}

function formatBacktraceAddress(address) {
  try {
    const symbol = DebugSymbol.fromAddress(address);
    const moduleName = symbol && symbol.moduleName ? symbol.moduleName : null;
    const name = symbol && symbol.name ? symbol.name : null;
    if (moduleName && name) {
      return moduleName + "!" + name;
    }
  } catch (_) {
  }
  return address.toString();
}

function captureBacktrace(context) {
  try {
    return Thread.backtrace(context, Backtracer.ACCURATE)
      .slice(0, backtraceDepth)
      .map(formatBacktraceAddress);
  } catch (_) {
    try {
      return Thread.backtrace(context, Backtracer.FUZZY)
        .slice(0, backtraceDepth)
        .map(formatBacktraceAddress);
    } catch (_) {
      return [];
    }
  }
}

function decodeHookPayload(hook, args, samples) {
  if (hook.module === "dwmapi.dll" && hook.function === "DwmSetWindowAttribute") {
    const attributeId = samples.length > 1 ? parseRawNumber(samples[1].raw) : null;
    const valuePtr = args[2];
    const valueSize = samples.length > 3 ? parseRawNumber(samples[3].raw) : null;
    const decoded = {
      attributeId: attributeId,
      attributeName: attributeId !== null && DWM_WINDOW_ATTRIBUTES[attributeId] ? DWM_WINDOW_ATTRIBUTES[attributeId] : null,
      valueSize: valueSize
    };
    if (valueSize === 4 && valuePtr && !valuePtr.isNull()) {
      const u32Value = safeReadU32(valuePtr);
      const s32Value = safeReadS32(valuePtr);
      decoded.valueU32 = u32Value;
      decoded.valueS32 = s32Value;
      if (u32Value !== null) {
        decoded.valueHex = "0x" + ("00000000" + (u32Value >>> 0).toString(16)).slice(-8).toUpperCase();
        decoded.valueBool = u32Value !== 0;
      }
    }
    return decoded;
  }

  if (hook.module === "user32.dll" && hook.function === "SetWindowBand") {
    return {
      band: samples.length > 2 ? parseRawNumber(samples[2].raw) : null
    };
  }

  if (hook.module === "user32.dll" && hook.function === "ShowWindow") {
    return {
      command: samples.length > 1 ? parseRawNumber(samples[1].raw) : null
    };
  }

  return null;
}

for (const hook of hooks) {
  const address = resolveExport(hook.module, hook.function);
  if (address === null) {
    send({
      type: "missing",
      process_name: processName,
      module: hook.module,
      function: hook.function
    });
    continue;
  }

  send({
    type: "hooked",
    process_name: processName,
    module: hook.module,
    function: hook.function,
    address: address.toString()
  });

  Interceptor.attach(address, {
    onEnter(args) {
      const key = hook.module + "!" + hook.function;
      const count = (counts[key] || 0) + 1;
      counts[key] = count;

      if (count > maxSamples) {
        return;
      }

      const samples = [];
      const interestingValues = [];
      for (let index = 0; index < hook.arg_count; index++) {
        const arg = args[index];
        const entry = {
          index: index,
          raw: arg ? arg.toString() : "0x0"
        };

        if (hook.utf16_args.indexOf(index) !== -1) {
          entry.utf16 = safeReadUtf16(arg);
          if (entry.utf16 !== null) {
            interestingValues.push(String(entry.utf16).toLowerCase());
          }
        }

        if (hook.utf8_args && hook.utf8_args.indexOf(index) !== -1) {
          entry.utf8 = safeReadUtf8(arg);
          if (entry.utf8 !== null) {
            interestingValues.push(String(entry.utf8).toLowerCase());
          }
        }

        if (hook.hwnd_args && hook.hwnd_args.indexOf(index) !== -1) {
          const hwndInfo = resolveHwndInfo(arg);
          if (hwndInfo !== null) {
            entry.hwnd_info = hwndInfo;
          }
        }

        samples.push(entry);
      }

      if (hook.interesting_args && hook.interesting_args.length > 0) {
        let matched = false;
        for (const value of interestingValues) {
          for (const pattern of hook.interesting_args) {
            if (value.indexOf(String(pattern).toLowerCase()) !== -1) {
              matched = true;
              break;
            }
          }
          if (matched) {
            break;
          }
        }

        if (!matched) {
          return;
        }
      }

      const watchedMatch = matchesWatchedHwnd(samples);
      const payload = {
        type: "call",
        process_name: processName,
        module: hook.module,
        function: hook.function,
        count: count,
        timestamp_ms: Date.now(),
        args: samples,
        watched_hwnd_match: watchedMatch
      };

      const decoded = decodeHookPayload(hook, args, samples);
      if (decoded !== null) {
        payload.decoded = decoded;
      }

      if (watchedMatch || captureAllBacktraces) {
        payload.backtrace = captureBacktrace(this.context);
      }

      send(payload);
    }
  });
}
"""


def get_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--duration", type=int, default=8)
    parser.add_argument("--wait-seconds", type=int, default=8)
    parser.add_argument("--max-samples", type=int, default=10)
    parser.add_argument("--launch-gamebar", action="store_true")
    parser.add_argument("--trigger-after-attach", action="store_true")
    parser.add_argument("--spawn-gating", action="store_true")
    parser.add_argument(
        "--process-name",
        action="append",
        dest="process_names",
        default=[],
        help="대상 프로세스명. 기본값은 GameBar.exe, GameBarFTServer.exe",
    )
    parser.add_argument(
        "--watch-hwnd",
        action="append",
        dest="watch_hwnds",
        default=[],
        help="감시할 HWND. 일치하는 호출에 backtrace를 추가한다.",
    )
    parser.add_argument(
        "--backtrace-depth",
        type=int,
        default=10,
        help="watch-hwnd 일치 시 저장할 backtrace 깊이",
    )
    parser.add_argument(
        "--capture-all-backtraces",
        action="store_true",
        help="모든 샘플에 backtrace를 저장한다.",
    )
    return parser.parse_args()


def launch_gamebar() -> None:
    os.startfile("ms-gamebar:")


def find_processes(device, target_names: list[str]) -> list[object]:
    processes = device.enumerate_processes()
    matched = []
    target_set = {name.lower() for name in target_names}
    for process in processes:
        if process.name.lower() in target_set:
            matched.append(process)
    return matched


def spawn_matches(spawn, target_names: list[str]) -> bool:
    target_set = {name.lower() for name in target_names}
    candidates = []

    for attr_name in ("identifier", "program", "path", "argv"):
        value = getattr(spawn, attr_name, None)
        if value is None:
            continue
        if isinstance(value, list):
            candidates.extend(str(item) for item in value)
        else:
            candidates.append(str(value))

    for candidate in candidates:
        lowered = candidate.lower()
        for target in target_set:
            if target in lowered:
                return True

    return False


def normalize_hwnd_value(value: str) -> list[str]:
    lowered = value.strip().lower()
    if not lowered:
        return []
    bare = lowered[2:] if lowered.startswith("0x") else lowered
    return list(dict.fromkeys([lowered if lowered.startswith("0x") else f"0x{bare}", bare]))


def build_script_source(
    process_name: str,
    max_samples: int,
    watch_hwnds: list[str],
    backtrace_depth: int,
    capture_all_backtraces: bool,
) -> str:
    normalized_watch_hwnds: list[str] = []
    for value in watch_hwnds:
        normalized_watch_hwnds.extend(normalize_hwnd_value(value))

    return (
        JS_TEMPLATE.replace("%PROCESS_NAME%", json.dumps(process_name))
        .replace("%HOOKS%", json.dumps(HOOKS))
        .replace("%MAX_SAMPLES%", str(max_samples))
        .replace("%WATCH_HWNDS%", json.dumps(list(dict.fromkeys(normalized_watch_hwnds))))
        .replace("%BACKTRACE_DEPTH%", str(backtrace_depth))
        .replace("%CAPTURE_ALL_BACKTRACES%", "true" if capture_all_backtraces else "false")
    )


def main() -> int:
    args = get_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    target_names = args.process_names or ["GameBar.exe", "GameBarFTServer.exe"]

    if args.launch_gamebar:
        launch_gamebar()

    device = frida.get_local_device()
    deadline = time.time() + args.wait_seconds
    matched: list[object] = []

    while time.time() < deadline:
        matched = find_processes(device, target_names)
        if matched:
            break
        time.sleep(0.25)

    result: dict[str, object] = {
        "captured_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "launch_gamebar": args.launch_gamebar,
        "trigger_after_attach": args.trigger_after_attach,
        "spawn_gating": args.spawn_gating,
        "spawn_gating_supported": True,
        "duration": args.duration,
        "wait_seconds": args.wait_seconds,
        "targets_requested": target_names,
        "targets_found": [{"pid": proc.pid, "name": proc.name} for proc in matched],
        "spawn_events": [],
        "processes": [],
    }

    process_entries: dict[int, dict[str, object]] = {}
    sessions: list[object] = []
    scripts: list[object] = []
    attached_pids: set[int] = set()
    state_lock = threading.Lock()

    def resolve_process_name(pid: int, fallback: str) -> str:
        try:
            proc = device.get_process(pid)
            return proc.name
        except Exception:
            return fallback

    def attach_process(pid: int, process_name: str) -> None:
        with state_lock:
            if pid in attached_pids:
                return
            attached_pids.add(pid)

        process_entry = {
            "pid": pid,
            "name": process_name,
            "hooked": [],
            "missing": [],
            "call_counts": {},
            "samples": {},
            "messages": [],
        }
        process_entries[pid] = process_entry
        result["processes"].append(process_entry)

        try:
            session = device.attach(pid)
        except frida.ProcessNotFoundError as ex:
            process_entry["messages"].append(
                {
                    "type": "attach_failed",
                    "pid": pid,
                    "process_name": process_name,
                    "error": str(ex),
                }
            )
            return

        script = session.create_script(
            build_script_source(
                process_name,
                args.max_samples,
                args.watch_hwnds,
                args.backtrace_depth,
                args.capture_all_backtraces,
            )
        )
        script.on("message", make_message_handler(process_entry))
        script.load()

        sessions.append(session)
        scripts.append(script)

    def make_message_handler(process_entry: dict[str, object]):
        def on_message(message, data):
            payload = message.get("payload")
            if message.get("type") == "send" and isinstance(payload, dict):
                kind = payload.get("type")
                if kind == "hooked":
                    process_entry["hooked"].append(payload)
                elif kind == "missing":
                    process_entry["missing"].append(payload)
                elif kind == "call":
                    key = f"{payload.get('module')}!{payload.get('function')}"
                    call_counts = process_entry["call_counts"]
                    call_counts[key] = call_counts.get(key, 0) + 1
                    samples = process_entry["samples"]
                    samples.setdefault(key, [])
                    if len(samples[key]) < args.max_samples:
                        samples[key].append(payload)
                else:
                    process_entry["messages"].append(message)
            else:
                process_entry["messages"].append(message)

        return on_message

    try:
        if args.spawn_gating:
            def on_spawn_added(spawn):
                event = {
                    "pid": spawn.pid,
                    "identifier": getattr(spawn, "identifier", None),
                }
                result["spawn_events"].append(event)

                if not spawn_matches(spawn, target_names):
                    device.resume(spawn.pid)
                    return

                process_name = resolve_process_name(spawn.pid, os.path.basename(str(getattr(spawn, "identifier", "spawned"))))
                attach_process(spawn.pid, process_name)
                device.resume(spawn.pid)

            device.on("spawn-added", on_spawn_added)
            try:
                device.enable_spawn_gating()
            except frida.NotSupportedError:
                result["spawn_gating_supported"] = False
                output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
                return 0

            if args.launch_gamebar:
                launch_gamebar()

            deadline = time.time() + args.wait_seconds
            while time.time() < deadline:
                with state_lock:
                    if attached_pids:
                        break
                time.sleep(0.25)

            if args.trigger_after_attach:
                launch_gamebar()
        else:
            if not matched:
                output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
                return 0

            for process in matched:
                attach_process(process.pid, process.name)

            if args.trigger_after_attach:
                launch_gamebar()

        time.sleep(args.duration)
    finally:
        if args.spawn_gating:
            try:
                device.disable_spawn_gating()
            except Exception:
                pass

        for script in scripts:
            try:
                script.unload()
            except Exception:
                pass

        for session in sessions:
            try:
                session.detach()
            except Exception:
                pass

    output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
