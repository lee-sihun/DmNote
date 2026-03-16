# PoC: CreateWindowInBand - create window directly in a higher band
# Usage: powershell -ExecutionPolicy Bypass -File poc-createwindowinband.ps1
# Run both as normal user and admin to compare

param(
  [string]$OutputPath = "$PSScriptRoot/../../docs/artifacts/poc-createwindowinband-results.json"
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$typeName = 'CreateBandNative'
if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CreateBandNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);

  [DllImport("kernel32.dll")] public static extern uint GetLastError();
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string lpModuleName);

  // RegisterClass
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct WNDCLASS {
    public uint style;
    public IntPtr lpfnWndProc;
    public int cbClsExtra;
    public int cbWndExtra;
    public IntPtr hInstance;
    public IntPtr hIcon;
    public IntPtr hCursor;
    public IntPtr hbrBackground;
    public string lpszMenuName;
    public string lpszClassName;
  }

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern ushort RegisterClass(ref WNDCLASS lpWndClass);

  [DllImport("user32.dll")]
  public static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  // CreateWindowInBand
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateWindowInBand(
    uint dwExStyle, string lpClassName, string lpWindowName,
    uint dwStyle, int X, int Y, int nWidth, int nHeight,
    IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam,
    uint dwBand
  );

  // CreateWindowInBandEx
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateWindowInBandEx(
    uint dwExStyle, string lpClassName, string lpWindowName,
    uint dwStyle, int X, int Y, int nWidth, int nHeight,
    IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam,
    uint dwBand, uint dwTypeFlags
  );

  // Standard CreateWindowEx for comparison
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateWindowEx(
    uint dwExStyle, string lpClassName, string lpWindowName,
    uint dwStyle, int X, int Y, int nWidth, int nHeight,
    IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam
  );

  // WndProc callback
  public static IntPtr WndProcCallback(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam) {
    return DefWindowProc(hWnd, msg, wParam, lParam);
  }
}
'@
}

$results = @{
  timestamp   = (Get-Date -Format 'o')
  hostname    = $env:COMPUTERNAME
  isAdmin     = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  experiments = [System.Collections.ArrayList]::new()
}

Write-Host ''
Write-Host '=== CreateWindowInBand PoC ===' -ForegroundColor Cyan
Write-Host ('Admin: ' + $results.isAdmin)
Write-Host ''

# --- Register window class ---
Write-Host '[1/4] Registering window class...' -ForegroundColor Yellow

