param(
  [int]$DurationSeconds = 4,
  [string]$Title = 'GameBar Fullscreen Probe'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$typeName = 'GameBarProbeNative'
if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
  $typeDef = @'
using System;
using System.Runtime.InteropServices;

public static class GameBarProbeNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
  Add-Type -TypeDefinition $typeDef
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.BackColor = [System.Drawing.Color]::Black
$form.ForeColor = [System.Drawing.Color]::White
$form.TopMost = $true
$form.ShowInTaskbar = $true
$form.Location = [System.Drawing.Point]::new($screen.Left, $screen.Top)
$form.Size = [System.Drawing.Size]::new($screen.Width, $screen.Height)
$form.WindowState = [System.Windows.Forms.FormWindowState]::Maximized

$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $true
$label.BackColor = [System.Drawing.Color]::Transparent
$label.ForeColor = [System.Drawing.Color]::White
$label.Font = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Bold)
$label.Text = $Title
$label.Location = [System.Drawing.Point]::new(40, 32)
$form.Controls.Add($label)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(1000, $DurationSeconds * 1000)
$timer.Add_Tick({
  $timer.Stop()
  $form.Close()
})

$focusAttempts = 0
$focusTimer = New-Object System.Windows.Forms.Timer
$focusTimer.Interval = 150
$focusTimer.Add_Tick({
  $focusAttempts += 1
  $hwnd = $form.Handle
  [void][GameBarProbeNative]::ShowWindow($hwnd, 5)
  [void][GameBarProbeNative]::SetWindowPos($hwnd, [IntPtr]::new(-1), $screen.Left, $screen.Top, $screen.Width, $screen.Height, 0x0040)
  [void][GameBarProbeNative]::BringWindowToTop($hwnd)
  [void][GameBarProbeNative]::SetForegroundWindow($hwnd)
  $form.Activate()
  $form.Focus()
  if ($focusAttempts -ge 12) {
    $focusTimer.Stop()
  }
})

$form.Add_Shown({
  $timer.Start()
  $focusTimer.Start()
  $form.Activate()
  $form.Focus()
})

[void]$form.ShowDialog()
