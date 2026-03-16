import argparse
import json
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

  const modules = Process.enumerateModules();
  const targetName = moduleName.toLowerCase();
  for (const module of modules) {
    if (module.name.toLowerCase() === targetName) {
      try {
        return module.getExportByName(functionName);
      } catch (_) {
      }
    }
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

const CoInitializeEx = new NativeFunction(resolveExport("ole32.dll", "CoInitializeEx"), "int", ["pointer", "uint"]);
const CoUninitialize = new NativeFunction(resolveExport("ole32.dll", "CoUninitialize"), "void", []);
const CoCreateInstance = new NativeFunction(resolveExport("ole32.dll", "CoCreateInstance"), "int", ["pointer", "pointer", "uint", "pointer", "pointer"]);

function asHex(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return "0x" + (value >>> 0).toString(16).padStart(8, "0");
  }
  if (value instanceof Int64 || value instanceof UInt64) {
    return "0x" + value.toString(16);
  }
  return value.toString();
}

function readPtr(ptrValue, offset) {
  return ptrValue.add(offset).readPointer();
}

function makeContext() {
  const primaryOut = Memory.alloc(Process.pointerSize);
  primaryOut.writePointer(ptr(0));
  const hrCreate = CoCreateInstance(allocGuid(CLSID_BROKER), ptr(0), 4, allocGuid(IID_PRIMARY), primaryOut);
  const primary = primaryOut.readPointer();
  if (hrCreate < 0 || primary.isNull()) {
    return { hrCreate: hrCreate, primary: ptr(0) };
  }

  const primaryVtbl = primary.readPointer();
  const queryServiceLike = new NativeFunction(primaryVtbl.add(12 * Process.pointerSize).readPointer(), "int", ["pointer", "pointer", "pointer", "pointer"]);
  const serviceOut = Memory.alloc(Process.pointerSize);
  serviceOut.writePointer(ptr(0));
  const hrService = queryServiceLike(primary, allocGuid(IID_FINAL), allocGuid(IID_FINAL), serviceOut);
  const service = serviceOut.readPointer();

  return {
    hrCreate: hrCreate,
    hrService: hrService,
    primary: primary,
    service: service
  };
}

function queryInterface(source, iid) {
  const vtbl = source.readPointer();
  const qi = new NativeFunction(vtbl.readPointer(), "int", ["pointer", "pointer", "pointer"]);
  const out = Memory.alloc(Process.pointerSize);
  out.writePointer(ptr(0));
  const hr = qi(source, allocGuid(iid), out);
  return { hr: hr, ptr: out.readPointer() };
}

function callNoArg(obj, slot) {
  const vtbl = obj.readPointer();
  const fn = new NativeFunction(vtbl.add(slot * Process.pointerSize).readPointer(), "int", ["pointer"]);
  return fn(obj);
}

function callOutPtr(obj, slot) {
  const vtbl = obj.readPointer();
  const fn = new NativeFunction(vtbl.add(slot * Process.pointerSize).readPointer(), "int", ["pointer", "pointer"]);
  const out = Memory.alloc(Process.pointerSize);
  out.writePointer(ptr(0));
  const hr = fn(obj, out);
  return { hr: hr, child: out.readPointer() };
}

function safeCallOutPtr(obj, slot) {
  try {
    return {
      ok: true,
      result: callOutPtr(obj, slot)
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error)
    };
  }
}

function inspectReturnedObject(obj) {
  if (!obj || obj.isNull()) {
    return null;
  }
  const info = {
    ptr: obj.toString(),
    vtbl: obj.readPointer().toString()
  };

  const inspectable = queryInterface(obj, "af86e2e0-b12d-4c6a-9c5a-d7aa65101e90");
  info.qi_iinspectable_hr = asHex(inspectable.hr);
  if (!inspectable.ptr.isNull()) {
    try {
      const ivtbl = inspectable.ptr.readPointer();
      const getIids = new NativeFunction(ivtbl.add(3 * Process.pointerSize).readPointer(), "int", ["pointer", "pointer", "pointer"]);
      const getClassName = new NativeFunction(ivtbl.add(4 * Process.pointerSize).readPointer(), "int", ["pointer", "pointer"]);
      const iidCount = Memory.alloc(4);
      const iidArray = Memory.alloc(Process.pointerSize);
      iidCount.writeU32(0);
      iidArray.writePointer(ptr(0));
      const hrGetIids = getIids(inspectable.ptr, iidCount, iidArray);
      info.get_iids_hr = asHex(hrGetIids);
      info.get_iids_count = iidCount.readU32();

      const hstrOut = Memory.alloc(Process.pointerSize);
      hstrOut.writePointer(ptr(0));
      const hrClass = getClassName(inspectable.ptr, hstrOut);
      info.get_runtime_class_name_hr = asHex(hrClass);
    } finally {
      const release = new NativeFunction(inspectable.ptr.readPointer().add(Process.pointerSize).readPointer(), "uint", ["pointer"]);
      release(inspectable.ptr);
    }
  }
  return info;
}

