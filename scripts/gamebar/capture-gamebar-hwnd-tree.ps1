param(
  [string]$OutputPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-hwnd-tree.json',
  [int]$MaxDepth = 5,
  [switch]$LaunchGameBar
)

$ErrorActionPreference = 'Stop'

$typeName = 'GameBarHwndTreeNative'
if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
  $typeDef = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class GameBarHwndTreeNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
}
'@
  Add-Type -TypeDefinition $typeDef
}

function Get-CloakedValue {
  param(
    [IntPtr]$Hwnd
  )

  $DWMWA_CLOAKED = 14
  $value = 0
  $hr = [GameBarHwndTreeNative]::DwmGetWindowAttribute($Hwnd, $DWMWA_CLOAKED, [ref]$value, 4)
  if ($hr -eq 0) {
    return $value
  }

  return $null
}

function Get-RectValue {
  param(
    [IntPtr]$Hwnd
  )

  $rect = New-Object GameBarHwndTreeNative+RECT
  if ([GameBarHwndTreeNative]::GetWindowRect($Hwnd, [ref]$rect)) {
    return [pscustomobject]@{
      left = $rect.Left
      top = $rect.Top
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
    }
  }

  return $null
}

function Get-WindowInfo {
  param(
    [IntPtr]$Hwnd,
    [int]$Depth
  )

  [uint32]$procId = 0
  [void][GameBarHwndTreeNative]::GetWindowThreadProcessId($Hwnd, [ref]$procId)

  $classSb = New-Object System.Text.StringBuilder 512
  $textSb = New-Object System.Text.StringBuilder 512
  [void][GameBarHwndTreeNative]::GetClassName($Hwnd, $classSb, $classSb.Capacity)
  [void][GameBarHwndTreeNative]::GetWindowText($Hwnd, $textSb, $textSb.Capacity)

  [uint32]$band = 0
  $bandOk = [GameBarHwndTreeNative]::GetWindowBand($Hwnd, [ref]$band)

  return [ordered]@{
    hwnd = ('0x{0:X}' -f $Hwnd.ToInt64())
    depth = $Depth
    pid = [int]$procId
    class_name = $classSb.ToString()
    title = $textSb.ToString()
    is_visible = [GameBarHwndTreeNative]::IsWindowVisible($Hwnd)
    cloaked = Get-CloakedValue -Hwnd $Hwnd
    band = if ($bandOk) { [int]$band } else { $null }
    style = ('0x{0:X}' -f [GameBarHwndTreeNative]::GetWindowLongPtr($Hwnd, -16).ToInt64())
    ex_style = ('0x{0:X}' -f [GameBarHwndTreeNative]::GetWindowLongPtr($Hwnd, -20).ToInt64())
    rect = Get-RectValue -Hwnd $Hwnd
    children = @()
  }
}

function Convert-HwndTree {
  param(
    [IntPtr]$Hwnd,
    [int]$Depth,
    [int]$MaxDepth
  )

  $node = Get-WindowInfo -Hwnd $Hwnd -Depth $Depth

  if ($Depth -ge $MaxDepth) {
    return [pscustomobject]$node
  }

  $children = New-Object System.Collections.Generic.List[object]
  $callback = [GameBarHwndTreeNative+EnumWindowsProc]{
    param($childHwnd, $lParam)
    $children.Add($childHwnd.ToInt64()) | Out-Null
    return $true
  }

  [GameBarHwndTreeNative]::EnumChildWindows($Hwnd, $callback, [IntPtr]::Zero) | Out-Null

  foreach ($childValue in $children | Select-Object -Unique) {
    $node.children += Convert-HwndTree -Hwnd ([IntPtr]::new($childValue)) -Depth ($Depth + 1) -MaxDepth $MaxDepth
  }

  return [pscustomobject]$node
}

$parent = Split-Path $OutputPath -Parent
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 3
}

$processMap = @{}
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $processMap[$_.Id] = $_.ProcessName
}

$roots = New-Object System.Collections.Generic.List[object]
$callback = [GameBarHwndTreeNative+EnumWindowsProc]{
  param($hWnd, $lParam)
  $info = Get-WindowInfo -Hwnd $hWnd -Depth 0
  $processName = $processMap[[int]$info.pid]

  if (
    $processName -match 'GameBar|Xbox|Widget|ApplicationFrameHost|explorer|TextInputHost' -or
    $info.class_name -match 'ApplicationFrameWindow|WindowsDashboard|Xaml|DesktopWindowXamlSource'
  ) {
    $info.process_name = $processName
    $roots.Add($info) | Out-Null
  }

  return $true
}

[GameBarHwndTreeNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

$selectedRoots = @(
  $roots |
    Sort-Object `
      @{ Expression = { if ($_.process_name -match 'GameBar|Xbox|Widget') { 100 } elseif ($_.process_name -match 'ApplicationFrameHost') { 80 } elseif ($_.class_name -match 'WindowsDashboard|ApplicationFrameWindow|Xaml') { 70 } else { 10 } }; Descending = $true }, `
      @{ Expression = 'is_visible'; Descending = $true } |
    Select-Object -First 24
)

$trees = foreach ($root in $selectedRoots) {
  $tree = Convert-HwndTree -Hwnd ([IntPtr]::new([Convert]::ToInt64($root.hwnd.Substring(2), 16))) -Depth 0 -MaxDepth $MaxDepth
  $tree |
    Add-Member -NotePropertyName process_name -NotePropertyValue $root.process_name -PassThru
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  launch_gamebar = [bool]$LaunchGameBar
  max_depth = $MaxDepth
  root_count = $trees.Count
  trees = @($trees)
}

$json = $summary | ConvertTo-Json -Depth 12
Set-Content -Path $OutputPath -Value $json -Encoding UTF8
$json
