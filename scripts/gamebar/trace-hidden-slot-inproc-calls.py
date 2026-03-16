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
const IID_HIDDEN1 = "5eac68f9-e031-4c66-b4ea-5ab6aff979c8";
const IID_HIDDEN2 = "d6332df0-dbfb-575e-93f1-c7bff0693913";

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
    const modules = Process.enumerateModules();
    const target = moduleName.toLowerCase();
    for (const module of modules) {
      if (module.name.toLowerCase() === target) {
        return module.getExportByName(functionName);
      }
    }
  } catch (_) {
  }
  return null;
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
    .slice(0, 10)
    .map(DebugSymbol.fromAddress)
    .map(item => item.toString());
}

function resolveComExport(functionName) {
  return (
    resolveExport("ole32.dll", functionName) ||
    resolveExport("combase.dll", functionName)
  );
}

const CoInitializeEx = new NativeFunction(resolveComExport("CoInitializeEx"), "int", ["pointer", "uint"]);
const CoCreateInstance = new NativeFunction(resolveComExport("CoCreateInstance"), "int", ["pointer", "pointer", "uint", "pointer", "pointer"]);

function buildContext() {
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
    hrHidden1: hrHidden1,
    hrHidden2: hrHidden2,
    hidden1: hidden1.toString(),
    hidden2: hidden2.toString()
  });
  return { hidden1, hidden2 };
}

function installHooks() {
  const ctx = buildContext();
  if (ctx === null) {
    return;
  }

  const hooks = [];
  if (!ctx.hidden1.isNull()) {
    hooks.push({ name: "hidden1_slot6", address: ctx.hidden1.readPointer().add(6 * Process.pointerSize).readPointer() });
    hooks.push({ name: "hidden1_slot7", address: ctx.hidden1.readPointer().add(7 * Process.pointerSize).readPointer() });
  }
  if (!ctx.hidden2.isNull()) {
    hooks.push({ name: "hidden2_slot21", address: ctx.hidden2.readPointer().add(21 * Process.pointerSize).readPointer() });
  }

  for (const hook of hooks) {
    send({ type: "hook-install", name: hook.name, address: hook.address.toString() });
    Interceptor.attach(hook.address, {
      onEnter(args) {
        send({
          type: "slot-call",
          name: hook.name,
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
