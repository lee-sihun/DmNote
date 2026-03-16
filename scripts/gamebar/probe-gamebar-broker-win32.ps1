param(
  [string]$OutputPath,
  [switch]$LaunchGameBar,
  [switch]$TerminateGameBar = $true,
  [string[]]$Methods = @('show', 'hide', 'reset_window_rect', 'set_click_through_false')
)

$ErrorActionPreference = 'Stop'

@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class BrokerWin32Probe {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryServiceLikeDelegate(IntPtr self, ref Guid serviceGuid, ref Guid riid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryInterfaceDelegate(IntPtr self, ref Guid iid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int NoArgMethodDelegate(IntPtr self);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int BoolMethodDelegate(IntPtr self, int value);

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

  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr VirtualQuery(IntPtr lpAddress, out MEMORY_BASIC_INFORMATION lpBuffer, IntPtr dwLength);

  [DllImport("psapi.dll", CharSet=CharSet.Unicode)]
  private static extern uint GetMappedFileNameW(IntPtr hProcess, IntPtr lpv, StringBuilder lpFilename, uint nSize);

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  private static readonly Guid BrokerClsid = new Guid("59614133-bfb4-4906-90af-c44f15167f1a");
  private static readonly Guid PrimaryIid = new Guid("9767060c-9476-42e2-8f7b-2f10fd13765c");
  private static readonly Guid FinalIid = new Guid("30dad006-cf4a-45e0-aec1-2195d76fd9c0");

  private static string ResolveModule(IntPtr address) {
    MEMORY_BASIC_INFORMATION mbi;
    VirtualQuery(address, out mbi, (IntPtr)Marshal.SizeOf<MEMORY_BASIC_INFORMATION>());
    var sb = new StringBuilder(1024);
    GetMappedFileNameW(GetCurrentProcess(), mbi.AllocationBase, sb, 1024);
    return sb.ToString();
  }

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
    IntPtr qiPtr = Marshal.ReadIntPtr(serviceVtbl, 0);
    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(qiPtr);
    int hrQi = qi(ctx.Service, ref finalIid, out ctx.Final);
    if (hrQi < 0 || ctx.Final == IntPtr.Zero) {
      throw new COMException("Final QueryInterface failed.", hrQi);
    }

    return ctx;
  }

  private static Dictionary<string, object> ProbeContexts() {
    var result = new Dictionary<string, object>();
    uint[] contexts = new uint[] { 1, 4, 5, 16, 20, 21 };

    foreach (uint ctx in contexts) {
      Guid brokerClsid = BrokerClsid;
      Guid primaryIid = PrimaryIid;
      IntPtr ptr;
      int hr = CoCreateInstance(ref brokerClsid, IntPtr.Zero, ctx, ref primaryIid, out ptr);
      var ctxResult = new Dictionary<string, object>();
      ctxResult["hr"] = String.Format("0x{0:X8}", hr);
      ctxResult["ptr_nonzero"] = ptr != IntPtr.Zero;
      result["ctx_" + ctx.ToString()] = ctxResult;

      if (ptr != IntPtr.Zero) {
        Marshal.Release(ptr);
      }
    }

    return result;
  }

  private static Dictionary<string, object> ProbeChain() {
    using (var ctx = CreateBrokerContext()) {
      IntPtr primaryVtbl = Marshal.ReadIntPtr(ctx.Primary);
      IntPtr slot12Ptr = Marshal.ReadIntPtr(primaryVtbl, 12 * IntPtr.Size);
      IntPtr finalVtbl = Marshal.ReadIntPtr(ctx.Final);
      var chain = new Dictionary<string, object>();
      chain["primary_ptr"] = String.Format("0x{0:X}", ctx.Primary.ToInt64());
      chain["primary_vtbl"] = String.Format("0x{0:X}", primaryVtbl.ToInt64());
      chain["primary_slot12"] = String.Format("0x{0:X}", slot12Ptr.ToInt64());
      chain["primary_slot12_module"] = ResolveModule(slot12Ptr);
      chain["service_ptr"] = String.Format("0x{0:X}", ctx.Service.ToInt64());
      chain["final_ptr"] = String.Format("0x{0:X}", ctx.Final.ToInt64());
      chain["final_vtbl"] = String.Format("0x{0:X}", finalVtbl.ToInt64());
      chain["final_slot6"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(finalVtbl, 6 * IntPtr.Size).ToInt64());
      chain["final_slot7"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(finalVtbl, 7 * IntPtr.Size).ToInt64());
      chain["final_slot10"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(finalVtbl, 10 * IntPtr.Size).ToInt64());
      chain["final_slot39"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(finalVtbl, 39 * IntPtr.Size).ToInt64());
      chain["final_slot49"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(finalVtbl, 49 * IntPtr.Size).ToInt64());
      chain["final_slot51"] = String.Format("0x{0:X}", Marshal.ReadIntPtr(finalVtbl, 51 * IntPtr.Size).ToInt64());
      chain["final_proxy_module"] = ResolveModule(Marshal.ReadIntPtr(finalVtbl, 6 * IntPtr.Size));
      return chain;
    }
  }

  private static string InvokeNoArgSlot(int slotIndex) {
    using (var ctx = CreateBrokerContext()) {
      IntPtr finalVtbl = Marshal.ReadIntPtr(ctx.Final);
      IntPtr fn = Marshal.ReadIntPtr(finalVtbl, slotIndex * IntPtr.Size);
      var method = Marshal.GetDelegateForFunctionPointer<NoArgMethodDelegate>(fn);
      int hr = method(ctx.Final);
      return String.Format("0x{0:X8}", hr);
    }
  }

  private static string InvokeBoolSlot(int slotIndex, int value) {
    using (var ctx = CreateBrokerContext()) {
      IntPtr finalVtbl = Marshal.ReadIntPtr(ctx.Final);
      IntPtr fn = Marshal.ReadIntPtr(finalVtbl, slotIndex * IntPtr.Size);
      var method = Marshal.GetDelegateForFunctionPointer<BoolMethodDelegate>(fn);
      int hr = method(ctx.Final, value);
      return String.Format("0x{0:X8}", hr);
    }
  }

  private static Dictionary<string, object> InvokeSelectedMethods(string[] methods) {
    var methodResults = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

    foreach (var methodNameRaw in methods) {
      if (String.IsNullOrWhiteSpace(methodNameRaw)) {
        continue;
      }

      string methodName = methodNameRaw.Trim();
      switch (methodName.ToLowerInvariant()) {
        case "show":
          methodResults[methodName] = InvokeNoArgSlot(6);
          break;
        case "hide":
          methodResults[methodName] = InvokeNoArgSlot(7);
          break;
        case "reset_window_rect":
          methodResults[methodName] = InvokeNoArgSlot(10);
          break;
        case "set_click_through_false":
          methodResults[methodName] = InvokeBoolSlot(51, 0);
          break;
        case "set_click_through_true":
          methodResults[methodName] = InvokeBoolSlot(51, 1);
          break;
        default:
          methodResults[methodName] = "unsupported";
          break;
      }
    }

    return methodResults;
  }

  public static Dictionary<string, object> Run(string[] methods) {
    int hrInit = CoInitializeEx(IntPtr.Zero, 2);
    try {
      var payload = new Dictionary<string, object>();
      payload["clsid"] = BrokerClsid.ToString("D");
      payload["primary_iid"] = PrimaryIid.ToString("D");
      payload["final_iid"] = FinalIid.ToString("D");
      payload["coinit_hr"] = String.Format("0x{0:X8}", hrInit);
      payload["contexts"] = ProbeContexts();
      payload["chain"] = ProbeChain();
      payload["selected_methods"] = methods;
      payload["method_results"] = InvokeSelectedMethods(methods);

      return payload;
    } finally {
      if (hrInit >= 0) {
        CoUninitialize();
      }
    }
  }
}
'@ | Set-Content -Path "$env:TEMP\gamebar_broker_win32_probe.cs" -Encoding ASCII

Add-Type -Path "$env:TEMP\gamebar_broker_win32_probe.cs"

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 2
}

try {
  $json = [BrokerWin32Probe]::Run($Methods) | ConvertTo-Json -Depth 8
} finally {
  if ($TerminateGameBar) {
    Get-Process GameBar -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

if ($OutputPath) {
  $parent = Split-Path -Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
