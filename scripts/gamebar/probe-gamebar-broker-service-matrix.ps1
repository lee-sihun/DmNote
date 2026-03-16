param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class BrokerServiceMatrixProbe {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryServiceLikeDelegate(IntPtr self, ref Guid serviceGuid, ref Guid riid, out IntPtr ppv);

  [DllImport("ole32.dll")]
  private static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

  [DllImport("ole32.dll")]
  private static extern void CoUninitialize();

  [DllImport("ole32.dll")]
  private static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext, ref Guid riid, out IntPtr ppv);

  private static readonly Guid BrokerClsid = new Guid("59614133-bfb4-4906-90af-c44f15167f1a");
  private static readonly Guid PrimaryIid = new Guid("9767060c-9476-42e2-8f7b-2f10fd13765c");
  private static readonly Dictionary<string, Guid> Iids = new Dictionary<string, Guid> {
    { "final", new Guid("30dad006-cf4a-45e0-aec1-2195d76fd9c0") },
    { "hidden1", new Guid("5eac68f9-e031-4c66-b4ea-5ab6aff979c8") },
    { "hidden2", new Guid("d6332df0-dbfb-575e-93f1-c7bff0693913") }
  };

  public static Dictionary<string, object> Run() {
    var payload = new Dictionary<string, object>();
    int hrInit = CoInitializeEx(IntPtr.Zero, 2);
    IntPtr primary = IntPtr.Zero;

    try {
      Guid clsid = BrokerClsid;
      Guid iid = PrimaryIid;
      int hr = CoCreateInstance(ref clsid, IntPtr.Zero, 4, ref iid, out primary);
      payload["coinit_hr"] = string.Format("0x{0:X8}", hrInit);
      payload["cocreate_hr"] = string.Format("0x{0:X8}", hr);

      if (primary == IntPtr.Zero) {
        return payload;
      }

      IntPtr vtbl = Marshal.ReadIntPtr(primary);
      IntPtr slot12 = Marshal.ReadIntPtr(vtbl, 12 * IntPtr.Size);
      payload["slot12"] = string.Format("0x{0:X}", slot12.ToInt64());

      var qs = Marshal.GetDelegateForFunctionPointer<QueryServiceLikeDelegate>(slot12);
      var results = new Dictionary<string, object>();

      foreach (var sg in Iids) {
        foreach (var ri in Iids) {
          Guid service = sg.Value;
          Guid requested = ri.Value;
          IntPtr ppv;
          int hr2 = qs(primary, ref service, ref requested, out ppv);
          results[sg.Key + "->" + ri.Key] = new Dictionary<string, object> {
            { "hr", string.Format("0x{0:X8}", hr2) },
            { "ptr", ppv == IntPtr.Zero ? null : string.Format("0x{0:X}", ppv.ToInt64()) }
          };

          if (ppv != IntPtr.Zero) {
            Marshal.Release(ppv);
          }
        }
      }

      payload["matrix"] = results;
      return payload;
    } finally {
      if (primary != IntPtr.Zero) {
        Marshal.Release(primary);
      }

      if (hrInit >= 0) {
        CoUninitialize();
      }
    }
  }
}
'@ | Set-Content -Path "$env:TEMP\broker_service_matrix_probe.cs" -Encoding ASCII

Add-Type -Path "$env:TEMP\broker_service_matrix_probe.cs"

$json = [BrokerServiceMatrixProbe]::Run() | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
