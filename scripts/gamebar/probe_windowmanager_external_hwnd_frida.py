import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

import frida


GUIDS = {
    "IUnknown": "00000000-0000-0000-C000-000000000046",
    "IActivationFactory": "00000035-0000-0000-C000-000000000046",
    "IGbftFactory": "6BFBA441-F863-58CF-9604-0AE9049EF42A",
    "FtFactoryClsid": "FD06603A-2BDF-4BB1-B7DF-5DC68F353601",
}


JS_TEMPLATE = r"""
const guidBytes = %GUID_BYTES%;
const hwndValue = ptr("%HWND%");
const showCommand = %SHOW_COMMAND%;
const hideCommand = %HIDE_COMMAND%;

function hex32(value) {
  const normalized = (value >>> 0).toString(16).toUpperCase();
  return "0x" + normalized.padStart(8, "0");
}

function ptrHex(value) {
  return value && !value.isNull() ? value.toString() : "0x0";
}

function allocGuid(name) {
  const buffer = Memory.alloc(16);
  if (buffer.writeByteArray) {
    buffer.writeByteArray(guidBytes[name]);
  } else {
    Memory.writeByteArray(buffer, guidBytes[name]);
  }
  return buffer;
}

function readPointer(address) {
  if (address.readPointer) {
    return address.readPointer();
  }
  return Memory.readPointer(address);
}

function writePointer(address, value) {
  if (address.writePointer) {
    address.writePointer(value);
    return;
  }
  Memory.writePointer(address, value);
}

function readU32(address) {
  if (address.readU32) {
    return address.readU32();
  }
  return Memory.readU32(address);
}

function writeU32(address, value) {
  if (address.writeU32) {
    address.writeU32(value);
    return;
  }
  Memory.writeU32(address, value);
}

function resolveExport(moduleName, functionName) {
  try {
    if (typeof Module.findExportByName === "function") {
      const found = Module.findExportByName(moduleName, functionName);
      if (found !== null) {
        return found;
      }
    }
  } catch (_) {}

  try {
    return Process.getModuleByName(moduleName).getExportByName(functionName);
  } catch (_) {}

  throw new Error("missing export: " + moduleName + "!" + functionName);
}

const coInitializeEx = new NativeFunction(
  resolveExport("ole32.dll", "CoInitializeEx"),
  "int",
  ["pointer", "uint32"]
);
const coUninitialize = new NativeFunction(
  resolveExport("ole32.dll", "CoUninitialize"),
  "void",
  []
);
const coCreateInstance = new NativeFunction(
  resolveExport("ole32.dll", "CoCreateInstance"),
  "int",
  ["pointer", "pointer", "uint32", "pointer", "pointer"]
);
const getWindowLongW = new NativeFunction(
  resolveExport("user32.dll", "GetWindowLongW"),
  "int",
  ["pointer", "int"]
);
const isWindowVisible = new NativeFunction(
  resolveExport("user32.dll", "IsWindowVisible"),
  "bool",
  ["pointer"]
);
const isWindow = new NativeFunction(
  resolveExport("user32.dll", "IsWindow"),
  "bool",
  ["pointer"]
);
const getWindowBand = new NativeFunction(
  resolveExport("user32.dll", "GetWindowBand"),
  "bool",
  ["pointer", "pointer"]
);
const showWindowRaw = new NativeFunction(
  resolveExport("user32.dll", "ShowWindow"),
  "bool",
  ["pointer", "int"]
);
const createRectRgnRaw = new NativeFunction(
  resolveExport("gdi32.dll", "CreateRectRgn"),
  "pointer",
  ["int", "int", "int", "int"]
);
const combineRgnRaw = new NativeFunction(
  resolveExport("gdi32.dll", "CombineRgn"),
  "int",
  ["pointer", "pointer", "pointer", "int"]
);
const setWindowRgnRaw = new NativeFunction(
  resolveExport("user32.dll", "SetWindowRgn"),
  "int",
  ["pointer", "pointer", "bool"]
);
const sleep = new NativeFunction(
  resolveExport("kernel32.dll", "Sleep"),
  "void",
  ["uint32"]
);

const apiTrace = {
  counts: {
    CreateRectRgn: 0,
    CombineRgn: 0,
    SetWindowRgn: 0,
  },
  samples: [],
};

function pushApiSample(kind, payload) {
  apiTrace.counts[kind] = (apiTrace.counts[kind] || 0) + 1;
  if (apiTrace.samples.length < 24) {
    apiTrace.samples.push(Object.assign({ kind: kind }, payload));
  }
}

Interceptor.attach(createRectRgnRaw, {
  onEnter(args) {
    this.args = {
      left: args[0].toInt32(),
      top: args[1].toInt32(),
      right: args[2].toInt32(),
      bottom: args[3].toInt32(),
    };
  },
  onLeave(retval) {
    pushApiSample("CreateRectRgn", Object.assign({ result: ptrHex(retval) }, this.args));
  }
});

Interceptor.attach(combineRgnRaw, {
  onEnter(args) {
    this.args = {
      dest: ptrHex(args[0]),
      src1: ptrHex(args[1]),
      src2: ptrHex(args[2]),
      mode: args[3].toInt32(),
    };
  },
  onLeave(retval) {
    pushApiSample("CombineRgn", Object.assign({ result: retval.toInt32() }, this.args));
  }
});

Interceptor.attach(setWindowRgnRaw, {
  onEnter(args) {
    this.args = {
      hwnd: ptrHex(args[0]),
      hrgn: ptrHex(args[1]),
      redraw: !!args[2].toInt32(),
      targetMatchesProbe: ptrHex(args[0]) === ptrHex(hwndValue),
    };
  },
  onLeave(retval) {
    pushApiSample("SetWindowRgn", Object.assign({ result: retval.toInt32() }, this.args));
  }
});

const vectorViewKeepAlive = [];

function createRectVectorView(rects) {
  const addRefCb = new NativeCallback(function () {
    return 1;
  }, "uint32", ["pointer"]);

  const releaseCb = new NativeCallback(function () {
    return 1;
  }, "uint32", ["pointer"]);

  const queryInterfaceCb = new NativeCallback(function (thisPtr, iidPtr, outPtr) {
    writePointer(outPtr, thisPtr);
    return 0;
  }, "int", ["pointer", "pointer", "pointer"]);

  const getIidsCb = new NativeCallback(function (_thisPtr, iidCountPtr, iidArrayPtr) {
    writeU32(iidCountPtr, 0);
    writePointer(iidArrayPtr, NULL);
    return 0;
  }, "int", ["pointer", "pointer", "pointer"]);

  const getRuntimeClassNameCb = new NativeCallback(function (_thisPtr, classNamePtr) {
    writePointer(classNamePtr, NULL);
    return 0;
  }, "int", ["pointer", "pointer"]);

  const getTrustLevelCb = new NativeCallback(function (_thisPtr, trustLevelPtr) {
    writeU32(trustLevelPtr, 0);
    return 0;
  }, "int", ["pointer", "pointer"]);

  const getAtCb = new NativeCallback(function (_thisPtr, index, outRectPtr) {
    if (index >= rects.length) {
      return -2147483637;
    }
    const rect = rects[index];
    Memory.writeFloat(outRectPtr.add(0), rect.x);
    Memory.writeFloat(outRectPtr.add(4), rect.y);
    Memory.writeFloat(outRectPtr.add(8), rect.width);
    Memory.writeFloat(outRectPtr.add(12), rect.height);
    return 0;
  }, "int", ["pointer", "uint32", "pointer"]);

  const getSizeCb = new NativeCallback(function (_thisPtr, outSizePtr) {
    writeU32(outSizePtr, rects.length);
    return 0;
  }, "int", ["pointer", "pointer"]);

  const vtable = Memory.alloc(Process.pointerSize * 8);
  writePointer(vtable.add(Process.pointerSize * 0), queryInterfaceCb);
  writePointer(vtable.add(Process.pointerSize * 1), addRefCb);
  writePointer(vtable.add(Process.pointerSize * 2), releaseCb);
  writePointer(vtable.add(Process.pointerSize * 3), getIidsCb);
  writePointer(vtable.add(Process.pointerSize * 4), getRuntimeClassNameCb);
  writePointer(vtable.add(Process.pointerSize * 5), getTrustLevelCb);
  writePointer(vtable.add(Process.pointerSize * 6), getAtCb);
  writePointer(vtable.add(Process.pointerSize * 7), getSizeCb);

  const instance = Memory.alloc(Process.pointerSize);
  writePointer(instance, vtable);

  vectorViewKeepAlive.push({
    rects: rects,
    vtable: vtable,
    instance: instance,
    addRefCb: addRefCb,
    releaseCb: releaseCb,
    queryInterfaceCb: queryInterfaceCb,
    getIidsCb: getIidsCb,
    getRuntimeClassNameCb: getRuntimeClassNameCb,
    getTrustLevelCb: getTrustLevelCb,
    getAtCb: getAtCb,
    getSizeCb: getSizeCb,
  });

  return instance;
}

function releaseCom(instance) {
  if (!instance || instance.isNull()) {
    return;
  }
  try {
    const vtable = readPointer(instance);
    const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 2)), "uint32", ["pointer"]);
    fn(instance);
  } catch (_) {}
}

function queryInterface(instance, iidName) {
  const outPtr = Memory.alloc(Process.pointerSize);
  writePointer(outPtr, NULL);
  const vtable = readPointer(instance);
  const fn = new NativeFunction(readPointer(vtable), "int", ["pointer", "pointer", "pointer"]);
  const hr = fn(instance, allocGuid(iidName), outPtr);
  return {
    hr: hex32(hr),
    pointer: readPointer(outPtr),
  };
}

function activateInstance(factory) {
  const outPtr = Memory.alloc(Process.pointerSize);
  writePointer(outPtr, NULL);
  const vtable = readPointer(factory);
  const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 6)), "int", ["pointer", "pointer"]);
  const hr = fn(factory, outPtr);
  return {
    hr: hex32(hr),
    pointer: readPointer(outPtr),
  };
}

function createWindowManager() {
  const unknownOut = Memory.alloc(Process.pointerSize);
  writePointer(unknownOut, NULL);
  const hrCreate = coCreateInstance(
    allocGuid("FtFactoryClsid"),
    NULL,
    4,
    allocGuid("IUnknown"),
    unknownOut
  );
  const unknown = readPointer(unknownOut);
  const result = {
    coCreateIUnknownHr: hex32(hrCreate),
    unknownPointer: ptrHex(unknown),
  };
  if (unknown.isNull()) {
    return result;
  }

  const qiActivation = queryInterface(unknown, "IActivationFactory");
  result.queryInterfaceActivationFactoryHr = qiActivation.hr;
  result.activationFactoryPointer = ptrHex(qiActivation.pointer);
  if (qiActivation.pointer.isNull()) {
    releaseCom(unknown);
    return result;
  }

  const activated = activateInstance(qiActivation.pointer);
  result.activateInstanceHr = activated.hr;
  result.activatedPointer = ptrHex(activated.pointer);
  if (activated.pointer.isNull()) {
    releaseCom(qiActivation.pointer);
    releaseCom(unknown);
    return result;
  }

  const qiFactory = queryInterface(activated.pointer, "IGbftFactory");
  result.queryInterfaceIGbftFactoryHr = qiFactory.hr;
  result.factoryPointer = ptrHex(qiFactory.pointer);
  if (qiFactory.pointer.isNull()) {
    releaseCom(activated.pointer);
    releaseCom(qiActivation.pointer);
    releaseCom(unknown);
    return result;
  }

  const factoryVtable = readPointer(qiFactory.pointer);
  const createWindowManagerFn = new NativeFunction(
    readPointer(factoryVtable.add(Process.pointerSize * 11)),
    "int",
    ["pointer", "pointer"]
  );
  const windowManagerOut = Memory.alloc(Process.pointerSize);
  writePointer(windowManagerOut, NULL);
  const hrWindowManager = createWindowManagerFn(qiFactory.pointer, windowManagerOut);
  const windowManager = readPointer(windowManagerOut);
  result.createWindowManagerHr = hex32(hrWindowManager);
  result.windowManagerPointer = ptrHex(windowManager);

  result._unknown = unknown;
  result._activationFactory = qiActivation.pointer;
  result._activated = activated.pointer;
  result._gbftFactory = qiFactory.pointer;
  result._windowManager = windowManager;
  return result;
}

function destroyWindowManager(ctx) {
  if (!ctx) {
    return;
  }
  releaseCom(ctx._windowManager);
  releaseCom(ctx._gbftFactory);
  releaseCom(ctx._activated);
  releaseCom(ctx._activationFactory);
  releaseCom(ctx._unknown);
}

function rawWindowSnapshot(label) {
  const bandOut = Memory.alloc(4);
  writeU32(bandOut, 0);
  const bandKnown = !!getWindowBand(hwndValue, bandOut);
  return {
    label: label,
    hwnd: ptrHex(hwndValue),
    isWindow: !!isWindow(hwndValue),
    bandKnown: bandKnown,
    band: bandKnown ? readU32(bandOut) : null,
    style: hex32(getWindowLongW(hwndValue, -16)),
    exStyle: hex32(getWindowLongW(hwndValue, -20)),
    visible: !!isWindowVisible(hwndValue),
  };
}

function callWindowManagerGet(windowManager, index) {
  const outPtr = Memory.alloc(4);
  writeU32(outPtr, 0);
  const vtable = readPointer(windowManager);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * 8)),
    "int",
    ["pointer", "pointer", "int", "pointer"]
  );
  const hr = fn(windowManager, hwndValue, index, outPtr);
  return {
    hr: hex32(hr),
    value: hex32(readU32(outPtr)),
  };
}

function callWindowManagerNoValue(windowManager, slotIndex, arg) {
  const vtable = readPointer(windowManager);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * slotIndex)),
    "int",
    ["pointer", "pointer", "int"]
  );
  return hex32(fn(windowManager, hwndValue, arg));
}

function callWindowManagerSetLong(windowManager, index, value) {
  const vtable = readPointer(windowManager);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * 9)),
    "int",
    ["pointer", "pointer", "int", "int"]
  );
  return hex32(fn(windowManager, hwndValue, index, value));
}

function callWindowManagerEnable(windowManager, slotIndex) {
  const vtable = readPointer(windowManager);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * slotIndex)),
    "int",
    ["pointer", "pointer"]
  );
  return hex32(fn(windowManager, hwndValue));
}

function callWindowManagerSetRegion(windowManager, rects) {
  const rectView = createRectVectorView(rects);
  const vtable = readPointer(windowManager);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * 10)),
    "int",
    ["pointer", "pointer", "pointer"]
  );
  return {
    hr: hex32(fn(windowManager, hwndValue, rectView)),
    rectCount: rects.length,
  };
}

setTimeout(function () {
  const result = {
    processName: (typeof Process.name !== "undefined" ? String(Process.name) : null),
    processId: Process.id,
    hwnd: ptrHex(hwndValue),
    coInitializeHr: null,
  };

  const hrInit = coInitializeEx(NULL, 2);
  result.coInitializeHr = hex32(hrInit);

  let ctx = null;
  try {
    ctx = createWindowManager();
    result.factory = {
      coCreateIUnknownHr: ctx.coCreateIUnknownHr,
      queryInterfaceActivationFactoryHr: ctx.queryInterfaceActivationFactoryHr,
      activateInstanceHr: ctx.activateInstanceHr,
      queryInterfaceIGbftFactoryHr: ctx.queryInterfaceIGbftFactoryHr,
      createWindowManagerHr: ctx.createWindowManagerHr,
      windowManagerPointer: ctx.windowManagerPointer,
    };

    if (!ctx._windowManager || ctx._windowManager.isNull()) {
      send({ type: "result", payload: result });
      return;
    }

    result.rawBefore = rawWindowSnapshot("before");
    result.ftBefore = {
      style: callWindowManagerGet(ctx._windowManager, -16),
      exStyle: callWindowManagerGet(ctx._windowManager, -20),
    };

    result.showWindowShowHr = callWindowManagerNoValue(ctx._windowManager, 12, showCommand);
    sleep(150);
    result.rawAfterShow = rawWindowSnapshot("afterShow");

    result.setWindowRegion = callWindowManagerSetRegion(ctx._windowManager, [
      { x: 120.0, y: 120.0, width: 280.0, height: 180.0 },
      { x: 520.0, y: 120.0, width: 220.0, height: 160.0 },
    ]);
    sleep(150);
    result.rawAfterSetWindowRegion = rawWindowSnapshot("afterSetWindowRegion");

    result.resetWindowRegionHr = callWindowManagerEnable(ctx._windowManager, 11);
    sleep(150);
    result.rawAfterResetWindowRegion = rawWindowSnapshot("afterResetWindowRegion");

    result.enableClickThroughHr = callWindowManagerEnable(ctx._windowManager, 6);
    sleep(150);
    result.rawAfterEnableClickThrough = rawWindowSnapshot("afterEnableClickThrough");

    result.disableClickThroughHr = callWindowManagerEnable(ctx._windowManager, 7);
    sleep(150);
    result.rawAfterDisableClickThrough = rawWindowSnapshot("afterDisableClickThrough");

    const baselineExStyle = getWindowLongW(hwndValue, -20);
    const transparentExStyle = baselineExStyle | 0x20;
    result.setWindowLongTransparentHr = callWindowManagerSetLong(
      ctx._windowManager,
      -20,
      transparentExStyle
    );
    sleep(150);
    result.rawAfterSetTransparent = rawWindowSnapshot("afterSetTransparent");
    result.restoreWindowLongHr = callWindowManagerSetLong(
      ctx._windowManager,
      -20,
      baselineExStyle
    );
    sleep(150);
    result.rawAfterRestoreExStyle = rawWindowSnapshot("afterRestoreExStyle");
    showWindowRaw(hwndValue, showCommand);
    sleep(50);
    result.ftAfter = {
      style: callWindowManagerGet(ctx._windowManager, -16),
      exStyle: callWindowManagerGet(ctx._windowManager, -20),
      baselineExStyle: hex32(baselineExStyle),
    };

    result.showWindowHideHr = callWindowManagerNoValue(ctx._windowManager, 12, hideCommand);
    sleep(150);
    result.rawAfterHide = rawWindowSnapshot("afterHide");
    result.apiTrace = apiTrace;
  } catch (error) {
    result.exception = String(error && error.stack ? error.stack : error);
    result.apiTrace = apiTrace;
  } finally {
    destroyWindowManager(ctx);
    if (hrInit >= 0) {
      coUninitialize();
    }
  }

  send({ type: "result", payload: result });
}, 250);
"""


