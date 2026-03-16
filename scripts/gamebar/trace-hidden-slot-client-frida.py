import argparse
import json
import subprocess
import time
from pathlib import Path

import frida


JS_SOURCE = r"""
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

  return null;
}

function readGuid(ptrValue) {
  try {
    if (!ptrValue || ptrValue.isNull()) {
      return null;
    }
    const bytes = [];
    for (let i = 0; i < 16; i++) {
      bytes.push(ptrValue.add(i).readU8());
    }
    function hex(v, width) {
      return v.toString(16).padStart(width, "0");
    }
    const d1 = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
    const d2 = bytes[4] | (bytes[5] << 8);
    const d3 = bytes[6] | (bytes[7] << 8);
    const tail = bytes.slice(8).map(v => hex(v, 2));
    return [
      hex(d1 >>> 0, 8),
      hex(d2, 4),
      hex(d3, 4),
      tail.slice(0, 2).join(""),
      tail.slice(2).join("")
    ].join("-");
  } catch (_) {
    return null;
  }
}

function safeReadUtf16(ptrValue) {
  try {
    if (!ptrValue || ptrValue.isNull()) {
      return null;
    }
    return ptr(ptrValue).readUtf16String();
  } catch (_) {
    return null;
  }
}

function addHook(moduleName, functionName, onEnterBody, onLeaveBody) {
  const address = resolveExport(moduleName, functionName);
  if (address === null) {
    return;
  }
  Interceptor.attach(address, {
    onEnter(args) {
      try {
        onEnterBody.call(this, args);
      } catch (error) {
        send({ type: "hook-error", hook: functionName, phase: "enter", error: String(error) });
      }
    },
    onLeave(retval) {
      try {
        onLeaveBody.call(this, retval);
      } catch (error) {
        send({ type: "hook-error", hook: functionName, phase: "leave", error: String(error) });
      }
    }
  });
}

addHook("ole32.dll", "CoGetPSClsid", function(args) {
  this.iid = readGuid(args[0]);
  this.psclsidPtr = args[1];
}, function(retval) {
  const evt = {
    type: "CoGetPSClsid",
    iid: this.iid,
    hr: retval.toString()
  };
  if (this.psclsidPtr && !this.psclsidPtr.isNull()) {
    evt.psclsid = readGuid(this.psclsidPtr);
  }
  send(evt);
});

addHook("ole32.dll", "CoGetClassObject", function(args) {
  this.clsid = readGuid(args[0]);
  this.iid = readGuid(args[3]);
}, function(retval) {
  send({
    type: "CoGetClassObject",
    clsid: this.clsid,
    iid: this.iid,
    hr: retval.toString()
  });
});

addHook("ole32.dll", "CoCreateInstance", function(args) {
  this.clsid = readGuid(args[0]);
  this.iid = readGuid(args[3]);
}, function(retval) {
  send({
    type: "CoCreateInstance",
    clsid: this.clsid,
    iid: this.iid,
    hr: retval.toString()
  });
});

addHook("advapi32.dll", "RegOpenKeyExW", function(args) {
  this.subkey = safeReadUtf16(args[1]);
}, function(retval) {
  const subkey = this.subkey || "";
  if (
    subkey.toLowerCase().includes("interface\\") ||
    subkey.toLowerCase().includes("clsid\\") ||
    subkey.toLowerCase().includes("proxystubclsid")
  ) {
    send({
      type: "RegOpenKeyExW",
      subkey: subkey,
      status: retval.toInt32()
    });
  }
});
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    probe_script = repo_root / "scripts" / "gamebar" / "probe-gamebar-broker-slot.ps1"

    command = [
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(probe_script),
        "-InterfaceName",
        "hidden1",
        "-Slot",
        "7",
        "-Signature",
        "outptr",
        "-PreInvokeDelayMs",
        "4000",
    ]

    device = frida.get_local_device()
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    time.sleep(1)
    session = device.attach(child.pid)
    script = session.create_script(JS_SOURCE)
    events = []

    def on_message(message, data):
        if message.get("type") == "send":
            events.append(message.get("payload"))
        elif message.get("type") == "error":
            events.append(message)

    script.on("message", on_message)
    script.load()
    stdout, stderr = child.communicate(timeout=30)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({
        "events": events,
        "stdout": stdout,
        "stderr": stderr,
        "returncode": child.returncode,
    }, indent=2), encoding="utf-8")
    try:
        session.detach()
    except Exception:
        pass


if __name__ == "__main__":
    main()
