# PoC: UIAccess overlay - Windows official accessibility mechanism
# Must be run as ADMIN (needs cert install + Program Files write)
# Usage: powershell -ExecutionPolicy Bypass -File poc-uiaccess.ps1

param(
  [string]$OutputPath = "$PSScriptRoot/../../docs/artifacts/poc-uiaccess-results.json"
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'ERROR: This script requires admin privileges.' -ForegroundColor Red
  Write-Host 'Run from an elevated PowerShell.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '=== UIAccess Overlay PoC ===' -ForegroundColor Cyan
Write-Host ''

$results = @{
  timestamp = (Get-Date -Format 'o')
  hostname  = $env:COMPUTERNAME
  isAdmin   = $true
  steps     = [System.Collections.ArrayList]::new()
}

function Log-Step($name, $status, $detail) {
  $entry = @{ step = $name; status = $status; detail = $detail }
  [void]$results.steps.Add($entry)
  $color = if ($status -eq 'OK') { 'Green' } elseif ($status -eq 'FAIL') { 'Red' } else { 'Yellow' }
  Write-Host ('  [' + $status + '] ' + $name + ': ' + $detail) -ForegroundColor $color
}

# --- Step 1: Create self-signed code signing cert ---
Write-Host '[1/6] Creating self-signed code signing certificate...' -ForegroundColor Yellow

$certSubject = 'CN=DmNote UIAccess PoC'
$existingCert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $certSubject } | Select-Object -First 1

if ($existingCert) {
  $cert = $existingCert
  Log-Step 'cert_create' 'OK' ('Reusing existing cert: ' + $cert.Thumbprint)
} else {
  try {
    $cert = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject $certSubject `
      -CertStoreLocation Cert:\CurrentUser\My `
      -NotAfter (Get-Date).AddYears(1)
    Log-Step 'cert_create' 'OK' ('Created: ' + $cert.Thumbprint)
  } catch {
    Log-Step 'cert_create' 'FAIL' $_.Exception.Message
    $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
    exit 1
  }
}

# --- Step 2: Install cert to Trusted Root (needed for UIAccess) ---
Write-Host '[2/6] Installing cert to Trusted Root store...' -ForegroundColor Yellow

try {
  $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
  $rootStore.Open('ReadWrite')
  $alreadyInstalled = $rootStore.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
  if (-not $alreadyInstalled) {
    $rootStore.Add($cert)
    Log-Step 'cert_trust' 'OK' 'Installed to LocalMachine\Root'
  } else {
    Log-Step 'cert_trust' 'OK' 'Already in LocalMachine\Root'
  }
  $rootStore.Close()
} catch {
  Log-Step 'cert_trust' 'FAIL' $_.Exception.Message
  $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
  exit 1
}

# --- Step 3: Compile UIAccess overlay EXE ---
Write-Host '[3/6] Compiling UIAccess overlay EXE...' -ForegroundColor Yellow

$exeDir = 'C:\Program Files\DmNotePoC'
$exePath = Join-Path $exeDir 'UIAccessOverlay.exe'

$csharpCode = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.IO;

