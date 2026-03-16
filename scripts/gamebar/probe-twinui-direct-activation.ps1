param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class TwinUiDirectActivationProbe {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int DllGetActivationFactoryDelegate(IntPtr activatableClassId, out IntPtr factory);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int ActivateInstanceDelegate(IntPtr self, out IntPtr instance);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr LoadLibraryW(string lpLibFileName);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool FreeLibrary(IntPtr hModule);

  [DllImport("combase.dll", CharSet = CharSet.Unicode)]
  private static extern int WindowsCreateString(string sourceString, int length, out IntPtr hstring);

  [DllImport("combase.dll")]
  private static extern int WindowsDeleteString(IntPtr hstring);

  [DllImport("combase.dll")]
  private static extern int RoInitialize(uint initType);

  [DllImport("combase.dll")]
  private static extern void RoUninitialize();

  private static string Hex(int hr) {
    return String.Format("0x{0:X8}", hr);
  }

  private static Dictionary<string, object> ProbeClass(DllGetActivationFactoryDelegate dllGetActivationFactory, string className) {
    var result = new Dictionary<string, object>();
    result["class_name"] = className;

    IntPtr hstring = IntPtr.Zero;
    IntPtr factory = IntPtr.Zero;
    IntPtr instance = IntPtr.Zero;

    try {
      int hrString = WindowsCreateString(className, className.Length, out hstring);
      result["windows_create_string_hr"] = Hex(hrString);
      if (hrString < 0) {
        return result;
      }

      int hrFactory = dllGetActivationFactory(hstring, out factory);
      result["dll_get_activation_factory_hr"] = Hex(hrFactory);
      result["factory_nonzero"] = factory != IntPtr.Zero;

      if (factory != IntPtr.Zero) {
        IntPtr vtbl = Marshal.ReadIntPtr(factory);
        IntPtr activatePtr = Marshal.ReadIntPtr(vtbl, 6 * IntPtr.Size);
        result["factory_vtbl"] = String.Format("0x{0:X}", vtbl.ToInt64());
        result["activate_instance_ptr"] = String.Format("0x{0:X}", activatePtr.ToInt64());
        var activate = Marshal.GetDelegateForFunctionPointer<ActivateInstanceDelegate>(activatePtr);
        int hrActivate = activate(factory, out instance);
        result["activate_instance_hr"] = Hex(hrActivate);
        result["instance_nonzero"] = instance != IntPtr.Zero;
      }

      return result;
    } finally {
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
    var payload = new Dictionary<string, object>();
    int hrInit = RoInitialize(1);
    payload["ro_initialize_hr"] = Hex(hrInit);

    IntPtr module = IntPtr.Zero;
    try {
      module = LoadLibraryW("twinui.pcshell.dll");
      payload["module_nonzero"] = module != IntPtr.Zero;
      payload["module_ptr"] = module != IntPtr.Zero ? String.Format("0x{0:X}", module.ToInt64()) : "0x0";
      if (module == IntPtr.Zero) {
        payload["last_error"] = Marshal.GetLastWin32Error();
        return payload;
      }

      IntPtr proc = GetProcAddress(module, "DllGetActivationFactory");
      payload["dll_get_activation_factory_ptr"] = proc != IntPtr.Zero ? String.Format("0x{0:X}", proc.ToInt64()) : "0x0";
      if (proc == IntPtr.Zero) {
        payload["last_error"] = Marshal.GetLastWin32Error();
        return payload;
      }

      var dllGetActivationFactory = Marshal.GetDelegateForFunctionPointer<DllGetActivationFactoryDelegate>(proc);
      string[] classes = new string[] {
        "Microsoft.Windows.Shell.GamingOverlayExperienceManager",
        "Windows.Internal.GamingOverlay.GameBarWindowControl",
        "Windows.Internal.Shell.Taskbar.TaskbarFrame"
      };

      var results = new List<Dictionary<string, object>>();
      foreach (var className in classes) {
        results.Add(ProbeClass(dllGetActivationFactory, className));
      }

      payload["results"] = results;
      return payload;
    } finally {
      if (module != IntPtr.Zero) {
        FreeLibrary(module);
      }

      if (hrInit >= 0) {
        RoUninitialize();
      }
    }
  }
}
'@ | Set-Content -Path "$env:TEMP\twinui_direct_activation_probe.cs" -Encoding ASCII

Add-Type -Path "$env:TEMP\twinui_direct_activation_probe.cs"

$json = [TwinUiDirectActivationProbe]::Run() | ConvertTo-Json -Depth 8

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
