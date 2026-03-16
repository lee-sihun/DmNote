# PoC: UIAccess overlay - real game test
# Shows a small overlay for 60 seconds so you can switch to a borderless fullscreen game
# Usage: powershell -ExecutionPolicy Bypass -File poc-uiaccess-gametest.ps1
# Requires: previous poc-uiaccess.ps1 run (cert already installed)

param(
  [int]$DurationSeconds = 60
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'ERROR: This script requires admin privileges.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '=== UIAccess Game Test ===' -ForegroundColor Cyan
Write-Host ''

$exeDir = 'C:\Program Files\DmNotePoC'
$exePath = Join-Path $exeDir 'UIAccessGameTest.exe'

# --- Find existing cert ---
$certSubject = 'CN=DmNote UIAccess PoC'
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $certSubject } | Select-Object -First 1
if (-not $cert) {
  Write-Host 'ERROR: No cert found. Run poc-uiaccess.ps1 first.' -ForegroundColor Red
  exit 1
}
Write-Host ('Cert: ' + $cert.Thumbprint) -ForegroundColor Green

# --- Compile game test overlay ---
Write-Host 'Compiling game test overlay...' -ForegroundColor Yellow

$csharpCode = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class UIAccessGameTest {
  [DllImport("user32.dll", SetLastError=true)]
  static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)]
  static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);
  [DllImport("user32.dll")]
  static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")]
  static extern int GetWindowLong(IntPtr hWnd, int nIndex);

  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  const int GWL_EXSTYLE = -20;
  const int WS_EX_LAYERED = 0x80000;
  const int WS_EX_TRANSPARENT = 0x20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_TOPMOST = 0x8;

  [STAThread]
  static void Main(string[] args) {
    int duration = 60;
    if (args.Length > 0) int.TryParse(args[0], out duration);

    var screen = Screen.PrimaryScreen.Bounds;

    // Small overlay in top-right corner
    var overlay = new Form {
      Text = "UIAccess Game Test",
      FormBorderStyle = FormBorderStyle.None,
      BackColor = Color.FromArgb(30, 30, 30),
      ForeColor = Color.White,
      TopMost = true,
      ShowInTaskbar = false,
      StartPosition = FormStartPosition.Manual,
      Location = new Point(screen.Right - 420, screen.Top + 20),
      Size = new Size(400, 140),
      Opacity = 0.85
    };

    var titleLabel = new Label {
      Text = "UIAccess Overlay (band=?)",
      Font = new Font("Segoe UI", 14, FontStyle.Bold),
      ForeColor = Color.Lime,
      AutoSize = true,
      Location = new Point(15, 10)
    };
    overlay.Controls.Add(titleLabel);

    var infoLabel = new Label {
      Font = new Font("Consolas", 10),
      ForeColor = Color.White,
      AutoSize = true,
      Location = new Point(15, 45)
    };
    overlay.Controls.Add(infoLabel);

    var countdownLabel = new Label {
      Font = new Font("Segoe UI", 11),
      ForeColor = Color.Gray,
      AutoSize = true,
      Location = new Point(15, 105)
    };
    overlay.Controls.Add(countdownLabel);

    overlay.Show();

    // Set extended styles for click-through
    int exStyle = GetWindowLong(overlay.Handle, GWL_EXSTYLE);
    SetWindowLong(overlay.Handle, GWL_EXSTYLE, exStyle | WS_EX_TRANSPARENT);

    // Force topmost
    SetWindowPos(overlay.Handle, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);

    // Check band
    uint band = 0;
    GetWindowBand(overlay.Handle, out band);
    titleLabel.Text = "UIAccess Overlay (band=" + band + ")";
    titleLabel.ForeColor = band >= 2 ? Color.Lime : Color.Orange;

    infoLabel.Text = string.Format(
      "hwnd=0x{0:X}  band={1}\nSwitch to a fullscreen game now!\nThis overlay should stay visible above it.",
      overlay.Handle.ToInt64(), band);

    Application.DoEvents();

    // Countdown loop
    DateTime endTime = DateTime.Now.AddSeconds(duration);
    var timer = new Timer { Interval = 500 };
    timer.Tick += (s, e) => {
      int remaining = (int)(endTime - DateTime.Now).TotalSeconds;
      if (remaining <= 0) {
        timer.Stop();
        overlay.Close();
        return;
      }
      countdownLabel.Text = "Closing in " + remaining + "s  |  Press Ctrl+C in terminal to close early";

      // Re-assert topmost periodically
      SetWindowPos(overlay.Handle, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
      Application.DoEvents();
    };
    timer.Start();

    Application.Run(overlay);
  }
}
'@

$manifest = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="true" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
'@

$srcPath = Join-Path $exeDir 'UIAccessGameTest.cs'
$manifestPath = Join-Path $exeDir 'UIAccessGameTest.manifest'
Set-Content -Path $srcPath -Value $csharpCode -Encoding UTF8
Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}

$compileArgs = @(
  '/target:winexe',
  '/platform:x64',
  ('/out:"' + $exePath + '"'),
  ('/win32manifest:"' + $manifestPath + '"'),
  '/reference:System.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  ('"' + $srcPath + '"')
)

$stdoutPath = Join-Path $exeDir 'gametest_compile_stdout.txt'
$stderrPath = Join-Path $exeDir 'gametest_compile_stderr.txt'
$proc = Start-Process -FilePath $csc -ArgumentList $compileArgs -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

if ($proc.ExitCode -ne 0) {
  $errText = Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue
  Write-Host ('Compile FAILED: ' + $errText) -ForegroundColor Red
  exit 1
}
Write-Host 'Compiled OK' -ForegroundColor Green

# --- Sign ---
Write-Host 'Signing...' -ForegroundColor Yellow
Set-AuthenticodeSignature -FilePath $exePath -Certificate $cert -TimestampServer '' | Out-Null
$sig = Get-AuthenticodeSignature -FilePath $exePath
Write-Host ('Signed: ' + $sig.Status) -ForegroundColor Green

# --- Launch ---
Write-Host '' -ForegroundColor Yellow
Write-Host ('Launching overlay for ' + $DurationSeconds + ' seconds...') -ForegroundColor Cyan
Write-Host 'Switch to a borderless fullscreen game now!' -ForegroundColor Yellow
Write-Host 'The overlay should appear in the top-right corner above the game.' -ForegroundColor Yellow
Write-Host ''

Start-Process -FilePath $exePath -ArgumentList $DurationSeconds
Write-Host 'Overlay launched. It will auto-close after the timer.' -ForegroundColor Green
Write-Host 'Check if it stays visible above the fullscreen game.' -ForegroundColor Green
