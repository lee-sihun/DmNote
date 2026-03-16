import argparse
import json
import sys
import time
import uuid
from pathlib import Path

import frida


GUIDS = {
    "IActivationFactory": "00000035-0000-0000-C000-000000000046",
    "IUnknown": "00000000-0000-0000-C000-000000000046",
    "IGbftFactory": "6BFBA441-F863-58CF-9604-0AE9049EF42A",
    "IWindowManagerFT": "BF5BA331-861E-5121-A167-CA786ADB6B2B",
    "FtFactoryClsid": "FD06603A-2BDF-4BB1-B7DF-5DC68F353601",
}


JS_TEMPLATE = r"""
const guidBytes = %GUID_BYTES%;

function hex32(value) {
  const normalized = (value >>> 0).toString(16).toUpperCase();
  return "0x" + normalized.padStart(8, "0");
}

function writeByteArray(address, values) {
  if (address.writeByteArray) {
    address.writeByteArray(values);
    return;
  }
  Memory.writeByteArray(address, values);
}

function allocGuid(name) {
  const buffer = Memory.alloc(16);
  writeByteArray(buffer, guidBytes[name]);
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

function resolveExport(moduleName, functionName) {
  try {
    if (typeof Module.findExportByName === "function") {
      const value = Module.findExportByName(moduleName, functionName);
      if (value !== null) {
        return value;
      }
    }
  } catch (_) {}

  try {
    if (typeof Module.getExportByName === "function") {
      return Module.getExportByName(moduleName, functionName);
    }
  } catch (_) {}

  try {
    return Process.getModuleByName(moduleName).getExportByName(functionName);
  } catch (_) {}

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
    return typeof length === "number" ? ptrValue.readUtf16String(length) : ptrValue.readUtf16String();
  }
  return typeof Memory.readUtf16String === "function"
    ? (typeof length === "number" ? Memory.readUtf16String(ptrValue, length) : Memory.readUtf16String(ptrValue))
    : null;
}

const roInitialize = new NativeFunction(resolveExport("combase.dll", "RoInitialize"), "int", ["uint32"]);
const roUninitialize = new NativeFunction(resolveExport("combase.dll", "RoUninitialize"), "void", []);
const coCreateInstance = new NativeFunction(resolveExport("ole32.dll", "CoCreateInstance"), "int", ["pointer", "pointer", "uint32", "pointer", "pointer"]);
const getDesktopWindow = new NativeFunction(resolveExport("user32.dll", "GetDesktopWindow"), "pointer", []);
const getCurrentPackageFullName = new NativeFunction(resolveExport("kernel32.dll", "GetCurrentPackageFullName"), "int", ["pointer", "pointer"]);
const windowsDeleteString = new NativeFunction(resolveExport("combase.dll", "WindowsDeleteString"), "int", ["pointer"]);
const windowsGetStringRawBuffer = new NativeFunction(resolveExport("combase.dll", "WindowsGetStringRawBuffer"), "pointer", ["pointer", "pointer"]);

function getPackageFullName() {
  const lengthPtr = Memory.alloc(4);
  writePointer(lengthPtr, ptr(0));
  let hr = getCurrentPackageFullName(lengthPtr, ptr(0));
  const length = readU32(lengthPtr);
  if (length === 0) {
    return { hr: hex32(hr), value: null };
  }
  const buffer = Memory.alloc(length * 2);
  hr = getCurrentPackageFullName(lengthPtr, buffer);
  return { hr: hex32(hr), value: readUtf16(buffer) };
}

function releaseCom(instance) {
  if (!instance || instance.isNull()) {
    return;
  }
  try {
    const vtable = readPointer(instance);
    const release = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 2)), "uint32", ["pointer"], { exceptions: "steal" });
    release(instance);
  } catch (_) {}
}

function queryInterface(instance, iidName) {
  const resultPtr = Memory.alloc(Process.pointerSize);
  writePointer(resultPtr, NULL);
  const vtable = readPointer(instance);
  const queryInterfaceFn = new NativeFunction(readPointer(vtable), "int", ["pointer", "pointer", "pointer"], { exceptions: "steal" });
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
  const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 4)), "int", ["pointer", "pointer"], { exceptions: "steal" });
  const hr = fn(instance, outPtr);
  const hstring = readPointer(outPtr);
  const lengthPtr = Memory.alloc(4);
  const buffer = hstring.isNull() ? NULL : windowsGetStringRawBuffer(hstring, lengthPtr);
  const name = buffer.isNull() ? null : readUtf16(buffer, readU32(lengthPtr));
  if (!hstring.isNull()) {
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
  const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 6)), "int", ["pointer", "pointer"], { exceptions: "steal" });
  const hr = fn(factory, outPtr);
  return {
    hr: hex32(hr),
    pointer: readPointer(outPtr),
  };
}

function tryCallSlot(instance, slotIndex, signature, args) {
  try {
    const vtable = readPointer(instance);
    const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * slotIndex)), signature.ret, signature.args, { exceptions: "steal" });
    const hr = fn.apply(null, [instance].concat(args));
    return { hr: hex32(hr) };
  } catch (error) {
    return { exception: String(error && error.stack ? error.stack : error) };
  }
}

function callGetWindowLong(windowManager, hwnd, index) {
  const outPtr = Memory.alloc(4);
  const vtable = readPointer(windowManager);
  const fn = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 8)), "int", ["pointer", "pointer", "int", "pointer"], { exceptions: "steal" });
  const hr = fn(windowManager, hwnd, index, outPtr);
  return {
    hr: hex32(hr),
    value: "0x" + readU32(outPtr).toString(16).toUpperCase().padStart(8, "0"),
  };
}

setTimeout(function () {
  const result = {
    processName: (typeof Process.name !== "undefined" ? String(Process.name) : null),
    processId: Process.id,
    packageFullName: getPackageFullName(),
    roInitializeHr: null,
  };

  const hrInit = roInitialize(1);
  result.roInitializeHr = hex32(hrInit);

  let unknown = NULL;
  let activationFactory = NULL;
  let activated = NULL;
  let qiGbft = NULL;
  let slotWindowManager = NULL;

  try {
    const outPtr = Memory.alloc(Process.pointerSize);
    writePointer(outPtr, NULL);
    const hrCreate = coCreateInstance(allocGuid("FtFactoryClsid"), NULL, 4, allocGuid("IUnknown"), outPtr);
    unknown = readPointer(outPtr);
    result.coCreateIUnknownHr = hex32(hrCreate);
    result.coCreateIUnknownPointer = ptrHex(unknown);

    if (!unknown.isNull()) {
      const qiActivation = queryInterface(unknown, "IActivationFactory");
      result.queryInterfaceActivationFactoryHr = qiActivation.hr;
      result.queryInterfaceActivationFactoryPointer = ptrHex(qiActivation.pointer);
      activationFactory = qiActivation.pointer;
    }

    if (!activationFactory.isNull()) {
      const activatedResult = activateInstance(activationFactory);
      activated = activatedResult.pointer;
      result.activateInstanceHr = activatedResult.hr;
      result.activateInstancePointer = ptrHex(activated);
      if (!activated.isNull()) {
        result.activatedRuntimeClass = getRuntimeClassName(activated);

        const qiFactory = queryInterface(activated, "IGbftFactory");
        qiGbft = qiFactory.pointer;
        result.queryInterfaceIGbftFactoryHr = qiFactory.hr;
        result.queryInterfaceIGbftFactoryPointer = ptrHex(qiGbft);

        const wmOut = Memory.alloc(Process.pointerSize);
        writePointer(wmOut, NULL);
        try {
          const vtable = readPointer(activated);
          const slot11 = new NativeFunction(readPointer(vtable.add(Process.pointerSize * 11)), "int", ["pointer", "pointer"], { exceptions: "steal" });
          const hr = slot11(activated, wmOut);
          slotWindowManager = readPointer(wmOut);
          result.defaultInterfaceCreateWindowManagerHr = hex32(hr);
          result.defaultInterfaceCreateWindowManagerPointer = ptrHex(slotWindowManager);
          if (!slotWindowManager.isNull()) {
            result.defaultInterfaceWindowManagerRuntimeClass = getRuntimeClassName(slotWindowManager);
            const qiWm = queryInterface(slotWindowManager, "IWindowManagerFT");
            result.defaultInterfaceWindowManagerQiHr = qiWm.hr;
            result.defaultInterfaceWindowManagerQiPointer = ptrHex(qiWm.pointer);
            if (!qiWm.pointer.isNull()) {
              const desktop = getDesktopWindow();
              result.defaultInterfaceWindowManagerProbe = {
                desktopStyle: callGetWindowLong(qiWm.pointer, desktop, -16),
                desktopExStyle: callGetWindowLong(qiWm.pointer, desktop, -20),
              };
            }
            releaseCom(qiWm.pointer);
          }
        } catch (error) {
          result.defaultInterfaceCreateWindowManagerException = String(error && error.stack ? error.stack : error);
        }
      }
    }
  } finally {
    releaseCom(slotWindowManager);
    releaseCom(qiGbft);
    releaseCom(activated);
    releaseCom(activationFactory);
    releaseCom(unknown);
    if (hrInit >= 0) {
      roUninitialize();
    }
  }

  send({ type: "result", payload: result });
}, 250);
"""


def get_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--process-name", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--wait-seconds", type=int, default=10)
    return parser.parse_args()


def guid_to_bytes_le(value: str) -> list[int]:
    return list(uuid.UUID(value).bytes_le)


def build_script() -> str:
    guid_bytes = {name: guid_to_bytes_le(value) for name, value in GUIDS.items()}
    return JS_TEMPLATE.replace("%GUID_BYTES%", json.dumps(guid_bytes))


def wait_for_process(device, process_name: str, timeout_seconds: int):
    deadline = time.time() + timeout_seconds
    target = process_name.lower()
    while time.time() < deadline:
        for process in device.enumerate_processes():
            if process.name.lower() == target:
                return process
        time.sleep(0.5)
    raise RuntimeError(f"대상 프로세스를 찾지 못했습니다: {process_name}")


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

    script = session.create_script(build_script())
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
