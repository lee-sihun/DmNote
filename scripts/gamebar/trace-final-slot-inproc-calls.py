import argparse
import json
import subprocess
import time
from pathlib import Path

import frida


JS_SOURCE = r"""
const CLSID_BROKER = "59614133-bfb4-4906-90af-c44f15167f1a";
const IID_PRIMARY = "9767060c-9476-42e2-8f7b-2f10fd13765c";
const IID_FINAL = "30dad006-cf4a-45e0-aec1-2195d76fd9c0";
const MAX_HITS_PER_SLOT = 5;
const counts = {};

function resolveExport(moduleName, functionName) {
  if (typeof Module.findExportByName === "function") {
    const addr = Module.findExportByName(moduleName, functionName);
    if (addr) {
      return addr;
    }
  }
  if (typeof Module.getExportByName === "function") {
    try {
      return Module.getExportByName(moduleName, functionName);
    } catch (_) {
    }
  }
  try {
    for (const module of Process.enumerateModules()) {
      if (module.name.toLowerCase() === moduleName.toLowerCase()) {
        return module.getExportByName(functionName);
      }
    }
  } catch (_) {
  }
  return null;
}

function resolveComExport(functionName) {
  return resolveExport("ole32.dll", functionName) || resolveExport("combase.dll", functionName);
}

function guidBytes(guid) {
  const parts = guid.toLowerCase().split("-");
  const d1 = parseInt(parts[0], 16);
  const d2 = parseInt(parts[1], 16);
  const d3 = parseInt(parts[2], 16);
  const tail = parts[3] + parts[4];
  const bytes = [];
  bytes.push(d1 & 0xff, (d1 >>> 8) & 0xff, (d1 >>> 16) & 0xff, (d1 >>> 24) & 0xff);
  bytes.push(d2 & 0xff, (d2 >>> 8) & 0xff);
  bytes.push(d3 & 0xff, (d3 >>> 8) & 0xff);
  for (let i = 0; i < tail.length; i += 2) {
    bytes.push(parseInt(tail.substr(i, 2), 16));
  }
  return bytes;
}

function allocGuid(guid) {
  const mem = Memory.alloc(16);
  const bytes = guidBytes(guid);
  for (let i = 0; i < 16; i++) {
    mem.add(i).writeU8(bytes[i]);
  }
  return mem;
}

function shortBacktrace(context) {
  return Thread.backtrace(context, Backtracer.ACCURATE)
    .slice(0, 8)
    .map(DebugSymbol.fromAddress)
    .map(item => item.toString());
}

const CoInitializeEx = new NativeFunction(resolveComExport("CoInitializeEx"), "int", ["pointer", "uint"]);
const CoCreateInstance = new NativeFunction(resolveComExport("CoCreateInstance"), "int", ["pointer", "pointer", "uint", "pointer", "pointer"]);

function buildFinal() {
  CoInitializeEx(ptr(0), 2);
  const primaryOut = Memory.alloc(Process.pointerSize);
  primaryOut.writePointer(ptr(0));
  const hrCreate = CoCreateInstance(allocGuid(CLSID_BROKER), ptr(0), 4, allocGuid(IID_PRIMARY), primaryOut);
  const primary = primaryOut.readPointer();
  if (hrCreate < 0 || primary.isNull()) {
    send({ type: "error", step: "cocreate", hr: hrCreate });
    return null;
  }
  const primaryVtbl = primary.readPointer();
  const queryServiceLike = new NativeFunction(primaryVtbl.add(12 * Process.pointerSize).readPointer(), "int", ["pointer", "pointer", "pointer", "pointer"]);
  const serviceOut = Memory.alloc(Process.pointerSize);
  serviceOut.writePointer(ptr(0));
  const hrService = queryServiceLike(primary, allocGuid(IID_FINAL), allocGuid(IID_FINAL), serviceOut);
  const service = serviceOut.readPointer();
  if (hrService < 0 || service.isNull()) {
    send({ type: "error", step: "queryservice", hr: hrService });
    return null;
  }
  const qi = new NativeFunction(service.readPointer().readPointer(), "int", ["pointer", "pointer", "pointer"]);
  const finalOut = Memory.alloc(Process.pointerSize);
  finalOut.writePointer(ptr(0));
  const hrFinal = qi(service, allocGuid(IID_FINAL), finalOut);
  const finalFace = finalOut.readPointer();
  send({
    type: "context",
    hrCreate: hrCreate,
    hrService: hrService,
    hrFinal: hrFinal,
    finalPtr: finalFace.toString()
  });
  return finalFace;
}

function installHooks() {
  const finalFace = buildFinal();
  if (finalFace === null || finalFace.isNull()) {
    return;
  }
  const vtbl = finalFace.readPointer();
  const seen = {};
  for (let slot = 6; slot <= 60; slot++) {
    const addr = vtbl.add(slot * Process.pointerSize).readPointer();
    const key = addr.toString();
    if (!seen[key]) {
      seen[key] = [];
    }
    seen[key].push(slot);
  }

  for (const [address, slots] of Object.entries(seen)) {
    const label = slots.join(",");
    send({ type: "hook-install", slots: label, address: address });
    Interceptor.attach(ptr(address), {
      onEnter(args) {
        counts[label] = (counts[label] || 0) + 1;
        if (counts[label] > MAX_HITS_PER_SLOT) {
          return;
        }
        send({
          type: "slot-call",
          slots: label,
          self: args[0].toString(),
          arg1: args[1] ? args[1].toString() : null,
          threadId: this.threadId,
          backtrace: shortBacktrace(this.context)
        });
      }
    });
  }
}

installHooks();
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--duration", type=int, default=8)
    args = parser.parse_args()

    device = frida.get_local_device()
    session = device.attach("GameBar.exe")
    script = session.create_script(JS_SOURCE)
    events = []

    def on_message(message, data):
        if message.get("type") == "send":
            events.append(message.get("payload"))
        elif message.get("type") == "error":
            events.append(message)

    script.on("message", on_message)
    script.load()

    probe_script = Path(__file__).resolve().parent / "probe-gamebar-broker-win32.ps1"
    subprocess.run([
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(probe_script),
        "-Methods",
        "show",
        "hide",
        "show",
    ], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    time.sleep(args.duration)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"events": events}, indent=2), encoding="utf-8")
    session.detach()


if __name__ == "__main__":
    main()