$classRegTypeName = 'BandWindowClassHelper'
if (-not ([System.Management.Automation.PSTypeName]$classRegTypeName).Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BandWindowClassHelper {
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")] public static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("kernel32.dll")] public static extern uint GetLastError();

  private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  private static WndProcDelegate _wndProc;
  private static GCHandle _wndProcHandle;

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct WNDCLASSEX {
    public uint cbSize;
    public uint style;
    public IntPtr lpfnWndProc;
    public int cbClsExtra;
    public int cbWndExtra;
    public IntPtr hInstance;
    public IntPtr hIcon;
    public IntPtr hCursor;
    public IntPtr hbrBackground;
    public string lpszMenuName;
    public string lpszClassName;
    public IntPtr hIconSm;
  }

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern ushort RegisterClassEx(ref WNDCLASSEX lpWndClass);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateWindowInBand(
    uint dwExStyle, string lpClassName, string lpWindowName,
    uint dwStyle, int X, int Y, int nWidth, int nHeight,
    IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam,
    uint dwBand
  );

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateWindowInBandEx(
    uint dwExStyle, string lpClassName, string lpWindowName,
    uint dwStyle, int X, int Y, int nWidth, int nHeight,
    IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam,
    uint dwBand, uint dwTypeFlags
  );

  private static string _className = "BandPocOverlay_" + Guid.NewGuid().ToString("N").Substring(0,8);
  private static bool _registered = false;

  private static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam) {
    return DefWindowProcW(hWnd, msg, wParam, lParam);
  }

  public static string GetClassName() { return _className; }

  public static bool EnsureRegistered() {
    if (_registered) return true;
    _wndProc = new WndProcDelegate(WndProc);
    _wndProcHandle = GCHandle.Alloc(_wndProc);
    IntPtr hInst = GetModuleHandle(null);
    WNDCLASSEX wc = new WNDCLASSEX();
    wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
    wc.style = 0;
    wc.lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc);
    wc.hInstance = hInst;
    wc.lpszClassName = _className;
    wc.hbrBackground = IntPtr.Zero;
    ushort atom = RegisterClassEx(ref wc);
    if (atom == 0) return false;
    _registered = true;
    return true;
  }

  // WS_EX_TOPMOST=0x8, WS_EX_LAYERED=0x80000, WS_EX_TRANSPARENT=0x20, WS_EX_TOOLWINDOW=0x80
  // WS_POPUP=0x80000000, WS_VISIBLE=0x10000000
  public static IntPtr TryCreateInBand(uint band, int x, int y, int w, int h) {
    EnsureRegistered();
    uint exStyle = 0x00080088; // TOPMOST | TOOLWINDOW | LAYERED
    uint style = 0x90000000;   // POPUP | VISIBLE
    IntPtr hInst = GetModuleHandle(null);
    IntPtr hwnd = CreateWindowInBand(exStyle, _className, "BandOverlay_" + band, style,
      x, y, w, h, IntPtr.Zero, IntPtr.Zero, hInst, IntPtr.Zero, band);
    return hwnd;
  }

  public static IntPtr TryCreateInBandEx(uint band, int x, int y, int w, int h) {
    EnsureRegistered();
    uint exStyle = 0x00080088;
    uint style = 0x90000000;
    IntPtr hInst = GetModuleHandle(null);
    IntPtr hwnd = CreateWindowInBandEx(exStyle, _className, "BandOverlayEx_" + band, style,
      x, y, w, h, IntPtr.Zero, IntPtr.Zero, hInst, IntPtr.Zero, band, 0);
    return hwnd;
  }
}
'@
}

Write-Host ('  class registered: ' + [BandWindowClassHelper]::EnsureRegistered())

# --- fullscreen probe ---
Write-Host '[2/4] Creating fullscreen probe...' -ForegroundColor Yellow

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$probeForm = New-Object System.Windows.Forms.Form
$probeForm.Text = 'Fullscreen Probe'
$probeForm.StartPosition = 'Manual'
$probeForm.FormBorderStyle = 'None'
$probeForm.BackColor = [System.Drawing.Color]::DarkBlue
$probeForm.TopMost = $true
$probeForm.Location = [System.Drawing.Point]::new($screen.Left, $screen.Top)
$probeForm.Size = [System.Drawing.Size]::new($screen.Width, $screen.Height)

$probeLabel = New-Object System.Windows.Forms.Label
$probeLabel.AutoSize = $true
$probeLabel.ForeColor = [System.Drawing.Color]::White
$probeLabel.Font = New-Object System.Drawing.Font('Segoe UI', 24, [System.Drawing.FontStyle]::Bold)
$probeLabel.Text = 'FULLSCREEN PROBE (band=1)'
$probeLabel.Location = [System.Drawing.Point]::new(40, 40)
$probeForm.Controls.Add($probeLabel)

$probeForm.Show()
Start-Sleep -Milliseconds 500

# --- band sweep with CreateWindowInBand ---
Write-Host '[3/4] CreateWindowInBand sweep...' -ForegroundColor Yellow

