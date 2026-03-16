# Control test: plain TOPMOST overlay (NO UIAccess, band=1)
# Compare with poc-uiaccess-gametest.ps1 to see if band=2 actually matters
# Usage: powershell -ExecutionPolicy Bypass -File poc-topmost-control-gametest.ps1

param(
  [int]$DurationSeconds = 60
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$typeName = 'ControlTestNative'
if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ControlTestNative {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);
  [DllImport("user32.dll")]
  public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")]
  public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
}
'@
}

Write-Host ''
Write-Host '=== Control Test: Plain TOPMOST (NO UIAccess, band=1) ===' -ForegroundColor Cyan
Write-Host ''

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

$overlay = New-Object System.Windows.Forms.Form
$overlay.Text = 'TOPMOST Control'
$overlay.FormBorderStyle = 'None'
$overlay.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$overlay.TopMost = $true
$overlay.ShowInTaskbar = $false
$overlay.StartPosition = 'Manual'
$overlay.Location = [System.Drawing.Point]::new($screen.Right - 420, $screen.Top + 20)
$overlay.Size = [System.Drawing.Size]::new(400, 140)
$overlay.Opacity = 0.85

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [System.Drawing.Color]::Orange
$titleLabel.AutoSize = $true
$titleLabel.Location = [System.Drawing.Point]::new(15, 10)
$titleLabel.Text = 'TOPMOST Control (band=?)'
$overlay.Controls.Add($titleLabel)

$infoLabel = New-Object System.Windows.Forms.Label
$infoLabel.Font = New-Object System.Drawing.Font('Consolas', 10)
$infoLabel.ForeColor = [System.Drawing.Color]::White
$infoLabel.AutoSize = $true
$infoLabel.Location = [System.Drawing.Point]::new(15, 45)
$overlay.Controls.Add($infoLabel)

$countdownLabel = New-Object System.Windows.Forms.Label
$countdownLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$countdownLabel.ForeColor = [System.Drawing.Color]::Gray
$countdownLabel.AutoSize = $true
$countdownLabel.Location = [System.Drawing.Point]::new(15, 105)
$overlay.Controls.Add($countdownLabel)

$overlay.Show()

# Click-through
$GWL_EXSTYLE = -20
$WS_EX_TRANSPARENT = 0x20
$exStyle = [ControlTestNative]::GetWindowLong($overlay.Handle, $GWL_EXSTYLE)
[void][ControlTestNative]::SetWindowLong($overlay.Handle, $GWL_EXSTYLE, $exStyle -bor $WS_EX_TRANSPARENT)

# Force topmost
$HWND_TOPMOST = [IntPtr]::new(-1)
[void][ControlTestNative]::SetWindowPos($overlay.Handle, $HWND_TOPMOST, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040)

# Check band
[uint32]$band = 0
[void][ControlTestNative]::GetWindowBand($overlay.Handle, [ref]$band)

$titleLabel.Text = 'TOPMOST Control (band=' + $band + ')'
if ($band -ge 2) {
  $titleLabel.ForeColor = [System.Drawing.Color]::Lime
} else {
  $titleLabel.ForeColor = [System.Drawing.Color]::Orange
}

$hwndHex = '0x{0:X}' -f $overlay.Handle.ToInt64()
$infoLabel.Text = "hwnd=$hwndHex  band=$band`nNO UIAccess - plain TOPMOST only`nSwitch to a fullscreen game now!"

Write-Host ('Overlay hwnd=' + $hwndHex + ', band=' + $band) -ForegroundColor Yellow
Write-Host ('Running for ' + $DurationSeconds + ' seconds...') -ForegroundColor Cyan
Write-Host 'Switch to a fullscreen game. Does this overlay appear above it?' -ForegroundColor Yellow
Write-Host ''

# Countdown
$endTime = (Get-Date).AddSeconds($DurationSeconds)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
  $remaining = [int]($endTime - (Get-Date)).TotalSeconds
  if ($remaining -le 0) {
    $timer.Stop()
    $overlay.Close()
    return
  }
  $countdownLabel.Text = 'Closing in ' + $remaining + 's'
  [void][ControlTestNative]::SetWindowPos($overlay.Handle, $HWND_TOPMOST, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040)
  [System.Windows.Forms.Application]::DoEvents()
})
$timer.Start()

[System.Windows.Forms.Application]::Run($overlay)

Write-Host ''
Write-Host 'Done. Compare result with UIAccess test (band=2).' -ForegroundColor Cyan