public class UIAccessOverlay {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)]
  static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)]
  static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);

  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

  [STAThread]
  static void Main(string[] args) {
    string resultPath = args.Length > 0 ? args[0] : null;
    var results = new System.Text.StringBuilder();
    results.AppendLine("{");

    // Create fullscreen probe
    var screen = Screen.PrimaryScreen.Bounds;
    var probe = new Form {
      Text = "Fullscreen Probe",
      FormBorderStyle = FormBorderStyle.None,
      BackColor = Color.DarkBlue,
      ForeColor = Color.White,
      TopMost = true,
      StartPosition = FormStartPosition.Manual,
      Location = new Point(screen.Left, screen.Top),
      Size = new Size(screen.Width, screen.Height)
    };
    var probeLabel = new Label {
      Text = "FULLSCREEN PROBE - if you see a GREEN overlay above this, UIAccess works!",
      Font = new Font("Segoe UI", 24, FontStyle.Bold),
      ForeColor = Color.White,
      AutoSize = true,
      Location = new Point(40, 40)
    };
    probe.Controls.Add(probeLabel);
    probe.Show();
    SetWindowPos(probe.Handle, HWND_TOPMOST, screen.Left, screen.Top, screen.Width, screen.Height, 0x0040);
    SetForegroundWindow(probe.Handle);
    Application.DoEvents();
    System.Threading.Thread.Sleep(300);

    // Create overlay
    var overlay = new Form {
      Text = "UIAccess Overlay",
      FormBorderStyle = FormBorderStyle.None,
      BackColor = Color.Lime,
      TopMost = true,
      ShowInTaskbar = false,
      StartPosition = FormStartPosition.Manual,
      Location = new Point(screen.Left + 80, screen.Top + 80),
      Size = new Size(600, 250),
      Opacity = 0.9
    };
    var overlayLabel = new Label {
      Text = "UIAccess OVERLAY",
      Font = new Font("Segoe UI", 22, FontStyle.Bold),
      ForeColor = Color.Black,
      AutoSize = true,
      Location = new Point(20, 20)
    };
    overlay.Controls.Add(overlayLabel);

    var statusLabel = new Label {
      Font = new Font("Consolas", 11),
      ForeColor = Color.DarkRed,
      AutoSize = true,
      Location = new Point(20, 70)
    };
    overlay.Controls.Add(statusLabel);
    overlay.Show();

    // Force overlay above probe
    SetWindowPos(overlay.Handle, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
    Application.DoEvents();

    // Now give focus back to probe, see if overlay stays on top
    SetForegroundWindow(probe.Handle);
    probe.Activate();
    Application.DoEvents();
    System.Threading.Thread.Sleep(500);

    // Check bands
    uint probeBand = 0, overlayBand = 0;
    GetWindowBand(probe.Handle, out probeBand);
    GetWindowBand(overlay.Handle, out overlayBand);

    bool overlayVisible = IsWindowVisible(overlay.Handle);
    IntPtr fg = GetForegroundWindow();
    bool fgIsProbe = (fg == probe.Handle);

    string status = string.Format(
      "probeBand={0}, overlayBand={1}, overlayVisible={2}, fgIsProbe={3}",
      probeBand, overlayBand, overlayVisible, fgIsProbe);
    statusLabel.Text = status;
    Application.DoEvents();

    results.AppendLine("  \"probeBand\": " + probeBand + ",");
    results.AppendLine("  \"overlayBand\": " + overlayBand + ",");
    results.AppendLine("  \"overlayVisible\": " + overlayVisible.ToString().ToLower() + ",");
    results.AppendLine("  \"foregroundIsProbe\": " + fgIsProbe.ToString().ToLower() + ",");
    results.AppendLine("  \"probeHwnd\": \"0x" + probe.Handle.ToInt64().ToString("X") + "\",");
    results.AppendLine("  \"overlayHwnd\": \"0x" + overlay.Handle.ToInt64().ToString("X") + "\",");
    results.AppendLine("  \"status\": \"" + status.Replace("\"","\\\"") + "\"");
    results.AppendLine("}");

    if (resultPath != null) {
      File.WriteAllText(resultPath, results.ToString());
    }
    Console.WriteLine(status);

    // Keep alive for 5 seconds so user can visually verify
    System.Threading.Thread.Sleep(5000);

    overlay.Close();
    probe.Close();
  }
}
'@

# Write manifest
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

try {
  if (-not (Test-Path $exeDir)) { New-Item -ItemType Directory -Path $exeDir -Force | Out-Null }

  $srcPath = Join-Path $exeDir 'UIAccessOverlay.cs'
  $manifestPath = Join-Path $exeDir 'UIAccessOverlay.manifest'
  Set-Content -Path $srcPath -Value $csharpCode -Encoding UTF8
  Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

  # Find csc.exe
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

  $stdoutPath = Join-Path $exeDir 'compile_stdout.txt'
  $stderrPath = Join-Path $exeDir 'compile_stderr.txt'
  $proc = Start-Process -FilePath $csc -ArgumentList $compileArgs -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

  if ($proc.ExitCode -eq 0 -and (Test-Path $exePath)) {
    Log-Step 'compile' 'OK' ('Built: ' + $exePath)
  } else {
    $errText = Get-Content (Join-Path $exeDir 'compile_stderr.txt') -Raw -ErrorAction SilentlyContinue
    Log-Step 'compile' 'FAIL' ('Exit=' + $proc.ExitCode + ' ' + $errText)
    $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
    exit 1
  }
} catch {
  Log-Step 'compile' 'FAIL' $_.Exception.Message
  $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
  exit 1
}