foreach ($band in @(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)) {
  Write-Host ''
  Write-Host ('  --- band ' + $band + ' ---') -ForegroundColor Magenta

  $x = $screen.Left + 100
  $y = $screen.Top + 100
  $w = 400
  $h = 120

  # Try CreateWindowInBand
  $hwnd = [BandWindowClassHelper]::TryCreateInBand([uint32]$band, $x, $y, $w, $h)
  $err = [BandWindowClassHelper]::GetLastError()
  $errHex = ('0x{0:X8}' -f $err)
  $created = ($hwnd -ne [IntPtr]::Zero)

  [uint32]$actualBand = 0
  $bandOk = $false
  if ($created) {
    $bandOk = [BandWindowClassHelper]::GetWindowBand($hwnd, [ref]$actualBand)
  }

  # Also try CreateWindowInBandEx
  $hwndEx = [BandWindowClassHelper]::TryCreateInBandEx([uint32]$band, $x, ($y + 130), $w, $h)
  $errEx = [BandWindowClassHelper]::GetLastError()
  $errExHex = ('0x{0:X8}' -f $errEx)
  $createdEx = ($hwndEx -ne [IntPtr]::Zero)

  [uint32]$actualBandEx = 0
  if ($createdEx) {
    [void][BandWindowClassHelper]::GetWindowBand($hwndEx, [ref]$actualBandEx)
  }

  $entry = @{
    band               = $band
    createInBand_ok    = $created
    createInBand_err   = $errHex
    createInBand_hwnd  = if ($created) { ('0x{0:X}' -f $hwnd.ToInt64()) } else { $null }
    actualBand         = $actualBand
    bandMatchesRequest = ($actualBand -eq $band)
    createInBandEx_ok  = $createdEx
    createInBandEx_err = $errExHex
    actualBandEx       = $actualBandEx
  }

  [void]$results.experiments.Add($entry)

  if ($created) {
    Write-Host ('    CreateWindowInBand = OK, hwnd=0x{0:X}, actualBand=' -f $hwnd.ToInt64()) -NoNewline
    Write-Host ($actualBand) -ForegroundColor $(if ($actualBand -eq $band) { 'Green' } else { 'Yellow' })
  } else {
    Write-Host ('    CreateWindowInBand = FAIL (' + $errHex + ')') -ForegroundColor Red
  }

  if ($createdEx) {
    Write-Host ('    CreateWindowInBandEx = OK, actualBand=' + $actualBandEx) -ForegroundColor Green
  } else {
    Write-Host ('    CreateWindowInBandEx = FAIL (' + $errExHex + ')') -ForegroundColor Red
  }

  # cleanup
  if ($created) { [void][BandWindowClassHelper]::DestroyWindow($hwnd) }
  if ($createdEx) { [void][BandWindowClassHelper]::DestroyWindow($hwndEx) }

  Start-Sleep -Milliseconds 100
}

# --- save ---
Write-Host ''
Write-Host '[4/4] Saving results...' -ForegroundColor Yellow

$outputDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
$results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
Write-Host ('Saved: ' + $OutputPath)

# --- summary ---
$createdBands = @($results.experiments | Where-Object { $_.createInBand_ok })
$matchedBands = @($results.experiments | Where-Object { $_.createInBand_ok -and $_.bandMatchesRequest })
$failedBands = @($results.experiments | Where-Object { -not $_.createInBand_ok })

Write-Host ''
Write-Host '=== SUMMARY ===' -ForegroundColor Cyan
Write-Host ('Created OK: ' + $createdBands.Count + ' - bands: ' + ($createdBands.band -join ', '))
Write-Host ('Band matches request: ' + $matchedBands.Count + ' - bands: ' + ($matchedBands.band -join ', '))
Write-Host ('Failed: ' + $failedBands.Count + ' - bands: ' + ($failedBands.band -join ', '))

if ($matchedBands.Count -gt 0) {
  $highBands = @($matchedBands | Where-Object { $_.band -gt 1 })
  if ($highBands.Count -gt 0) {
    Write-Host ''
    Write-Host ('*** HIGH BAND CREATION SUCCESS! bands: ' + ($highBands.band -join ', ') + ' ***') -ForegroundColor Green
  }
}

$probeForm.Close()
