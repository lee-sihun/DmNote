import argparse
import json
import os
import subprocess
import time
from pathlib import Path

import frida


JS_SOURCE = r"""
const CLSID_BROKER = "59614133-bfb4-4906-90af-c44f15167f1a";
const IID_PRIMARY = "9767060c-9476-42e2-8f7b-2f10fd13765c";
const IID_FINAL = "30dad006-cf4a-45e0-aec1-2195d76fd9c0";
const IID_HIDDEN1 = "5eac68f9-e031-4c66-b4ea-5ab6aff979c8";
const IID_HIDDEN2 = "d6332df0-dbfb-575e-93f1-c7bff0693913";
const MAX_HITS = 4;
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

function tryInstall() {
  try {
    const coInitAddr = resolveComExport("CoInitializeEx");
    const coCreateAddr = resolveComExport("CoCreateInstance");
    if (coInitAddr === null || coCreateAddr === null) {
      send({ type: "install-wait", reason: "com-export-missing" });
      setTimeout(tryInstall, 500);
      return;
    }

    const CoInitializeEx = new NativeFunction(coInitAddr, "int", ["pointer", "uint"]);
    const CoCreateInstance = new NativeFunction(coCreateAddr, "int", ["pointer", "pointer", "uint", "pointer", "pointer"]);
    CoInitializeEx(ptr(0), 2);

    const primaryOut = Memory.alloc(Process.pointerSize);
    primaryOut.writePointer(ptr(0));
    const hrCreate = CoCreateInstance(allocGuid(CLSID_BROKER), ptr(0), 4, allocGuid(IID_PRIMARY), primaryOut);
    const primary = primaryOut.readPointer();
    if (hrCreate < 0 || primary.isNull()) {
      send({ type: "install-wait", reason: "cocreate-failed", hr: hrCreate });
      setTimeout(tryInstall, 500);
      return;
    }

    const primaryVtbl = primary.readPointer();
    const queryServiceLike = new NativeFunction(primaryVtbl.add(12 * Process.pointerSize).readPointer(), "int", ["pointer", "pointer", "pointer", "pointer"]);
    const serviceOut = Memory.alloc(Process.pointerSize);
    serviceOut.writePointer(ptr(0));
    const hrService = queryServiceLike(primary, allocGuid(IID_FINAL), allocGuid(IID_FINAL), serviceOut);
    const service = serviceOut.readPointer();
    if (hrService < 0 || service.isNull()) {
      send({ type: "install-wait", reason: "queryservice-failed", hr: hrService });
      setTimeout(tryInstall, 500);
      return;
    }

    const qi = new NativeFunction(service.readPointer().readPointer(), "int", ["pointer", "pointer", "pointer"]);
    const finalOut = Memory.alloc(Process.pointerSize);
    finalOut.writePointer(ptr(0));
    const hrFinal = qi(service, allocGuid(IID_FINAL), finalOut);
    const finalFace = finalOut.readPointer();

    const hidden1Out = Memory.alloc(Process.pointerSize);
    const hidden2Out = Memory.alloc(Process.pointerSize);
    hidden1Out.writePointer(ptr(0));
    hidden2Out.writePointer(ptr(0));
    const hrHidden1 = qi(service, allocGuid(IID_HIDDEN1), hidden1Out);
    const hrHidden2 = qi(service, allocGuid(IID_HIDDEN2), hidden2Out);
    const hidden1 = hidden1Out.readPointer();
    const hidden2 = hidden2Out.readPointer();

    send({
      type: "context",
      hrCreate: hrCreate,
      hrService: hrService,
      hrFinal: hrFinal,
      hrHidden1: hrHidden1,
      hrHidden2: hrHidden2,
      finalPtr: finalFace.toString(),
      hidden1: hidden1.toString(),
      hidden2: hidden2.toString()
    });

    const seen = {};
    if (!finalFace.isNull()) {
      const vtbl = finalFace.readPointer();
      for (let slot = 6; slot <= 60; slot++) {
        const addr = vtbl.add(slot * Process.pointerSize).readPointer();
        const key = addr.toString();
        if (!seen[key]) {
          seen[key] = [];
        }
        seen[key].push("final:" + slot.toString());
      }
    }

    if (!hidden1.isNull()) {
      const vtbl = hidden1.readPointer();
      for (const slot of [6, 7]) {
        const addr = vtbl.add(slot * Process.pointerSize).readPointer();
        const key = addr.toString();
        if (!seen[key]) {
          seen[key] = [];
        }
        seen[key].push("hidden1:" + slot.toString());
      }
    }

    if (!hidden2.isNull()) {
      const vtbl = hidden2.readPointer();
      const addr = vtbl.add(21 * Process.pointerSize).readPointer();
      const key = addr.toString();
      if (!seen[key]) {
        seen[key] = [];
      }
      seen[key].push("hidden2:21");
    }

    for (const [address, labels] of Object.entries(seen)) {
      const label = labels.join(",");
      send({ type: "hook-install", labels: label, address: address });
      Interceptor.attach(ptr(address), {
        onEnter(args) {
          counts[label] = (counts[label] || 0) + 1;
          if (counts[label] > MAX_HITS) {
            return;
          }
          send({
            type: "slot-call",
            labels: label,
            self: args[0].toString(),
            arg1: args[1] ? args[1].toString() : null,
            threadId: this.threadId,
            backtrace: shortBacktrace(this.context)
          });
        }
      });
    }
  } catch (error) {
    send({ type: "install-error", error: String(error) });
    setTimeout(tryInstall, 500);
  }
}

setTimeout(tryInstall, 1000);
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--duration", type=int, default=12)
    args = parser.parse_args()

    device = frida.get_local_device()
    session = None
    events = []
    attached = {"value": False}

    def on_message(message, data):
        if message.get("type") == "send":
            events.append(message.get("payload"))
        elif message.get("type") == "error":
            events.append(message)

    subprocess.run([
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        "-NoProfile",
        "-Command",
        "Start-Process 'ms-gamebar:'"
    ], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    gamebar_pid = None
    wait_deadline = time.time() + 8
    while time.time() < wait_deadline and gamebar_pid is None:
        try:
            for proc in device.enumerate_processes():
                if proc.name == "GameBar.exe":
                    gamebar_pid = proc.pid
                    break
        except Exception:
            pass
        if gamebar_pid is None:
            time.sleep(0.1)

    if gamebar_pid is not None:
        session = device.attach(gamebar_pid)
        script = session.create_script(JS_SOURCE)
        script.on("message", on_message)
        script.load()
        attached["value"] = True

    deadline = time.time() + args.duration
    while time.time() < deadline:
        time.sleep(0.2)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({
        "attached": attached["value"],
        "events": events
    }, indent=2), encoding="utf-8")

    if session is not None:
        try:
            session.detach()
        except Exception:
            pass


if __name__ == "__main__":
    main()
