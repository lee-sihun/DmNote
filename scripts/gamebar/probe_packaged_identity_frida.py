import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

import frida


RUNTIME_CLASSES = [
    "GameBar.CuiWidgetAdapter",
    "GameBar.WidgetControlHost",
    "GameBar.ForegroundWorkerHost",
    "GameBar.AppTargetHost",
    "GameBar.NotificationHost",
    "Microsoft.Windows.Shell.GamingOverlayExperienceManager",
    "Windows.Internal.GamingOverlay.GameBarWindowControl",
    "XboxGameBarFT.GbftFactory",
    "XboxGameBarFT.AppTargetManagerFT",
    "XboxGameBarFT.WindowManagerFT",
    "XboxGameBarFT.InputFocusTrackerFT",
    "XboxGameBarFT.GameConfigStoreFT",
]

GUIDS = {
    "IActivationFactory": "00000035-0000-0000-C000-000000000046",
    "IUnknown": "00000000-0000-0000-C000-000000000046",
    "IGbftFactory": "6BFBA441-F863-58CF-9604-0AE9049EF42A",
    "IAppTargetManagerFT": "FA6EF6BB-CFC7-5C65-8088-583C02C25CFC",
    "IWindowManagerFT": "BF5BA331-861E-5121-A167-CA786ADB6B2B",
    "IInputFocusTrackerFT": "820A5105-846E-5522-B2A7-1E21CDD58E9C",
    "IGameConfigStoreFT": "8E9401C0-4F34-5DD9-9F2D-F0F06AD72793",
    "FtFactoryClsid": "FD06603A-2BDF-4BB1-B7DF-5DC68F353601",
}