# --- Step 4: Sign the EXE ---
Write-Host '[4/6] Signing EXE with self-signed cert...' -ForegroundColor Yellow

try {
  Set-AuthenticodeSignature -FilePath $exePath -Certificate $cert -TimestampServer '' | Out-Null
  $sig = Get-AuthenticodeSignature -FilePath $exePath
  Log-Step 'sign' 'OK' ('Status: ' + $sig.Status)
} catch {
  Log-Step 'sign' 'FAIL' $_.Exception.Message
  $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
  exit 1
}

# --- Step 5: Run the UIAccess overlay ---
Write-Host '[5/6] Running UIAccess overlay (5 second visual test)...' -ForegroundColor Yellow

$uiaResultPath = Join-Path $exeDir 'uiaccess_result.json'
if (Test-Path $uiaResultPath) { Remove-Item $uiaResultPath -Force }
try {
  # UIAccess apps MUST be launched via ShellExecute (not CreateProcess)
  # so that Windows grants the UIAccess token. -NoNewWindow uses CreateProcess.
  $proc = Start-Process -FilePath $exePath -ArgumentList ('"' + $uiaResultPath + '"') -Wait -PassThru
  if (Test-Path $uiaResultPath) {
    $uiaResult = Get-Content $uiaResultPath -Raw | ConvertFrom-Json
    $results.uiaccess_result = $uiaResult
    Log-Step 'run' 'OK' ('overlayBand=' + $uiaResult.overlayBand + ', visible=' + $uiaResult.overlayVisible)
  } else {
    Log-Step 'run' 'WARN' ('Exit=' + $proc.ExitCode + ', no result file')
  }
} catch {
  Log-Step 'run' 'FAIL' $_.Exception.Message
}

# --- Step 6: Also run WITHOUT uiAccess as control ---
Write-Host '[6/6] Control: running same EXE from non-secure path...' -ForegroundColor Yellow

$controlDir = Join-Path $env:TEMP 'DmNotePoC_control'
if (-not (Test-Path $controlDir)) { New-Item -ItemType Directory -Path $controlDir -Force | Out-Null }
$controlExe = Join-Path $controlDir 'UIAccessOverlay.exe'
Copy-Item $exePath $controlExe -Force

$controlResultPath = Join-Path $controlDir 'control_result.json'
if (Test-Path $controlResultPath) { Remove-Item $controlResultPath -Force }
try {
  $proc2 = Start-Process -FilePath $controlExe -ArgumentList ('"' + $controlResultPath + '"') -Wait -PassThru
  if (Test-Path $controlResultPath) {
    $controlResult = Get-Content $controlResultPath -Raw | ConvertFrom-Json
    $results.control_result = $controlResult
    Log-Step 'control' 'OK' ('overlayBand=' + $controlResult.overlayBand + ', visible=' + $controlResult.overlayVisible)
  } else {
    Log-Step 'control' 'WARN' ('Exit=' + $proc2.ExitCode + ', no result file (UIAccess from non-secure path may be blocked)')
  }
} catch {
  Log-Step 'control' 'INFO' ('Expected: UIAccess from TEMP path may fail: ' + $_.Exception.Message)
}

# --- Save ---
$outputDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
$results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
Write-Host ''
Write-Host ('Saved: ' + $OutputPath) -ForegroundColor Green

# --- Summary ---
Write-Host ''
Write-Host '=== SUMMARY ===' -ForegroundColor Cyan
foreach ($s in $results.steps) {
  $c = if ($s.status -eq 'OK') { 'Green' } elseif ($s.status -eq 'FAIL') { 'Red' } else { 'Yellow' }
  Write-Host ('  ' + $s.step + ': ' + $s.status) -ForegroundColor $c
}

if ($results.uiaccess_result) {
  $ub = $results.uiaccess_result.overlayBand
  if ($ub -gt 1) {
    Write-Host ''
    Write-Host ('*** UIAccess overlay got band=' + $ub + '! This is the breakthrough! ***') -ForegroundColor Green
  } else {
    Write-Host ''
    Write-Host ('*** UIAccess overlay band=' + $ub + ' (same as normal). Checking if still stays on top... ***') -ForegroundColor Yellow
  }
}
