param(
  [string]$OutputPath,
  [switch]$LaunchGameBar,
  [bool]$TerminateGameBar = $false
)

$ErrorActionPreference = 'Stop'

@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class BrokerHiddenQiGraphProbe {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryServiceLikeDelegate(IntPtr self, ref Guid serviceGuid, ref Guid riid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryInterfaceDelegate(IntPtr self, ref Guid iid, out IntPtr ppv);

  [DllImport("ole32.dll")]
  private static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

  [DllImport("ole32.dll")]
  private static extern void CoUninitialize();

  [DllImport("ole32.dll")]
  private static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext, ref Guid riid, out IntPtr ppv);

  private static readonly Guid BrokerClsid = new Guid("59614133-bfb4-4906-90af-c44f15167f1a");
  private static readonly Guid PrimaryIid = new Guid("9767060c-9476-42e2-8f7b-2f10fd13765c");
  private static readonly Guid FinalIid = new Guid("30dad006-cf4a-45e0-aec1-2195d76fd9c0");
  private static readonly Guid Hidden1Iid = new Guid("5eac68f9-e031-4c66-b4ea-5ab6aff979c8");
  private static readonly Guid Hidden2Iid = new Guid("d6332df0-dbfb-575e-93f1-c7bff0693913");

  private static readonly Guid[] ProbeIids = new Guid[] {
    new Guid("30dad006-cf4a-45e0-aec1-2195d76fd9c0"),
    new Guid("5eac68f9-e031-4c66-b4ea-5ab6aff979c8"),
    new Guid("d6332df0-dbfb-575e-93f1-c7bff0693913"),
    new Guid("9f8edc08-cbcc-59b7-8dee-a299deb75fc1"),
    new Guid("ab758746-5c5d-5738-9439-3e85dade945c"),
    new Guid("b4b868ab-eef2-5bf5-8992-fbbef2582d2d"),
    new Guid("9f45f4ae-912a-53ec-b31d-01b39be7b957"),
    new Guid("c8f91eef-ea1b-5aee-ad42-66842218d157"),
    new Guid("9302a129-7433-42a0-9cb8-5da5964f2756"),
    new Guid("c343e0c0-9666-444b-898f-cc498c7e521a"),
    new Guid("8f352570-5bb7-4d72-921f-6fb3f2611c71"),
    new Guid("65476df8-27e5-47be-9aae-29b9921dcb70"),
    new Guid("054da1f8-65a1-4805-9902-ca6561227524"),
    new Guid("a8c66395-6ae3-4a53-8547-992bd899d74d"),
    new Guid("e85a41cb-d4e3-4e1d-9348-a584f1623a36")
  };

  private sealed class BrokerContext : IDisposable {
    public IntPtr Primary;
    public IntPtr Service;
    public IntPtr Final;
    public IntPtr Hidden1;
    public IntPtr Hidden2;

    public void Dispose() {
      Release(ref Hidden2);
      Release(ref Hidden1);
      Release(ref Final);
      Release(ref Service);
      Release(ref Primary);
    }

    private static void Release(ref IntPtr ptr) {
      if (ptr != IntPtr.Zero) {
        Marshal.Release(ptr);
        ptr = IntPtr.Zero;
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
    var queryServiceLike = Marshal.GetDelegateForFunctionPointer<QueryServiceLikeDelegate>(slot12);
    int hrService = queryServiceLike(ctx.Primary, ref serviceIid, ref serviceIid, out ctx.Service);
    if (hrService < 0 || ctx.Service == IntPtr.Zero) {
      throw new COMException("QueryService-like failed.", hrService);
    }

    ctx.Final = Query(ctx.Service, FinalIid);
    ctx.Hidden1 = Query(ctx.Service, Hidden1Iid);
    ctx.Hidden2 = Query(ctx.Service, Hidden2Iid);
    return ctx;
  }

  private static IntPtr Query(IntPtr source, Guid iid) {
    IntPtr vtbl = Marshal.ReadIntPtr(source);
    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(vtbl, 0));
    IntPtr ptr;
    int hr = qi(source, ref iid, out ptr);
    if (hr < 0 || ptr == IntPtr.Zero) {
      return IntPtr.Zero;
    }
    return ptr;
  }

  private static Dictionary<string, object> QueryMap(IntPtr source, string sourceName) {
    var result = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
    result["source_name"] = sourceName;
    result["source_ptr"] = source == IntPtr.Zero ? null : String.Format("0x{0:X}", source.ToInt64());

    if (source == IntPtr.Zero) {
      return result;
    }

    IntPtr vtbl = Marshal.ReadIntPtr(source);
    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(vtbl, 0));
    var map = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

    foreach (var iid in ProbeIids) {
      IntPtr ptr;
      Guid current = iid;
      int hr = qi(source, ref current, out ptr);
      map[current.ToString("D")] = new Dictionary<string, object> {
        { "hr", String.Format("0x{0:X8}", hr) },
        { "ptr_nonzero", ptr != IntPtr.Zero }
      };

      if (ptr != IntPtr.Zero) {
        Marshal.Release(ptr);
      }
    }

    result["qi_map"] = map;
    return result;
  }

  public static Dictionary<string, object> Run() {
    int hrInit = CoInitializeEx(IntPtr.Zero, 2);
    try {
      using (var ctx = CreateContext()) {
        return new Dictionary<string, object> {
          { "coinit_hr", String.Format("0x{0:X8}", hrInit) },
          { "faces", new Dictionary<string, object> {
            { "final", QueryMap(ctx.Final, "final") },
            { "hidden1", QueryMap(ctx.Hidden1, "hidden1") },
            { "hidden2", QueryMap(ctx.Hidden2, "hidden2") }
          } }
        };
      }
    } finally {
      if (hrInit >= 0) {
        CoUninitialize();
      }
    }
  }
}
'@ | Set-Content -Path "$env:TEMP\gamebar_hidden_qi_graph_probe.cs" -Encoding ASCII

Add-Type -Path "$env:TEMP\gamebar_hidden_qi_graph_probe.cs"

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 2
}

try {
  $json = [BrokerHiddenQiGraphProbe]::Run() | ConvertTo-Json -Depth 10
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