JS_TEMPLATE = r"""
const runtimeClasses = %RUNTIME_CLASSES%;
const probeLabels = %PROBE_LABELS%;
const guidBytes = %GUID_BYTES%;
const clsctxs = [4, 5, 20, 21];

function hex32(value) {
  const normalized = (value >>> 0).toString(16).toUpperCase();
  return "0x" + normalized.padStart(8, "0");
}

function allocGuid(name) {
  const buffer = Memory.alloc(16);
  writeByteArray(buffer, guidBytes[name]);
  return buffer;
}

function writeByteArray(address, values) {
  if (address.writeByteArray) {
    address.writeByteArray(values);
    return;
  }
  Memory.writeByteArray(address, values);
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
      const value = Module.findExportByName(moduleName, functionName);
      if (value !== null) {
        return value;
      }
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
    return Process.getModuleByName(moduleName).getExportByName(functionName);
  } catch (_) {
  }

  throw new Error("missing export: " + moduleName + "!" + functionName);
}

function ptrHex(value) {
  return value && !value.isNull() ? value.toString() : "0x0";
}

function readUtf16(ptrValue, length) {
  if (!ptrValue || ptrValue.isNull()) {
    return null;
  }
  if (ptrValue.readUtf16String) {
    if (typeof length === "number") {
      return ptrValue.readUtf16String(length);
    }
    return ptrValue.readUtf16String();
  }
  if (typeof Memory.readUtf16String === "function") {
    if (typeof length === "number") {
      return Memory.readUtf16String(ptrValue, length);
    }
    return Memory.readUtf16String(ptrValue);
  }
  throw new TypeError("utf16 reader unavailable");
}

const roInitialize = new NativeFunction(
  resolveExport("combase.dll", "RoInitialize"),
  "int",
  ["uint32"]
);
const roUninitialize = new NativeFunction(
  resolveExport("combase.dll", "RoUninitialize"),
  "void",
  []
);
const windowsCreateString = new NativeFunction(
  resolveExport("combase.dll", "WindowsCreateString"),
  "int",
  ["pointer", "uint32", "pointer"]
);
const windowsDeleteString = new NativeFunction(
  resolveExport("combase.dll", "WindowsDeleteString"),
  "int",
  ["pointer"]
);
const windowsGetStringRawBuffer = new NativeFunction(
  resolveExport("combase.dll", "WindowsGetStringRawBuffer"),
  "pointer",
  ["pointer", "pointer"]
);
const roGetActivationFactory = new NativeFunction(
  resolveExport("combase.dll", "RoGetActivationFactory"),
  "int",
  ["pointer", "pointer", "pointer"]
);
const roActivateInstance = new NativeFunction(
  resolveExport("combase.dll", "RoActivateInstance"),
  "int",
  ["pointer", "pointer"]
);
const coCreateInstance = new NativeFunction(
  resolveExport("ole32.dll", "CoCreateInstance"),
  "int",
  ["pointer", "pointer", "uint32", "pointer", "pointer"]
);
const getCurrentPackageFullName = new NativeFunction(
  resolveExport("kernel32.dll", "GetCurrentPackageFullName"),
  "int",
  ["pointer", "pointer"]
);
const getShellWindow = new NativeFunction(
  resolveExport("user32.dll", "GetShellWindow"),
  "pointer",
  []
);
const getDesktopWindow = new NativeFunction(
  resolveExport("user32.dll", "GetDesktopWindow"),
  "pointer",
  []
);

function utf16Alloc(text) {
  return Memory.allocUtf16String(text);
}

function readHString(hstring) {
  if (hstring.isNull()) {
    return null;
  }
  const lengthPtr = Memory.alloc(4);
  const buffer = windowsGetStringRawBuffer(hstring, lengthPtr);
  if (buffer.isNull()) {
    return null;
  }
  const length = readU32(lengthPtr);
  return readUtf16(buffer, length);
}

function releaseCom(instance) {
  if (!instance || instance.isNull()) {
    return;
  }
  try {
    const vtable = readPointer(instance);
    const release = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 2)), "uint32", ["pointer"]);
    release(instance);
  } catch (_) {
  }
}

function queryInterface(instance, iidName) {
  const resultPtr = Memory.alloc(Process.pointerSize);
  writePointer(resultPtr, NULL);
  const vtable = readPointer(instance);
  const queryInterfaceFn = new NativeFunction(readPointer(vtable), "int", ["pointer", "pointer", "pointer"]);
  const hr = queryInterfaceFn(instance, allocGuid(iidName), resultPtr);
  return {
    hr: hex32(hr),
    pointer: readPointer(resultPtr),
  };
}

function getRuntimeClassName(instance) {
  const outPtr = Memory.alloc(Process.pointerSize);
  writePointer(outPtr, NULL);
  const vtable = readPointer(instance);
  const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 4)), "int", ["pointer", "pointer"]);
  const hr = fn(instance, outPtr);
  const hstring = readPointer(outPtr);
  const name = readHString(hstring);
  if (hstring && !hstring.isNull()) {
    windowsDeleteString(hstring);
  }
  return {
    hr: hex32(hr),
    value: name,
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

function createObjectFromFactory(factory, slotIndex, iidName, label) {
  const result = { label: label, slotIndex: slotIndex };
  const outPtr = Memory.alloc(Process.pointerSize);
  writePointer(outPtr, NULL);
  const vtable = readPointer(factory);
  const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * slotIndex)), "int", ["pointer", "pointer"]);
  const hr = fn(factory, outPtr);
  const value = readPointer(outPtr);
  result.createHr = hex32(hr);
  result.pointer = ptrHex(value);
  if (!value.isNull()) {
    const runtimeClass = getRuntimeClassName(value);
    result.runtimeClassHr = runtimeClass.hr;
    result.runtimeClass = runtimeClass.value;
    const qi = queryInterface(value, iidName);
    result.queryInterfaceHr = qi.hr;
    result.queryInterfacePointer = ptrHex(qi.pointer);
    if (!qi.pointer.isNull() && shouldProbeLabel(label)) {
      result.probe = probeFtObject(label, qi.pointer);
    }
    releaseCom(qi.pointer);
  }
  releaseCom(value);
  return result;
}

function shouldProbeLabel(label) {
  return probeLabels.length === 0 || probeLabels.indexOf(label) >= 0;
}

function inspectInspectablePointer(value, label) {
  const runtimeClass = getRuntimeClassName(value);
  return {
    label: label,
    pointer: ptrHex(value),
    runtimeClassHr: runtimeClass.hr,
    runtimeClass: runtimeClass.value,
  };
}

function callGetWindowLong(windowManager, hwnd, index, label) {
  const outPtr = Memory.alloc(4);
  writeU32(outPtr, 0);
  const vtable = readPointer(windowManager);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * 8)),
    "int",
    ["pointer", "pointer", "int", "pointer"]
  );
  const hr = fn(windowManager, hwnd, index, outPtr);
  return {
    target: label,
    hwnd: ptrHex(hwnd),
    index: index,
    hr: hex32(hr),
    value: "0x" + readU32(outPtr).toString(16).toUpperCase().padStart(8, "0"),
  };
}

function probeWindowManager(windowManager) {
  const desktop = getDesktopWindow();
  const shell = getShellWindow();
  return {
    desktopStyle: callGetWindowLong(windowManager, desktop, -16, "desktop"),
    desktopExStyle: callGetWindowLong(windowManager, desktop, -20, "desktop"),
    shellStyle: callGetWindowLong(windowManager, shell, -16, "shell"),
    shellExStyle: callGetWindowLong(windowManager, shell, -20, "shell"),
  };
}

function callEntryExistsForHwnd(gameConfigStore, hwnd, label) {
  const outPtr = Memory.alloc(1);
  writeByteArray(outPtr, [0]);
  const vtable = readPointer(gameConfigStore);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * 9)),
    "int",
    ["pointer", "pointer", "pointer"]
  );
  const hr = fn(gameConfigStore, hwnd, outPtr);
  return {
    target: label,
    hwnd: ptrHex(hwnd),
    hr: hex32(hr),
    exists: outPtr.readU8() !== 0,
  };
}

function probeGameConfigStore(gameConfigStore) {
  const desktop = getDesktopWindow();
  const shell = getShellWindow();
  return {
    desktopEntry: callEntryExistsForHwnd(gameConfigStore, desktop, "desktop"),
    shellEntry: callEntryExistsForHwnd(gameConfigStore, shell, "shell"),
  };
}

function probeInputFocusTracker(inputFocusTracker) {
  const outPtr = Memory.alloc(Process.pointerSize);
  writePointer(outPtr, NULL);
  const vtable = readPointer(inputFocusTracker);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * 8)),
    "int",
    ["pointer", "pointer"]
  );
  const hr = fn(inputFocusTracker, outPtr);
  const info = readPointer(outPtr);
  const result = {
    getLatestInputFocusEventHr: hex32(hr),
    infoPointer: ptrHex(info),
  };
  if (!info.isNull()) {
    result.info = inspectInspectablePointer(info, "InputFocusInfo");
  }
  releaseCom(info);
  return result;
}

function probeAppTargetManager(appTargetManager) {
  const outPtr = Memory.alloc(Process.pointerSize);
  writePointer(outPtr, NULL);
  const vtable = readPointer(appTargetManager);
  const fn = new NativeFunction(
    readPointer(vtable.add(Process.pointerSize * 9)),
    "int",
    ["pointer", "pointer"]
  );
  const hr = fn(appTargetManager, outPtr);
  const target = readPointer(outPtr);
  const result = {
    getTargetHr: hex32(hr),
    targetPointer: ptrHex(target),
  };
  if (!target.isNull()) {
    result.target = inspectInspectablePointer(target, "AppTargetInfo");
  }
  releaseCom(target);
  return result;
}

function probeFtObject(label, instance) {
  try {
    if (label === "IWindowManagerFT") {
      return probeWindowManager(instance);
    }
    if (label === "IGameConfigStoreFT") {
      return probeGameConfigStore(instance);
    }
    if (label === "IInputFocusTrackerFT") {
      return probeInputFocusTracker(instance);
    }
    if (label === "IAppTargetManagerFT") {
      return probeAppTargetManager(instance);
    }
    return null;
  } catch (error) {
    return {
      exception: String(error && error.stack ? error.stack : error),
    };
  }
}

function probeGbftFactory(factory) {
  const result = {};
  const vtable = readPointer(factory);
  const processHandleOut = Memory.alloc(8);
  writeU32(processHandleOut, 0);
  writeU32(processHandleOut.add(4), 0);
  const getProcessHandleFn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 6)), "int", ["pointer", "pointer"]);
  const hrProcessHandle = getProcessHandleFn(factory, processHandleOut);
  result.processHandleHr = hex32(hrProcessHandle);
  result.processHandleLow = "0x" + readU32(processHandleOut).toString(16).toUpperCase();
  result.appTargetManager = createObjectFromFactory(factory, 7, "IAppTargetManagerFT", "IAppTargetManagerFT");
  result.windowManager = createObjectFromFactory(factory, 11, "IWindowManagerFT", "IWindowManagerFT");
  result.gameConfigStore = createObjectFromFactory(factory, 16, "IGameConfigStoreFT", "IGameConfigStoreFT");
  result.inputFocusTracker = createObjectFromFactory(factory, 25, "IInputFocusTrackerFT", "IInputFocusTrackerFT");
  return result;
}

function getPackageFullName() {
  try {
    const lengthPtr = Memory.alloc(4);
    writeU32(lengthPtr, 0);
    let hr = getCurrentPackageFullName(lengthPtr, ptr(0));
    const length = readU32(lengthPtr);
    if (length === 0) {
      return { hr: hex32(hr), value: null };
    }

    const buffer = Memory.alloc(length * 2);
    hr = getCurrentPackageFullName(lengthPtr, buffer);
    return {
      hr: hex32(hr),
      value: readUtf16(buffer),
    };
  } catch (error) {
    return {
      hr: "exception",
      value: String(error && error.stack ? error.stack : error),
    };
  }
}

function withHString(text, callback) {
  const hstringPtr = Memory.alloc(Process.pointerSize);
  writePointer(hstringPtr, NULL);
  const hr = windowsCreateString(utf16Alloc(text), text.length, hstringPtr);
  const handle = readPointer(hstringPtr);
  const result = callback(hr, handle);
  if (handle && !handle.isNull()) {
    windowsDeleteString(handle);
  }
  return result;
}

function probeRuntimeClass(className) {
  return withHString(className, function (createHr, hstring) {
    const result = {
      className: className,
      windowsCreateStringHr: hex32(createHr),
    };

    if (createHr < 0 || hstring.isNull()) {
      return result;
    }

    const factoryOut = Memory.alloc(Process.pointerSize);
    writePointer(factoryOut, NULL);
    const factoryHr = roGetActivationFactory(hstring, allocGuid("IActivationFactory"), factoryOut);
    const factory = readPointer(factoryOut);
    result.roGetActivationFactoryHr = hex32(factoryHr);
    result.factoryPointer = ptrHex(factory);

    if (!factory.isNull()) {
      const activated = activateInstance(factory);
      result.activateViaFactoryHr = activated.hr;
      result.instanceViaFactoryPointer = ptrHex(activated.pointer);
      if (!activated.pointer.isNull()) {
        const runtimeClass = getRuntimeClassName(activated.pointer);
        result.runtimeClassViaFactoryHr = runtimeClass.hr;
        result.runtimeClassViaFactory = runtimeClass.value;
        if (className === "XboxGameBarFT.GbftFactory") {
          const qi = queryInterface(activated.pointer, "IGbftFactory");
          result.queryInterfaceIGbftFactoryHr = qi.hr;
          result.queryInterfaceIGbftFactoryPointer = ptrHex(qi.pointer);
          releaseCom(qi.pointer);
        }
      }
      releaseCom(activated.pointer);
    }

    const directOut = Memory.alloc(Process.pointerSize);
    writePointer(directOut, NULL);
    const directHr = roActivateInstance(hstring, directOut);
    const directInstance = readPointer(directOut);
    result.roActivateInstanceHr = hex32(directHr);
    result.roActivateInstancePointer = ptrHex(directInstance);
    if (!directInstance.isNull()) {
      const runtimeClass = getRuntimeClassName(directInstance);
      result.runtimeClassViaRoActivateHr = runtimeClass.hr;
      result.runtimeClassViaRoActivate = runtimeClass.value;
    }
    releaseCom(directInstance);
    releaseCom(factory);
    return result;
  });
}

function probeFtComContext(clsctx) {
  const result = { clsctx: clsctx };
  const outPtr = Memory.alloc(Process.pointerSize);
  writePointer(outPtr, NULL);
  const createHr = coCreateInstance(allocGuid("FtFactoryClsid"), NULL, clsctx, allocGuid("IUnknown"), outPtr);
  const unknown = readPointer(outPtr);
  result.coCreateIUnknownHr = hex32(createHr);
  result.coCreateIUnknownPointer = ptrHex(unknown);
  if (unknown.isNull()) {
    return result;
  }

  const qiActivation = queryInterface(unknown, "IActivationFactory");
  result.queryInterfaceActivationFactoryHr = qiActivation.hr;
  result.queryInterfaceActivationFactoryPointer = ptrHex(qiActivation.pointer);
  if (!qiActivation.pointer.isNull()) {
    const activated = activateInstance(qiActivation.pointer);
    result.activateInstanceHr = activated.hr;
    result.activateInstancePointer = ptrHex(activated.pointer);
    if (!activated.pointer.isNull()) {
      const runtimeClass = getRuntimeClassName(activated.pointer);
      result.runtimeClassHr = runtimeClass.hr;
      result.runtimeClass = runtimeClass.value;
      const qiGbft = queryInterface(activated.pointer, "IGbftFactory");
      result.queryInterfaceIGbftFactoryHr = qiGbft.hr;
      result.queryInterfaceIGbftFactoryPointer = ptrHex(qiGbft.pointer);
      if (!qiGbft.pointer.isNull()) {
        result.gbftFactory = probeGbftFactory(qiGbft.pointer);
      }
      releaseCom(qiGbft.pointer);
    }
    releaseCom(activated.pointer);
  }

  releaseCom(qiActivation.pointer);
  releaseCom(unknown);
  return result;
}

setTimeout(function () {
  const result = {
    processName: (typeof Process.name !== "undefined" ? String(Process.name) : null),
    processId: Process.id,
    packageFullName: getPackageFullName(),
    roInitializeHr: null,
    winrt: [],
    ftCom: [],
  };

  const hrInit = roInitialize(1);
  result.roInitializeHr = hex32(hrInit);
  try {
    for (const className of runtimeClasses) {
      try {
        result.winrt.push(probeRuntimeClass(className));
      } catch (error) {
        result.winrt.push({ className: className, exception: String(error) });
      }
    }

    for (const clsctx of clsctxs) {
      try {
        result.ftCom.push(probeFtComContext(clsctx));
      } catch (error) {
        result.ftCom.push({ clsctx: clsctx, exception: String(error) });
      }
    }
  } finally {
    if (hrInit >= 0) {
      roUninitialize();
    }
  }

  send({ type: "result", payload: result });
}, 250);
"""


