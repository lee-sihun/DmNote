param(
  [string]$OutputPath,
  [string]$InterfaceName = 'final',
  [int]$Slot,
  [ValidateSet('noarg', 'bool', 'outptr')]
  [string]$Signature = 'noarg',
  [int]$BoolValue = 0,
  [int]$PreInvokeDelayMs = 0,
  [switch]$LaunchGameBar,
  [bool]$TerminateGameBar = $false
)

$ErrorActionPreference = 'Stop'

@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class BrokerSlotProbe {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryServiceLikeDelegate(IntPtr self, ref Guid serviceGuid, ref Guid riid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryInterfaceDelegate(IntPtr self, ref Guid iid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int NoArgDelegate(IntPtr self);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int BoolDelegate(IntPtr self, int value);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int OutPtrDelegate(IntPtr self, out IntPtr value);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetIidsDelegate(IntPtr self, out uint iidCount, out IntPtr iids);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetRuntimeClassNameDelegate(IntPtr self, out IntPtr hstring);

  [StructLayout(LayoutKind.Sequential)]
  private struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public ushort PartitionId;
    public IntPtr RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
  }

  [DllImport("ole32.dll")]
  private static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

  [DllImport("ole32.dll")]
  private static extern void CoUninitialize();

  [DllImport("ole32.dll")]
  private static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext, ref Guid riid, out IntPtr ppv);

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr VirtualQuery(IntPtr lpAddress, out MEMORY_BASIC_INFORMATION lpBuffer, IntPtr dwLength);

  [DllImport("psapi.dll", CharSet = CharSet.Unicode)]
  private static extern uint GetMappedFileNameW(IntPtr hProcess, IntPtr lpv, StringBuilder lpFilename, uint nSize);

  [DllImport("combase.dll")]
  private static extern IntPtr WindowsGetStringRawBuffer(IntPtr hstring, out uint length);

  [DllImport("combase.dll")]
  private static extern int WindowsDeleteString(IntPtr hstring);

  private static readonly Guid BrokerClsid = new Guid("59614133-bfb4-4906-90af-c44f15167f1a");
  private static readonly Guid PrimaryIid = new Guid("9767060c-9476-42e2-8f7b-2f10fd13765c");
  private static readonly Guid FinalIid = new Guid("30dad006-cf4a-45e0-aec1-2195d76fd9c0");
  private static readonly Guid Hidden1Iid = new Guid("5eac68f9-e031-4c66-b4ea-5ab6aff979c8");
  private static readonly Guid Hidden2Iid = new Guid("d6332df0-dbfb-575e-93f1-c7bff0693913");
  private static readonly Guid IUnknownIid = new Guid("00000000-0000-0000-C000-000000000046");
  private static readonly Guid IInspectableIid = new Guid("AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90");

  private static string ResolveModule(IntPtr address) {
    MEMORY_BASIC_INFORMATION mbi;
    VirtualQuery(address, out mbi, (IntPtr)Marshal.SizeOf<MEMORY_BASIC_INFORMATION>());
    var sb = new StringBuilder(1024);
    GetMappedFileNameW(GetCurrentProcess(), mbi.AllocationBase, sb, 1024);
    return sb.ToString();
  }

  private static string ReadHString(IntPtr hstring) {
    if (hstring == IntPtr.Zero) {
      return null;
    }

    uint length;
    IntPtr buffer = WindowsGetStringRawBuffer(hstring, out length);
    if (buffer == IntPtr.Zero || length == 0) {
      return string.Empty;
    }

    return Marshal.PtrToStringUni(buffer, (int)length);
  }

  private static Guid ResolveInterfaceIid(string interfaceName) {
    Guid parsed;
    if (Guid.TryParse(interfaceName, out parsed)) {
      return parsed;
    }

    switch ((interfaceName ?? string.Empty).ToLowerInvariant()) {
      case "hidden1":
        return Hidden1Iid;
      case "hidden2":
        return Hidden2Iid;
      default:
        return FinalIid;
    }
  }

  private sealed class BrokerContext : IDisposable {
    public IntPtr Primary;
    public IntPtr Service;

    public void Dispose() {
      if (Service != IntPtr.Zero) {
        Marshal.Release(Service);
        Service = IntPtr.Zero;
      }

      if (Primary != IntPtr.Zero) {
        Marshal.Release(Primary);
        Primary = IntPtr.Zero;
      }
    }
  }

  private static BrokerContext CreateContext() {
    var ctx = new BrokerContext();
    Guid brokerClsid = BrokerClsid;
    Guid primaryIid = PrimaryIid;
    Guid serviceIid = FinalIid;

    int hrCreate = CoCreateInstance(ref brokerClsid, IntPtr.Zero, 4, ref primaryIid, out ctx.Primary);
    if (hrCreate < 0 || ctx.Primary == IntPtr.Zero) {
      throw new COMException("CoCreateInstance failed.", hrCreate);
    }

    IntPtr primaryVtbl = Marshal.ReadIntPtr(ctx.Primary);
    IntPtr slot12 = Marshal.ReadIntPtr(primaryVtbl, 12 * IntPtr.Size);
    var queryService = Marshal.GetDelegateForFunctionPointer<QueryServiceLikeDelegate>(slot12);

    int hrService = queryService(ctx.Primary, ref serviceIid, ref serviceIid, out ctx.Service);
    if (hrService < 0 || ctx.Service == IntPtr.Zero) {
      throw new COMException("QueryService-like slot failed.", hrService);
    }

    return ctx;
  }

  private static Dictionary<string, object> InspectReturnedObject(IntPtr ptr) {
    var result = new Dictionary<string, object>();
    result["ptr"] = String.Format("0x{0:X}", ptr.ToInt64());

    if (ptr == IntPtr.Zero) {
      return result;
    }

    IntPtr vtbl = Marshal.ReadIntPtr(ptr);
    result["vtbl"] = String.Format("0x{0:X}", vtbl.ToInt64());
    result["module"] = ResolveModule(vtbl);

    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(vtbl, 0));

    Guid unknownIid = IUnknownIid;
    IntPtr unknownPtr;
    int hrUnknown = qi(ptr, ref unknownIid, out unknownPtr);
    result["qi_iunknown_hr"] = String.Format("0x{0:X8}", hrUnknown);
    if (unknownPtr != IntPtr.Zero) {
      result["qi_iunknown_ptr"] = String.Format("0x{0:X}", unknownPtr.ToInt64());
      Marshal.Release(unknownPtr);
    }

    Guid inspectableIid = IInspectableIid;
    IntPtr inspectablePtr;
    int hrInspectable = qi(ptr, ref inspectableIid, out inspectablePtr);
    result["qi_iinspectable_hr"] = String.Format("0x{0:X8}", hrInspectable);

    if (inspectablePtr != IntPtr.Zero) {
      try {
        IntPtr inspectableVtbl = Marshal.ReadIntPtr(inspectablePtr);
        result["inspectable_vtbl"] = String.Format("0x{0:X}", inspectableVtbl.ToInt64());
        result["inspectable_module"] = ResolveModule(inspectableVtbl);

        var getIids = Marshal.GetDelegateForFunctionPointer<GetIidsDelegate>(Marshal.ReadIntPtr(inspectableVtbl, 3 * IntPtr.Size));
        uint iidCount;
        IntPtr iidArray;
        int hrGetIids = getIids(inspectablePtr, out iidCount, out iidArray);
        result["get_iids_hr"] = String.Format("0x{0:X8}", hrGetIids);
        result["get_iids_count"] = iidCount;

        if (hrGetIids >= 0 && iidArray != IntPtr.Zero && iidCount > 0) {
          var iidList = new List<string>();
          int guidSize = Marshal.SizeOf<Guid>();
          for (int index = 0; index < iidCount; index++) {
            iidList.Add(Marshal.PtrToStructure<Guid>(IntPtr.Add(iidArray, index * guidSize)).ToString("D"));
          }

          result["iids"] = iidList;
          Marshal.FreeCoTaskMem(iidArray);
        }

        var getRuntimeClassName = Marshal.GetDelegateForFunctionPointer<GetRuntimeClassNameDelegate>(Marshal.ReadIntPtr(inspectableVtbl, 4 * IntPtr.Size));
        IntPtr hstring;
        int hrRuntimeClass = getRuntimeClassName(inspectablePtr, out hstring);
        result["get_runtime_class_name_hr"] = String.Format("0x{0:X8}", hrRuntimeClass);
        if (hstring != IntPtr.Zero) {
          result["runtime_class_name"] = ReadHString(hstring);
          WindowsDeleteString(hstring);
        }
      } finally {
        Marshal.Release(inspectablePtr);
      }
    }

    return result;
  }

  public static Dictionary<string, object> Run(string interfaceName, int slot, string signature, int boolValue, int preInvokeDelayMs) {
    int hrInit = CoInitializeEx(IntPtr.Zero, 2);
    try {
      using (var ctx = CreateContext()) {
        Guid iid = ResolveInterfaceIid(interfaceName);
        IntPtr serviceVtbl = Marshal.ReadIntPtr(ctx.Service);
        var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(serviceVtbl, 0));
        IntPtr iface;
        int hrQi = qi(ctx.Service, ref iid, out iface);

        var payload = new Dictionary<string, object>();
        payload["interface_name"] = interfaceName;
        payload["interface_iid"] = iid.ToString("D");
        payload["slot"] = slot;
        payload["signature"] = signature;
        payload["bool_value"] = boolValue;
        payload["pre_invoke_delay_ms"] = preInvokeDelayMs;
        payload["coinit_hr"] = String.Format("0x{0:X8}", hrInit);
        payload["query_interface_hr"] = String.Format("0x{0:X8}", hrQi);

        if (iface == IntPtr.Zero) {
          return payload;
        }

        try {
          payload["iface_ptr"] = String.Format("0x{0:X}", iface.ToInt64());
          payload["iface_vtbl"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(iface).ToInt64());
          payload["iface_module"] = ResolveModule(Marshal.ReadIntPtr(iface));
          payload["descriptor_ptr"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(iface, 10 * IntPtr.Size).ToInt64());

          IntPtr fn = Marshal.ReadIntPtr(Marshal.ReadIntPtr(iface), slot * IntPtr.Size);
          payload["fn_ptr"] = String.Format("0x{0:X}", fn.ToInt64());
          payload["fn_module"] = ResolveModule(fn);

          if (preInvokeDelayMs > 0) {
            Thread.Sleep(preInvokeDelayMs);
          }

          switch (signature.ToLowerInvariant()) {
            case "bool":
              {
                var method = Marshal.GetDelegateForFunctionPointer<BoolDelegate>(fn);
                int hr = method(iface, boolValue);
                payload["invoke_hr"] = String.Format("0x{0:X8}", hr);
                break;
              }
            case "outptr":
              {
                var method = Marshal.GetDelegateForFunctionPointer<OutPtrDelegate>(fn);
                IntPtr value;
                int hr = method(iface, out value);
                payload["invoke_hr"] = String.Format("0x{0:X8}", hr);
                payload["out_ptr"] = value == IntPtr.Zero ? null : String.Format("0x{0:X}", value.ToInt64());

                if (value != IntPtr.Zero) {
                  payload["out_ptr_inspection"] = InspectReturnedObject(value);
                  Marshal.Release(value);
                }
                break;
              }
            default:
              {
                var method = Marshal.GetDelegateForFunctionPointer<NoArgDelegate>(fn);
                int hr = method(iface);
                payload["invoke_hr"] = String.Format("0x{0:X8}", hr);
                break;
              }
          }

          return payload;
        } finally {
          Marshal.Release(iface);
        }
      }
    } finally {
      if (hrInit >= 0) {
        CoUninitialize();
      }
    }
  }
}
'@ | Set-Content -Path "$env:TEMP\gamebar_broker_slot_probe.cs" -Encoding ASCII

Add-Type -Path "$env:TEMP\gamebar_broker_slot_probe.cs"

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 2
}

try {
  $json = [BrokerSlotProbe]::Run($InterfaceName, $Slot, $Signature, $BoolValue, $PreInvokeDelayMs) | ConvertTo-Json -Depth 8
} finally {
  if ($TerminateGameBar) {
    Get-Process GameBar -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

if ($OutputPath) {
  $dir = Split-Path -Parent $OutputPath
  if ($dir) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
} else {
  $json
}
