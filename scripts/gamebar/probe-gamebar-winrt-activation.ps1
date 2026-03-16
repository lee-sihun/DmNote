param(
  [string]$OutputPath,
  [switch]$LaunchGameBar,
  [switch]$TerminateGameBar = $true
)

$ErrorActionPreference = 'Stop'

@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WinRtActivationProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct HSTRING_HEADER {
    public IntPtr Reserved1;
    public IntPtr Reserved2;
    public IntPtr Reserved3;
    public IntPtr Reserved4;
    public IntPtr Reserved5;
  }

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int ActivateInstanceDelegate(IntPtr self, out IntPtr instance);

  [DllImport("combase.dll")]
  private static extern int RoInitialize(uint initType);

  [DllImport("combase.dll")]
  private static extern void RoUninitialize();

  [DllImport("combase.dll", CharSet = CharSet.Unicode)]
  private static extern int WindowsCreateString(string sourceString, int length, out IntPtr hstring);

  [DllImport("combase.dll")]
  private static extern int WindowsDeleteString(IntPtr hstring);

  [DllImport("combase.dll")]
  private static extern int RoGetActivationFactory(IntPtr activatableClassId, ref Guid iid, out IntPtr factory);

  [DllImport("combase.dll")]
  private static extern int RoActivateInstance(IntPtr activatableClassId, out IntPtr instance);

  private static readonly Guid IInspectableIid = new Guid("AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90");
  private static readonly Guid IActivationFactoryIid = new Guid("00000035-0000-0000-C000-000000000046");

  private static Dictionary<string, object> ProbeClass(string className) {
    var result = new Dictionary<string, object>();
    result["class_name"] = className;

    IntPtr hstring = IntPtr.Zero;
    IntPtr factory = IntPtr.Zero;
    IntPtr instance = IntPtr.Zero;
    IntPtr activated = IntPtr.Zero;

    try {
      int hrString = WindowsCreateString(className, className.Length, out hstring);
      result["windows_create_string_hr"] = String.Format("0x{0:X8}", hrString);
      if (hrString < 0) {
        return result;
      }

      Guid activationFactoryIid = IActivationFactoryIid;
      int hrFactory = RoGetActivationFactory(hstring, ref activationFactoryIid, out factory);
      result["ro_get_activation_factory_hr"] = String.Format("0x{0:X8}", hrFactory);
      result["factory_nonzero"] = factory != IntPtr.Zero;

      if (factory != IntPtr.Zero) {
        IntPtr vtbl = Marshal.ReadIntPtr(factory);
        IntPtr activatePtr = Marshal.ReadIntPtr(vtbl, 6 * IntPtr.Size);
        result["factory_vtbl"] = String.Format("0x{0:X}", vtbl.ToInt64());
        result["activate_instance_ptr"] = String.Format("0x{0:X}", activatePtr.ToInt64());
        var activate = Marshal.GetDelegateForFunctionPointer<ActivateInstanceDelegate>(activatePtr);
        int hrActivateViaFactory = activate(factory, out instance);
        result["activate_instance_via_factory_hr"] = String.Format("0x{0:X8}", hrActivateViaFactory);
        result["factory_instance_nonzero"] = instance != IntPtr.Zero;
      }

      Guid inspectableIid = IInspectableIid;
      int hrRoActivate = RoActivateInstance(hstring, out activated);
      result["ro_activate_instance_hr"] = String.Format("0x{0:X8}", hrRoActivate);
      result["ro_activate_instance_nonzero"] = activated != IntPtr.Zero;

      return result;
    } finally {
      if (activated != IntPtr.Zero) {
        Marshal.Release(activated);
      }

      if (instance != IntPtr.Zero) {
        Marshal.Release(instance);
      }

      if (factory != IntPtr.Zero) {
        Marshal.Release(factory);
      }

      if (hstring != IntPtr.Zero) {
        WindowsDeleteString(hstring);
      }
    }
  }

  public static Dictionary<string, object> Run() {
    int hrInit = RoInitialize(1);
    try {
      var payload = new Dictionary<string, object>();
      payload["ro_initialize_hr"] = String.Format("0x{0:X8}", hrInit);

      string[] classes = new string[] {
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
        "Windows.Foundation.Collections.ValueSet",
        "Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions",
        "Microsoft.Web.WebView2.Core.CoreWebView2ControllerWindowReference"
      };

      var results = new List<Dictionary<string, object>>();
      foreach (var className in classes) {
        results.Add(ProbeClass(className));
      }

      payload["results"] = results;
      return payload;
    } finally {
      if (hrInit >= 0) {
        RoUninitialize();
      }
    }
  }
}
'@ | Set-Content -Path "$env:TEMP\gamebar_winrt_activation_probe.cs" -Encoding ASCII

Add-Type -Path "$env:TEMP\gamebar_winrt_activation_probe.cs"

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 2
}

try {
  $json = [WinRtActivationProbe]::Run() | ConvertTo-Json -Depth 8
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
  $OutputPath
} else {
  $json
}