def get_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--process-name")
    parser.add_argument("--pid", type=int)
    parser.add_argument("--output", required=True)
    parser.add_argument("--wait-seconds", type=int, default=10)
    parser.add_argument("--launch-gamebar", action="store_true")
    parser.add_argument("--probe-labels", default="")
    return parser.parse_args()


def launch_gamebar() -> None:
    os.startfile("ms-gamebar:")


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


def build_script(probe_labels: list[str]) -> str:
    guid_bytes = {name: guid_to_bytes_le(value) for name, value in GUIDS.items()}
    return (
        JS_TEMPLATE
        .replace("%RUNTIME_CLASSES%", json.dumps(RUNTIME_CLASSES))
        .replace("%PROBE_LABELS%", json.dumps(probe_labels))
        .replace("%GUID_BYTES%", json.dumps(guid_bytes))
    )


def main() -> int:
    args = get_args()
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not args.process_name and not args.pid:
        raise RuntimeError("--process-name 또는 --pid 중 하나는 필요합니다.")

    if args.launch_gamebar:
        launch_gamebar()

    device = frida.get_local_device()
    if args.pid:
        process = None
        session = device.attach(args.pid)
    else:
        process = wait_for_process(device, args.process_name, args.wait_seconds)
        session = device.attach(process.pid)

    result_holder = {"payload": None, "messages": []}

    def on_message(message, data):
        result_holder["messages"].append(message)
        if message.get("type") == "send":
            payload = message.get("payload", {})
            if payload.get("type") == "result":
                result_holder["payload"] = payload.get("payload")

    probe_labels = [label.strip() for label in args.probe_labels.split(",") if label.strip()]
    script = session.create_script(build_script(probe_labels))
    script.on("message", on_message)
    script.load()

    deadline = time.time() + args.wait_seconds
    while time.time() < deadline and result_holder["payload"] is None:
        time.sleep(0.2)

    session.detach()

    output = {
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "processName": args.process_name,
        "pid": args.pid if args.pid else (process.pid if process else None),
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
