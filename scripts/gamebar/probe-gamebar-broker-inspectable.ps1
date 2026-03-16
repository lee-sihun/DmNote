param(
  [string]$OutputPath,
  [switch]$LaunchGameBar,
  [switch]$TerminateGameBar = $true
)

$ErrorActionPreference = 'Stop'

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class BrokerInspectableProbe {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryServiceLikeDelegate(IntPtr self, ref Guid serviceGuid, ref Guid riid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryInterfaceDelegate(IntPtr self, ref Guid iid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetIidsDelegate(IntPtr self, out uint iidCount, out IntPtr iids);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetRuntimeClassNameDelegate(IntPtr self, out IntPtr hstring);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetTrustLevelDelegate(IntPtr self, out int trustLevel);

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

  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr VirtualQuery(IntPtr lpAddress, out MEMORY_BASIC_INFORMATION lpBuffer, IntPtr dwLength);

  [DllImport("psapi.dll", CharSet=CharSet.Unicode)]
  private static extern uint GetMappedFileNameW(IntPtr hProcess, IntPtr lpv, StringBuilder lpFilename, uint nSize);

  [DllImport("combase.dll")]
  private static extern IntPtr WindowsGetStringRawBuffer(IntPtr hstring, out uint length);

  [DllImport("combase.dll")]
  private static extern int WindowsDeleteString(IntPtr hstring);

  private static readonly Guid BrokerClsid = new Guid("59614133-bfb4-4906-90af-c44f15167f1a");
  private static readonly Guid PrimaryIid = new Guid("9767060c-9476-42e2-8f7b-2f10fd13765c");
  private static readonly Guid FinalIid = new Guid("30dad006-cf4a-45e0-aec1-2195d76fd9c0");
  private static readonly Guid RelatedIid = new Guid("a3be5d0a-5420-50ee-a639-ff2ea687a270");
  private static readonly Guid IUnknownIid = new Guid("00000000-0000-0000-C000-000000000046");
  private static readonly Guid IInspectableIid = new Guid("AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90");

  private sealed class BrokerContext : IDisposable {
    public IntPtr Primary;
    public IntPtr Service;
    public IntPtr Final;

    public void Dispose() {
      if (Final != IntPtr.Zero) {
        Marshal.Release(Final);
        Final = IntPtr.Zero;
      }

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

  private static BrokerContext CreateBrokerContext() {
    var ctx = new BrokerContext();
    Guid brokerClsid = BrokerClsid;
    Guid primaryIid = PrimaryIid;
    Guid finalIid = FinalIid;

    int hrCreate = CoCreateInstance(ref brokerClsid, IntPtr.Zero, 4, ref primaryIid, out ctx.Primary);
    if (hrCreate < 0 || ctx.Primary == IntPtr.Zero) {
      throw new COMException("CoCreateInstance failed.", hrCreate);
    }

    IntPtr primaryVtbl = Marshal.ReadIntPtr(ctx.Primary);
    IntPtr slot12Ptr = Marshal.ReadIntPtr(primaryVtbl, 12 * IntPtr.Size);
    var queryService = Marshal.GetDelegateForFunctionPointer<QueryServiceLikeDelegate>(slot12Ptr);

    int hrService = queryService(ctx.Primary, ref finalIid, ref finalIid, out ctx.Service);
    if (hrService < 0 || ctx.Service == IntPtr.Zero) {
      throw new COMException("QueryService-like slot failed.", hrService);
    }

    IntPtr serviceVtbl = Marshal.ReadIntPtr(ctx.Service);
    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(serviceVtbl, 0));
    int hrQi = qi(ctx.Service, ref finalIid, out ctx.Final);
    if (hrQi < 0 || ctx.Final == IntPtr.Zero) {
      throw new COMException("Final QueryInterface failed.", hrQi);
    }

    return ctx;
  }

  private static Dictionary<string, object> InspectObject(string label, IntPtr ptr, Guid selfIid) {
    var result = new Dictionary<string, object>();
    result["label"] = label;
    result["ptr"] = String.Format("0x{0:X}", ptr.ToInt64());

    IntPtr vtbl = Marshal.ReadIntPtr(ptr);
    result["vtbl"] = String.Format("0x{0:X}", vtbl.ToInt64());
    result["module"] = ResolveModule(vtbl);

    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(vtbl, 0));

    Guid unknownIid = IUnknownIid;
    IntPtr sameUnknown;
    int hrUnknown = qi(ptr, ref unknownIid, out sameUnknown);
    result["qi_iunknown_hr"] = String.Format("0x{0:X8}", hrUnknown);
    result["qi_iunknown_nonzero"] = sameUnknown != IntPtr.Zero;
    if (sameUnknown != IntPtr.Zero) {
      Marshal.Release(sameUnknown);
    }

    Guid iid = selfIid;
    IntPtr sameInterface;
    int hrSelf = qi(ptr, ref iid, out sameInterface);
    result["qi_self_hr"] = String.Format("0x{0:X8}", hrSelf);
    result["qi_self_nonzero"] = sameInterface != IntPtr.Zero;
    if (sameInterface != IntPtr.Zero) {
      Marshal.Release(sameInterface);
    }

    Guid inspectableIid = IInspectableIid;
    IntPtr inspectablePtr;
    int hrInspectable = qi(ptr, ref inspectableIid, out inspectablePtr);
    result["qi_iinspectable_hr"] = String.Format("0x{0:X8}", hrInspectable);
    result["qi_iinspectable_nonzero"] = inspectablePtr != IntPtr.Zero;

    if (inspectablePtr != IntPtr.Zero) {
      IntPtr inspectableVtbl = Marshal.ReadIntPtr(inspectablePtr);
      result["inspectable_vtbl"] = String.Format("0x{0:X}", inspectableVtbl.ToInt64());
      result["inspectable_module"] = ResolveModule(inspectableVtbl);

      try {
        var getIids = Marshal.GetDelegateForFunctionPointer<GetIidsDelegate>(Marshal.ReadIntPtr(inspectableVtbl, 3 * IntPtr.Size));
        uint iidCount;
        IntPtr iidArray;
        int hrGetIids = getIids(inspectablePtr, out iidCount, out iidArray);
        result["get_iids_hr"] = String.Format("0x{0:X8}", hrGetIids);
        result["get_iids_count"] = iidCount;

        if (hrGetIids >= 0 && iidArray != IntPtr.Zero && iidCount > 0) {
          var iidList = new List<string>();
          int guidSize = Marshal.SizeOf<Guid>();
          for (int i = 0; i < iidCount; i++) {
            IntPtr current = IntPtr.Add(iidArray, i * guidSize);
            iidList.Add(Marshal.PtrToStructure<Guid>(current).ToString("D"));
          }

          result["iids"] = iidList;
          Marshal.FreeCoTaskMem(iidArray);
        }
      } catch (Exception ex) {
        result["get_iids_error"] = ex.GetType().Name;
      }

      try {
        var getRuntimeClassName = Marshal.GetDelegateForFunctionPointer<GetRuntimeClassNameDelegate>(Marshal.ReadIntPtr(inspectableVtbl, 4 * IntPtr.Size));
        IntPtr hstring;
        int hrRuntimeClass = getRuntimeClassName(inspectablePtr, out hstring);
        result["get_runtime_class_name_hr"] = String.Format("0x{0:X8}", hrRuntimeClass);

        if (hstring != IntPtr.Zero) {
          result["runtime_class_name"] = ReadHString(hstring);
          WindowsDeleteString(hstring);
        }
      } catch (Exception ex) {
        result["get_runtime_class_name_error"] = ex.GetType().Name;
      }

      try {
        var getTrustLevel = Marshal.GetDelegateForFunctionPointer<GetTrustLevelDelegate>(Marshal.ReadIntPtr(inspectableVtbl, 5 * IntPtr.Size));
        int trustLevel;
        int hrTrust = getTrustLevel(inspectablePtr, out trustLevel);
        result["get_trust_level_hr"] = String.Format("0x{0:X8}", hrTrust);
        result["trust_level"] = trustLevel;
      } catch (Exception ex) {
        result["get_trust_level_error"] = ex.GetType().Name;
      }

      Marshal.Release(inspectablePtr);
    }

    return result;
  }

  private static List<Dictionary<string, object>> InspectDiscoveredInterfaces(IntPtr ptr, IEnumerable<string> iids) {
    var results = new List<Dictionary<string, object>>();
    IntPtr vtbl = Marshal.ReadIntPtr(ptr);
    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(vtbl, 0));

    foreach (string iidText in iids) {
      Guid iid;
      if (!Guid.TryParse(iidText, out iid)) {
        continue;
      }

      IntPtr interfacePtr;
      int hr = qi(ptr, ref iid, out interfacePtr);
      var entry = new Dictionary<string, object>();
      entry["iid"] = iid.ToString("D");
      entry["query_interface_hr"] = String.Format("0x{0:X8}", hr);
      entry["query_interface_nonzero"] = interfacePtr != IntPtr.Zero;

      if (interfacePtr != IntPtr.Zero) {
        entry["inspection"] = InspectObject("DiscoveredInterface", interfacePtr, iid);
        Marshal.Release(interfacePtr);
      }

      results.Add(entry);
    }

    return results;
  }

  private static Dictionary<string, object> TryInspectQueryInterface(string label, IntPtr ptr, Guid iid) {
    IntPtr vtbl = Marshal.ReadIntPtr(ptr);
    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(vtbl, 0));
    IntPtr interfacePtr;
    int hr = qi(ptr, ref iid, out interfacePtr);

    var result = new Dictionary<string, object>();
    result["label"] = label;
    result["iid"] = iid.ToString("D");
    result["query_interface_hr"] = String.Format("0x{0:X8}", hr);
    result["query_interface_nonzero"] = interfacePtr != IntPtr.Zero;

    if (interfacePtr != IntPtr.Zero) {
      result["inspection"] = InspectObject(label, interfacePtr, iid);
      Marshal.Release(interfacePtr);
    }

    return result;
  }

  public static Dictionary<string, object> Run() {
    int hrInit = CoInitializeEx(IntPtr.Zero, 2);
    try {
      using (var ctx = CreateBrokerContext()) {
        var payload = new Dictionary<string, object>();
        payload["clsid"] = BrokerClsid.ToString("D");
        payload["primary_iid"] = PrimaryIid.ToString("D");
        payload["final_iid"] = FinalIid.ToString("D");
        payload["related_iid"] = RelatedIid.ToString("D");
        payload["coinit_hr"] = String.Format("0x{0:X8}", hrInit);
        payload["primary"] = InspectObject("Primary", ctx.Primary, PrimaryIid);
        payload["service"] = InspectObject("Service", ctx.Service, FinalIid);
        payload["final"] = InspectObject("Final", ctx.Final, FinalIid);
        payload["related_interface_probes"] = new List<Dictionary<string, object>> {
          TryInspectQueryInterface("PrimaryRelated", ctx.Primary, RelatedIid),
          TryInspectQueryInterface("ServiceRelated", ctx.Service, RelatedIid),
          TryInspectQueryInterface("FinalRelated", ctx.Final, RelatedIid)
        };

        var finalInfo = payload["final"] as Dictionary<string, object>;
        object iidsObject;
        if (finalInfo != null && finalInfo.TryGetValue("iids", out iidsObject)) {
          var iidList = iidsObject as IEnumerable<string>;
          if (iidList != null) {
            payload["discovered_interfaces"] = InspectDiscoveredInterfaces(ctx.Final, iidList);
          }
        }

        return payload;
      }
    } finally {
      if (hrInit >= 0) {
        CoUninitialize();
      }
    }
  }
}
'@

$tempSourcePath = Join-Path $env:TEMP ("gamebar_broker_inspectable_probe_{0}.cs" -f [guid]::NewGuid().ToString('N'))
Set-Content -Path $tempSourcePath -Value $code -Encoding ASCII
Add-Type -Path $tempSourcePath

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 2
}

try {
  $json = [BrokerInspectableProbe]::Run() | ConvertTo-Json -Depth 8
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