def get_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--process-name", required=True)
    parser.add_argument("--hwnd", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--wait-seconds", type=int, default=10)
    parser.add_argument("--show-command", type=int, default=5)
    parser.add_argument("--hide-command", type=int, default=0)
    return parser.parse_args()


def wait_for_process(device, process_name: str, timeout_seconds: int):
    deadline = time.time() + timeout_seconds
    target = process_name.lower()
    while time.time() < deadline:
        for process in device.enumerate_processes():
            if process.name.lower() == target:
                return process
        time.sleep(0.5)
    raise RuntimeError(f"대상 프로세스를 찾지 못했습니다: {process_name}")


def guid_to_bytes_le(value: str) -> list[int]:
    return list(uuid.UUID(value).bytes_le)


def build_script(hwnd: str, show_command: int, hide_command: int) -> str:
    guid_bytes = {name: guid_to_bytes_le(value) for name, value in GUIDS.items()}
    return (
        JS_TEMPLATE.replace("%GUID_BYTES%", json.dumps(guid_bytes))
        .replace("%HWND%", hwnd)
        .replace("%SHOW_COMMAND%", str(show_command))
        .replace("%HIDE_COMMAND%", str(hide_command))
    )


def main() -> int:
    args = get_args()
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    device = frida.get_local_device()
    process = wait_for_process(device, args.process_name, args.wait_seconds)
    session = device.attach(process.pid)

    result_holder = {"payload": None, "messages": []}

    def on_message(message, data):
        result_holder["messages"].append(message)
        if message.get("type") == "send":
            payload = message.get("payload", {})
            if payload.get("type") == "result":
                result_holder["payload"] = payload.get("payload")

    script = session.create_script(build_script(args.hwnd, args.show_command, args.hide_command))
    script.on("message", on_message)
    script.load()

    deadline = time.time() + args.wait_seconds
    while time.time() < deadline and result_holder["payload"] is None:
        time.sleep(0.2)

    try:
        script.unload()
    except Exception:
        pass
    session.detach()

    output = {
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "processName": args.process_name,
        "hwnd": args.hwnd,
        "result": result_holder["payload"],
        "messages": result_holder["messages"],
    }
    output_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    if result_holder["payload"] is None:
        print("probe result was not received", file=sys.stderr)
        return 1

    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
