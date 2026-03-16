import argparse
import json
import sys
import time
from pathlib import Path

import frida


IMAGE_BASE = 0x140000000
TARGETS = [
    ("UpdateWindowRegionForPinnedOnlyAsync", 0x1406CFC50),
    ("SetAppFrameHwnd", 0x14025BC60),
    ("Broker_SetCombinedWindowRegion", 0x1400ADB70),
    ("Broker_Show", 0x1400AD6A0),
    ("Broker_Hide", 0x1400AD6F0),
    ("WindowManagerRegionPath_A", 0x1401D1660),
    ("WindowManagerRegionPath_B", 0x1401D19D0),
]


JS_TEMPLATE = r"""
const staticImageBase = ptr("%IMAGE_BASE%");
const targets = %TARGETS%;
const maxEvents = %MAX_EVENTS%;
let eventCount = 0;

let moduleBase = null;
for (const module of Process.enumerateModules()) {
  if (module.name.toLowerCase() === "gamebar.exe") {
    moduleBase = module.base;
    break;
  }
}

if (moduleBase === null) {
  throw new Error("GameBar.exe module base를 찾지 못했습니다.");
}

function emitEvent(kind, payload) {
  if (eventCount >= maxEvents) {
    return;
  }
  eventCount += 1;
  send({
    kind: kind,
    payload: payload
  });
}

function sampleQword(basePtr, offset) {
  try {
    if (basePtr.isNull()) {
      return null;
    }
    return Memory.readPointer(basePtr.add(offset)).toString();
  } catch (_) {
    return null;
  }
}

for (const target of targets) {
  const address = moduleBase.add(ptr(target.offset_hex));
  Interceptor.attach(address, {
    onEnter(args) {
      const payload = {
        name: target.name,
        address: address.toString(),
        thread_id: Process.getCurrentThreadId(),
        arg0: args[0].toString(),
        arg1: args[1].toString(),
        arg2: args[2].toString(),
      };

      try {
        if (target.name === "UpdateWindowRegionForPinnedOnlyAsync") {
          payload.state = {
            self: args[0].toString(),
            qword_30: sampleQword(args[0], 0x30),
            qword_38: sampleQword(args[0], 0x38),
            qword_40: sampleQword(args[0], 0x40),
            qword_48: sampleQword(args[0], 0x48),
            qword_50: sampleQword(args[0], 0x50),
            qword_58: sampleQword(args[0], 0x58),
            qword_60: sampleQword(args[0], 0x60),
            qword_68: sampleQword(args[0], 0x68),
            qword_70: sampleQword(args[0], 0x70),
            qword_90: sampleQword(args[0], 0x90),
            qword_98: sampleQword(args[0], 0x98),
            qword_1c8: sampleQword(args[0], 0x1c8),
            qword_1d0: sampleQword(args[0], 0x1d0),
          };
        }
      } catch (_) {
      }

      emitEvent("enter", payload);
    },
    onLeave(retval) {
      emitEvent("leave", {
        name: target.name,
        address: address.toString(),
        thread_id: Process.getCurrentThreadId(),
        retval: retval.toString()
      });
    }
  });
}

send({
  kind: "ready",
  payload: {
    target_count: targets.length
  }
});
"""


def wait_for_process(process_name: str, timeout_seconds: float) -> int:
    deadline = time.time() + timeout_seconds
    local = frida.get_local_device()

    while time.time() < deadline:
        for proc in local.enumerate_processes():
            if proc.name.lower() == process_name.lower():
                return proc.pid
        time.sleep(0.05)

    raise TimeoutError(f"{process_name} 프로세스를 찾지 못했습니다.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--pid", type=int)
    parser.add_argument("--wait-process", default="GameBar.exe")
    parser.add_argument("--wait-timeout", type=float, default=10.0)
    parser.add_argument("--capture-seconds", type=float, default=8.0)
    parser.add_argument("--max-events", type=int, default=1024)
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    pid = args.pid or wait_for_process(args.wait_process, args.wait_timeout)
    device = frida.get_local_device()
    session = device.attach(pid)

    events = []

    def on_message(message, _data):
        if message.get("type") == "send":
            events.append(message.get("payload"))
        else:
            events.append(message)

    targets = []
    for name, absolute in TARGETS:
        targets.append(
            {
                "name": name,
                "absolute_hex": hex(absolute),
                "offset_hex": hex(absolute - IMAGE_BASE),
            }
        )

    script_source = (
        JS_TEMPLATE.replace("%IMAGE_BASE%", hex(IMAGE_BASE))
        .replace("%TARGETS%", json.dumps(targets))
        .replace("%MAX_EVENTS%", str(args.max_events))
    )

    script = session.create_script(script_source)
    script.on("message", on_message)
    script.load()

    time.sleep(args.capture_seconds)

    session.detach()

    payload = {
        "captured_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pid": pid,
        "wait_process": args.wait_process,
        "capture_seconds": args.capture_seconds,
        "static_image_base": hex(IMAGE_BASE),
        "targets": targets,
        "events": events,
    }
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(str(output_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
