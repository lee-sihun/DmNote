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

public static class GameBarFtComProbe {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int QueryInterfaceDelegate(IntPtr self, ref Guid iid, out IntPtr ppv);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetRuntimeClassNameDelegate(IntPtr self, out IntPtr hstring);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int ActivateInstanceDelegate(IntPtr self, out IntPtr instance);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetProcessHandleDelegate(IntPtr self, out ulong value);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int CreateObjectDelegate(IntPtr self, out IntPtr value);

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

  private static readonly Guid IUnknownIid = new Guid("00000000-0000-0000-C000-000000000046");
  private static readonly Guid IInspectableIid = new Guid("AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90");
  private static readonly Guid IActivationFactoryIid = new Guid("00000035-0000-0000-C000-000000000046");
  private static readonly Guid FtFactoryClsid = new Guid("FD06603A-2BDF-4BB1-B7DF-5DC68F353601");
  private static readonly Guid IGbftFactoryIid = new Guid("6BFBA441-F863-58CF-9604-0AE9049EF42A");
  private static readonly Guid IAppTargetManagerFTIid = new Guid("FA6EF6BB-CFC7-5C65-8088-583C02C25CFC");
  private static readonly Guid IWindowManagerFTIid = new Guid("BF5BA331-861E-5121-A167-CA786ADB6B2B");
  private static readonly Guid IInputFocusTrackerFTIid = new Guid("820A5105-846E-5522-B2A7-1E21CDD58E9C");
  private static readonly Guid IGameConfigStoreFTIid = new Guid("8E9401C0-4F34-5DD9-9F2D-F0F06AD72793");

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

  private static Dictionary<string, object> InspectObject(string label, IntPtr ptr, Guid expectedIid) {
    var result = new Dictionary<string, object>();
    result["label"] = label;
    result["ptr"] = String.Format("0x{0:X}", ptr.ToInt64());

    IntPtr vtbl = Marshal.ReadIntPtr(ptr);
    result["vtbl"] = String.Format("0x{0:X}", vtbl.ToInt64());
    result["module"] = ResolveModule(vtbl);

    IntPtr runtimeClassFn = Marshal.ReadIntPtr(vtbl, 4 * IntPtr.Size);
    result["get_runtime_class_name_ptr"] = String.Format("0x{0:X}", runtimeClassFn.ToInt64());

    try {
      var getRuntimeClassName = Marshal.GetDelegateForFunctionPointer<GetRuntimeClassNameDelegate>(runtimeClassFn);
      IntPtr hstring;
      int hr = getRuntimeClassName(ptr, out hstring);
      result["get_runtime_class_name_hr"] = String.Format("0x{0:X8}", hr);

      if (hstring != IntPtr.Zero) {
        result["runtime_class_name"] = ReadHString(hstring);
        WindowsDeleteString(hstring);
      }
    } catch (Exception ex) {
      result["get_runtime_class_name_error"] = ex.GetType().Name;
    }

    Guid iid = expectedIid;
    IntPtr sameInterface;
    var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(vtbl, 0));
    int hrQi = qi(ptr, ref iid, out sameInterface);
    result["query_interface_hr"] = String.Format("0x{0:X8}", hrQi);
    result["query_interface_nonzero"] = sameInterface != IntPtr.Zero;
    if (sameInterface != IntPtr.Zero) {
      Marshal.Release(sameInterface);
    }

