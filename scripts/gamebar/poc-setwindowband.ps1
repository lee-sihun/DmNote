# PoC: SetWindowBand - band sweep experiment
# Usage: powershell -ExecutionPolicy Bypass -File poc-setwindowband.ps1

param(
  [string]$OutputPath = "$PSScriptRoot/../../docs/artifacts/poc-setwindowband-results.json"
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$typeName = 'BandPocNative'
if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BandPocNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowBand(IntPtr hWnd, IntPtr hwndInsertAfter, uint dwBand);

  [DllImport("kernel32.dll")] public static extern uint GetLastError();
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
Write-Host '=== SetWindowBand PoC ===' -ForegroundColor Cyan
Write-Host ('Admin: ' + $results.isAdmin)
Write-Host ''

# --- fullscreen probe ---
Write-Host '[1/4] Creating fullscreen probe window...' -ForegroundColor Yellow
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

$probeForm = New-Object System.Windows.Forms.Form
$probeForm.Text = 'Fullscreen Probe (band=1)'
$probeForm.StartPosition = 'Manual'
$probeForm.FormBorderStyle = 'None'
$probeForm.BackColor = [System.Drawing.Color]::DarkBlue
$probeForm.ForeColor = [System.Drawing.Color]::White
$probeForm.TopMost = $true
$probeForm.ShowInTaskbar = $true
$probeForm.Location = [System.Drawing.Point]::new($screen.Left, $screen.Top)
$probeForm.Size = [System.Drawing.Size]::new($screen.Width, $screen.Height)

$probeLabel = New-Object System.Windows.Forms.Label
$probeLabel.AutoSize = $true
$probeLabel.ForeColor = [System.Drawing.Color]::White
$probeLabel.Font = New-Object System.Drawing.Font('Segoe UI', 24, [System.Drawing.FontStyle]::Bold)
$probeLabel.Text = 'FULLSCREEN PROBE (band=1) - overlay should appear above this'
$probeLabel.Location = [System.Drawing.Point]::new(40, 40)
$probeForm.Controls.Add($probeLabel)

# --- overlay ---
Write-Host '[2/4] Creating overlay window...' -ForegroundColor Yellow

$overlayForm = New-Object System.Windows.Forms.Form
$overlayForm.Text = 'Band Overlay PoC'
$overlayForm.StartPosition = 'Manual'
$overlayForm.FormBorderStyle = 'None'
$overlayForm.BackColor = [System.Drawing.Color]::Lime
$overlayForm.ForeColor = [System.Drawing.Color]::Black
$overlayForm.TopMost = $true
$overlayForm.ShowInTaskbar = $false
$overlayForm.Location = [System.Drawing.Point]::new($screen.Left + 100, $screen.Top + 100)
$overlayForm.Size = [System.Drawing.Size]::new(500, 200)
$overlayForm.Opacity = 0.85

$overlayLabel = New-Object System.Windows.Forms.Label
$overlayLabel.AutoSize = $true
$overlayLabel.ForeColor = [System.Drawing.Color]::Black
$overlayLabel.Font = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$overlayLabel.Text = 'OVERLAY - band sweep...'
$overlayLabel.Location = [System.Drawing.Point]::new(20, 20)
$overlayForm.Controls.Add($overlayLabel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.AutoSize = $true
$statusLabel.ForeColor = [System.Drawing.Color]::DarkRed
$statusLabel.Font = New-Object System.Drawing.Font('Consolas', 12)
$statusLabel.Text = ''
$statusLabel.Location = [System.Drawing.Point]::new(20, 70)
$overlayForm.Controls.Add($statusLabel)

# --- show probe first, then overlay on top ---
$probeForm.Show()
$probeForm.Activate()
[void][BandPocNative]::SetForegroundWindow($probeForm.Handle)
[void][BandPocNative]::SetWindowPos($probeForm.Handle, [IntPtr]::new(-1), $screen.Left, $screen.Top, $screen.Width, $screen.Height, 0x0040)
Start-Sleep -Milliseconds 500

$overlayForm.Show()
$overlayForm.BringToFront()

# --- band sweep ---
Write-Host '[3/4] Starting band sweep...' -ForegroundColor Yellow

$probeHwnd = $probeForm.Handle
$overlayHwnd = $overlayForm.Handle

[uint32]$probeBand = 0
[uint32]$overlayBand = 0
[void][BandPocNative]::GetWindowBand($probeHwnd, [ref]$probeBand)
[void][BandPocNative]::GetWindowBand($overlayHwnd, [ref]$overlayBand)

Write-Host ('  probe band (baseline): ' + $probeBand)
Write-Host ('  overlay band (baseline): ' + $overlayBand)

$results.probe_hwnd = ('0x{0:X}' -f $probeHwnd.ToInt64())
$results.overlay_hwnd = ('0x{0:X}' -f $overlayHwnd.ToInt64())
$results.probe_band_baseline = $probeBand
$results.overlay_band_baseline = $overlayBand

foreach ($band in 2..18) {
  Write-Host ''
  Write-Host ('  --- band ' + $band + ' ---') -ForegroundColor Magenta

  $overlayLabel.Text = ('OVERLAY - band=' + $band)
  $statusLabel.Text = ''
  [System.Windows.Forms.Application]::DoEvents()

  $success = [BandPocNative]::SetWindowBand($overlayHwnd, [IntPtr]::Zero, [uint32]$band)
  $lastError = [BandPocNative]::GetLastError()
  $errHex = ('0x{0:X8}' -f $lastError)

  [uint32]$actualBand = 0
  [void][BandPocNative]::GetWindowBand($overlayHwnd, [ref]$actualBand)

  # push probe to foreground to test if overlay stays on top
  [void][BandPocNative]::SetForegroundWindow($probeHwnd)
  $probeForm.Activate()
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.Application]::DoEvents()

  $overlayVisible = [BandPocNative]::IsWindowVisible($overlayHwnd)
  $foregroundHwnd = [BandPocNative]::GetForegroundWindow()
  $foregroundIsProbe = ($foregroundHwnd -eq $probeHwnd)
  $bandChanged = ($actualBand -ne $overlayBand)

  $entry = @{
    band             = $band
    setWindowBand_ok = $success
    lastError        = $lastError
    lastErrorHex     = $errHex
    actualBand       = $actualBand
    bandChanged      = $bandChanged
    overlayVisible   = $overlayVisible
    foregroundIsProbe = $foregroundIsProbe
  }

  [void]$results.experiments.Add($entry)

  $statusLabel.Text = ('ok=' + $success + ' err=' + $errHex + ' actual=' + $actualBand + ' changed=' + $bandChanged)
  [System.Windows.Forms.Application]::DoEvents()

  if ($success) {
    Write-Host ('    SetWindowBand = OK') -ForegroundColor Green
  } else {
    Write-Host ('    SetWindowBand = FAIL (' + $errHex + ')') -ForegroundColor Red
  }
  Write-Host ('    actual band = ' + $actualBand + ', changed = ' + $bandChanged)
  Write-Host ('    overlay visible = ' + $overlayVisible + ', foreground is probe = ' + $foregroundIsProbe)

  # reset band
  [void][BandPocNative]::SetWindowBand($overlayHwnd, [IntPtr]::Zero, [uint32]1)
  Start-Sleep -Milliseconds 200
}

# --- save results ---
Write-Host ''
Write-Host '[4/4] Saving results...' -ForegroundColor Yellow

$outputDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
$results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $OutputPath
Write-Host ('Saved: ' + $OutputPath)

# --- summary ---
$successBands = @($results.experiments | Where-Object { $_.setWindowBand_ok -and $_.bandChanged })
$failBands = @($results.experiments | Where-Object { -not $_.setWindowBand_ok })

Write-Host ''
Write-Host '=== SUMMARY ===' -ForegroundColor Cyan
Write-Host ('Band changed: ' + $successBands.Count + ' - bands: ' + ($successBands.band -join ', '))
Write-Host ('Failed: ' + $failBands.Count + ' - bands: ' + ($failBands.band -join ', '))

if ($successBands.Count -gt 0) {
  Write-Host ''
  Write-Host '*** Band promotion SUCCESS! Next: verify fullscreen visibility ***' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host '*** All bands failed. Moving to CreateWindowInBand experiment ***' -ForegroundColor Yellow
}

$overlayForm.Close()
$probeForm.Close()