function releaseMaybe(obj) {
  if (!obj || obj.isNull()) {
    return;
  }
  const release = new NativeFunction(obj.readPointer().add(Process.pointerSize).readPointer(), "uint", ["pointer"]);
  release(obj);
}

function runScenario(name, actions) {
  const result = { name: name, actions: actions };
  const ctx = makeContext();
  result.hr_create = asHex(ctx.hrCreate);
  result.hr_service = asHex(ctx.hrService);
  if (ctx.primary.isNull() || ctx.service.isNull()) {
    return result;
  }

  const finalFace = queryInterface(ctx.service, IID_FINAL);
  const hidden1 = queryInterface(ctx.service, IID_HIDDEN1);
  const hidden2 = queryInterface(ctx.service, IID_HIDDEN2);
  result.qi_final_hr = asHex(finalFace.hr);
  result.qi_hidden1_hr = asHex(hidden1.hr);
  result.qi_hidden2_hr = asHex(hidden2.hr);

  const timeline = [];
  function snapshot(label) {
    const snap = { label: label };
    if (!hidden1.ptr.isNull()) {
      const s6 = safeCallOutPtr(hidden1.ptr, 6);
      if (s6.ok) {
        snap.hidden1_slot6 = { hr: asHex(s6.result.hr), child: s6.result.child.toString(), child_info: inspectReturnedObject(s6.result.child) };
      } else {
        snap.hidden1_slot6 = { error: s6.error };
      }
      const s7 = safeCallOutPtr(hidden1.ptr, 7);
      if (s7.ok) {
        snap.hidden1_slot7 = { hr: asHex(s7.result.hr), child: s7.result.child.toString(), child_info: inspectReturnedObject(s7.result.child) };
      } else {
        snap.hidden1_slot7 = { error: s7.error };
      }
    }
    if (!hidden2.ptr.isNull()) {
      const s6 = safeCallOutPtr(hidden2.ptr, 6);
      if (s6.ok) {
        snap.hidden2_slot6 = { hr: asHex(s6.result.hr), child: s6.result.child.toString(), child_info: inspectReturnedObject(s6.result.child) };
      } else {
        snap.hidden2_slot6 = { error: s6.error };
      }
      const s21 = safeCallOutPtr(hidden2.ptr, 21);
      if (s21.ok) {
        snap.hidden2_slot21 = { hr: asHex(s21.result.hr), child: s21.result.child.toString(), child_info: inspectReturnedObject(s21.result.child) };
      } else {
        snap.hidden2_slot21 = { error: s21.error };
      }
    }
    timeline.push(snap);
  }

  snapshot("baseline");

  if (!finalFace.ptr.isNull()) {
    for (const action of actions) {
      if (action === "show") {
        timeline.push({ action: action, hr: asHex(callNoArg(finalFace.ptr, 6)) });
      } else if (action === "hide") {
        timeline.push({ action: action, hr: asHex(callNoArg(finalFace.ptr, 7)) });
      } else if (action === "reset") {
        timeline.push({ action: action, hr: asHex(callNoArg(finalFace.ptr, 10)) });
      } else if (action.startsWith("sleep:")) {
        const value = parseInt(action.split(":")[1], 10);
        const start = Date.now();
        while ((Date.now() - start) < value) {
          Thread.sleep(0.05);
        }
        timeline.push({ action: action, hr: "0x00000000" });
      }
      snapshot("after_" + action);
    }
  }

  result.timeline = timeline;

  releaseMaybe(finalFace.ptr);
  releaseMaybe(hidden1.ptr);
  releaseMaybe(hidden2.ptr);
  releaseMaybe(ctx.service);
  releaseMaybe(ctx.primary);

  return result;
}

rpc.exports = {
  runscenarios(actionsJson) {
    const actionsList = JSON.parse(actionsJson);
    const hrInit = CoInitializeEx(ptr(0), 2);
    const payload = {
      coinit_hr: asHex(hrInit),
      scenarios: []
    };
    try {
      for (const item of actionsList) {
        payload.scenarios.push(runScenario(item.name, item.actions));
      }
      return payload;
    } finally {
      if (hrInit >= 0) {
        CoUninitialize();
      }
    }
  }
};
"""


def on_message(message, data):
    if message["type"] == "send":
        print(json.dumps(message["payload"], ensure_ascii=False))
    elif message["type"] == "error":
        print(json.dumps(message, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--process-name", default="GameBar.exe")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    device = frida.get_local_device()
    session = device.attach(args.process_name)
    script = session.create_script(JS_SOURCE)
    script.on("message", on_message)
    script.load()

    scenarios = [
        {"name": "baseline_only", "actions": []},
        {"name": "show_500ms", "actions": ["show", "sleep:500"]},
        {"name": "show_2000ms", "actions": ["show", "sleep:2000"]},
        {"name": "show_reset_500ms", "actions": ["show", "reset", "sleep:500"]},
        {"name": "show_hide_show_500ms", "actions": ["show", "hide", "show", "sleep:500"]},
    ]
    payload = script.exports_sync.runscenarios(json.dumps(scenarios))

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    session.detach()


if __name__ == "__main__":
    main()