    return result;
  }

  private static Dictionary<string, object> InspectUnknownObject(string label, IntPtr ptr) {
    var result = new Dictionary<string, object>();
    result["label"] = label;
    result["ptr"] = String.Format("0x{0:X}", ptr.ToInt64());

    IntPtr vtbl = Marshal.ReadIntPtr(ptr);
    result["vtbl"] = String.Format("0x{0:X}", vtbl.ToInt64());
    result["module"] = ResolveModule(vtbl);
    return result;
  }

  private static Dictionary<string, object> RunForContext(uint clsctx) {
    var result = new Dictionary<string, object>();
    result["clsctx"] = clsctx;

    Guid clsid = FtFactoryClsid;
    Guid iunknown = IUnknownIid;
    IntPtr unknownPtr;
    int hrCreate = CoCreateInstance(ref clsid, IntPtr.Zero, clsctx, ref iunknown, out unknownPtr);
    result["co_create_instance_iunknown_hr"] = String.Format("0x{0:X8}", hrCreate);
    result["co_create_instance_iunknown_nonzero"] = unknownPtr != IntPtr.Zero;

    Guid factoryIid = IGbftFactoryIid;
    IntPtr factoryPtrDirect;
    int hrCreateFactory = CoCreateInstance(ref clsid, IntPtr.Zero, clsctx, ref factoryIid, out factoryPtrDirect);
    result["co_create_instance_factory_hr"] = String.Format("0x{0:X8}", hrCreateFactory);
    result["co_create_instance_factory_nonzero"] = factoryPtrDirect != IntPtr.Zero;

    IntPtr factoryPtr = IntPtr.Zero;
    try {
      if (unknownPtr != IntPtr.Zero) {
        result["unknown_object"] = InspectUnknownObject("IUnknownRoot", unknownPtr);

        IntPtr unknownVtbl = Marshal.ReadIntPtr(unknownPtr);
        var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(unknownVtbl, 0));

        Guid inspectableIid = IInspectableIid;
        IntPtr inspectablePtr;
        int hrInspectable = qi(unknownPtr, ref inspectableIid, out inspectablePtr);
        result["query_interface_inspectable_hr"] = String.Format("0x{0:X8}", hrInspectable);
        result["query_interface_inspectable_nonzero"] = inspectablePtr != IntPtr.Zero;
        if (inspectablePtr != IntPtr.Zero) {
          result["inspectable_object"] = InspectObject("IInspectable", inspectablePtr, IInspectableIid);
          Marshal.Release(inspectablePtr);
        }

        Guid activationFactoryIid = IActivationFactoryIid;
        IntPtr activationFactoryPtr;
        int hrActivationFactory = qi(unknownPtr, ref activationFactoryIid, out activationFactoryPtr);
        result["query_interface_activation_factory_hr"] = String.Format("0x{0:X8}", hrActivationFactory);
        result["query_interface_activation_factory_nonzero"] = activationFactoryPtr != IntPtr.Zero;

        if (activationFactoryPtr != IntPtr.Zero) {
          result["activation_factory_object"] = InspectObject("IActivationFactory", activationFactoryPtr, IActivationFactoryIid);

          IntPtr activationFactoryVtbl = Marshal.ReadIntPtr(activationFactoryPtr);
          var activateInstance = Marshal.GetDelegateForFunctionPointer<ActivateInstanceDelegate>(Marshal.ReadIntPtr(activationFactoryVtbl, 6 * IntPtr.Size));
          IntPtr activatedInstance;
          int hrActivateInstance = activateInstance(activationFactoryPtr, out activatedInstance);
          result["activate_instance_hr"] = String.Format("0x{0:X8}", hrActivateInstance);
          result["activate_instance_nonzero"] = activatedInstance != IntPtr.Zero;

          if (activatedInstance != IntPtr.Zero) {
            result["activated_instance"] = InspectObject("ActivatedGbftFactory", activatedInstance, IInspectableIid);

            IntPtr activatedVtbl = Marshal.ReadIntPtr(activatedInstance);
            var activatedQi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(activatedVtbl, 0));
            IntPtr activatedGbftFactory;
            int hrActivatedFactory = activatedQi(activatedInstance, ref factoryIid, out activatedGbftFactory);
            result["activated_query_interface_factory_hr"] = String.Format("0x{0:X8}", hrActivatedFactory);
            result["activated_query_interface_factory_nonzero"] = activatedGbftFactory != IntPtr.Zero;

            if (activatedGbftFactory != IntPtr.Zero) {
              factoryPtr = activatedGbftFactory;
              result["factory_from_activated_instance"] = true;
            }
          }

          if (activationFactoryPtr != IntPtr.Zero) {
            Marshal.Release(activationFactoryPtr);
          }
        }
      }

      if (factoryPtrDirect != IntPtr.Zero) {
        factoryPtr = factoryPtrDirect;
      } else if (unknownPtr != IntPtr.Zero) {
        IntPtr unknownVtbl = Marshal.ReadIntPtr(unknownPtr);
        var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(Marshal.ReadIntPtr(unknownVtbl, 0));
        int hrQiFactory = qi(unknownPtr, ref factoryIid, out factoryPtr);
        result["query_interface_factory_hr"] = String.Format("0x{0:X8}", hrQiFactory);
        result["query_interface_factory_nonzero"] = factoryPtr != IntPtr.Zero;
      }

      if (factoryPtr == IntPtr.Zero) {
        return result;
      }

      result["factory"] = InspectObject("IGbftFactory", factoryPtr, IGbftFactoryIid);

      IntPtr factoryVtbl = Marshal.ReadIntPtr(factoryPtr);
      var getProcessHandle = Marshal.GetDelegateForFunctionPointer<GetProcessHandleDelegate>(Marshal.ReadIntPtr(factoryVtbl, 6 * IntPtr.Size));
      ulong processHandle;
      int hrProcessHandle = getProcessHandle(factoryPtr, out processHandle);
      result["process_handle_hr"] = String.Format("0x{0:X8}", hrProcessHandle);
      result["process_handle"] = String.Format("0x{0:X}", processHandle);

      var createObject = Marshal.GetDelegateForFunctionPointer<CreateObjectDelegate>(Marshal.ReadIntPtr(factoryVtbl, 7 * IntPtr.Size));
      IntPtr appTargetManager;
      int hrAppTarget = createObject(factoryPtr, out appTargetManager);
      result["create_app_target_manager_hr"] = String.Format("0x{0:X8}", hrAppTarget);
      if (appTargetManager != IntPtr.Zero) {
        result["app_target_manager"] = InspectObject("IAppTargetManagerFT", appTargetManager, IAppTargetManagerFTIid);
        Marshal.Release(appTargetManager);
      }

      createObject = Marshal.GetDelegateForFunctionPointer<CreateObjectDelegate>(Marshal.ReadIntPtr(factoryVtbl, 11 * IntPtr.Size));
      IntPtr windowManager;
      int hrWindowManager = createObject(factoryPtr, out windowManager);
      result["create_window_manager_hr"] = String.Format("0x{0:X8}", hrWindowManager);
      if (windowManager != IntPtr.Zero) {
        result["window_manager"] = InspectObject("IWindowManagerFT", windowManager, IWindowManagerFTIid);
        Marshal.Release(windowManager);
      }

      createObject = Marshal.GetDelegateForFunctionPointer<CreateObjectDelegate>(Marshal.ReadIntPtr(factoryVtbl, 16 * IntPtr.Size));
      IntPtr gameConfigStore;
      int hrGameConfigStore = createObject(factoryPtr, out gameConfigStore);
      result["create_game_config_store_hr"] = String.Format("0x{0:X8}", hrGameConfigStore);
      if (gameConfigStore != IntPtr.Zero) {
        result["game_config_store"] = InspectObject("IGameConfigStoreFT", gameConfigStore, IGameConfigStoreFTIid);
        Marshal.Release(gameConfigStore);
      }

      createObject = Marshal.GetDelegateForFunctionPointer<CreateObjectDelegate>(Marshal.ReadIntPtr(factoryVtbl, 25 * IntPtr.Size));
      IntPtr inputFocusTracker;
      int hrInputFocusTracker = createObject(factoryPtr, out inputFocusTracker);
      result["create_input_focus_tracker_hr"] = String.Format("0x{0:X8}", hrInputFocusTracker);
      if (inputFocusTracker != IntPtr.Zero) {
        result["input_focus_tracker"] = InspectObject("IInputFocusTrackerFT", inputFocusTracker, IInputFocusTrackerFTIid);
        Marshal.Release(inputFocusTracker);
      }
    } finally {
      if (factoryPtrDirect != IntPtr.Zero) {
        Marshal.Release(factoryPtrDirect);
      } else if (factoryPtr != IntPtr.Zero) {
        Marshal.Release(factoryPtr);
      }

      if (unknownPtr != IntPtr.Zero) {
        Marshal.Release(unknownPtr);
      }
    }

    return result;
  }

  public static Dictionary<string, object> Run() {
    int hrInit = CoInitializeEx(IntPtr.Zero, 2);
    try {
      var payload = new Dictionary<string, object>();
      payload["coinit_hr"] = String.Format("0x{0:X8}", hrInit);
      payload["factory_clsid"] = FtFactoryClsid.ToString("D");
      payload["factory_iid"] = IGbftFactoryIid.ToString("D");
      payload["contexts"] = new List<object> {
        RunForContext(4),
        RunForContext(5),
        RunForContext(20),
        RunForContext(21)
      };
      return payload;
    } finally {
      if (hrInit >= 0) {
        CoUninitialize();
      }
    }
  }
}
'@ | Set-Content -Path "$env:TEMP\gamebar_ft_com_probe.cs" -Encoding ASCII

Add-Type -Path "$env:TEMP\gamebar_ft_com_probe.cs"

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 2
}

try {
  $json = [GameBarFtComProbe]::Run() | ConvertTo-Json -Depth 10
} finally {
  if ($TerminateGameBar) {
    Get-Process GameBar,GameBarFTServer -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
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
