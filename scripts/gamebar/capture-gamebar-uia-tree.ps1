param(
  [string]$OutputPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-uia-tree.json',
  [int]$MaxDepth = 4,
  [int]$MaxRoots = 12,
  [int]$MaxChildrenPerNode = 30,
  [switch]$LaunchGameBar
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes

$typeName = 'GameBarUiaNative'
if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
  $typeDef = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class GameBarUiaNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
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
  $hr = [GameBarUiaNative]::DwmGetWindowAttribute($Hwnd, $DWMWA_CLOAKED, [ref]$value, 4)
  if ($hr -eq 0) {
    return $value
  }

  return $null
}

function Get-TopLevelWindows {
  $rows = New-Object System.Collections.Generic.List[object]

  $callback = [GameBarUiaNative+EnumWindowsProc]{
    param($hWnd, $lParam)

    [uint32]$procId = 0
    [void][GameBarUiaNative]::GetWindowThreadProcessId($hWnd, [ref]$procId)

    $classSb = New-Object System.Text.StringBuilder 512
    $textSb = New-Object System.Text.StringBuilder 512
    [void][GameBarUiaNative]::GetClassName($hWnd, $classSb, $classSb.Capacity)
    [void][GameBarUiaNative]::GetWindowText($hWnd, $textSb, $textSb.Capacity)

    $rows.Add([pscustomobject]@{
      hwnd = ('0x{0:X}' -f $hWnd.ToInt64())
      hwnd_value = $hWnd.ToInt64()
      pid = [int]$procId
      class_name = $classSb.ToString()
      title = $textSb.ToString()
      is_visible = [GameBarUiaNative]::IsWindowVisible($hWnd)
      cloaked = Get-CloakedValue -Hwnd $hWnd
    }) | Out-Null

    return $true
  }

  [GameBarUiaNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $rows
}

function Get-CandidateScore {
  param(
    [object]$Window
  )

  $score = 0

  if ($Window.process_name -match 'GameBar|Xbox|Widget') { $score += 8 }
  if ($Window.process_name -match 'ApplicationFrameHost') { $score += 6 }
  if ($Window.class_name -match 'ApplicationFrameWindow|WindowsDashboard|DesktopWindowXamlSource') { $score += 5 }
  if ($Window.class_name -match 'Xaml|CoreWindow') { $score += 3 }
  if ($Window.title -match 'Game Bar|Xbox|Widget') { $score += 3 }
  if ($Window.is_visible) { $score += 2 }
  if ($Window.cloaked -eq 0) { $score += 1 }

  return $score
}

function Get-BoundingRect {
  param(
    [System.Windows.Automation.AutomationElement]$Element
  )

  try {
    $rect = $Element.Current.BoundingRectangle
    return [pscustomobject]@{
      left = [math]::Round($rect.Left, 2)
      top = [math]::Round($rect.Top, 2)
      width = [math]::Round($rect.Width, 2)
      height = [math]::Round($rect.Height, 2)
    }
  } catch {
    return $null
  }
}

function Convert-AutomationNode {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [int]$Depth,
    [int]$MaxDepth,
    [int]$MaxChildrenPerNode
  )

  if (-not $Element) {
    return $null
  }

  $node = [ordered]@{
    depth = $Depth
    name = $Element.Current.Name
    automation_id = $Element.Current.AutomationId
    class_name = $Element.Current.ClassName
    framework_id = $Element.Current.FrameworkId
    control_type = $Element.Current.ControlType.ProgrammaticName
    process_id = $Element.Current.ProcessId
    is_enabled = $Element.Current.IsEnabled
    is_offscreen = $Element.Current.IsOffscreen
    help_text = $Element.Current.HelpText
    access_key = $Element.Current.AccessKey
    bounding_rect = Get-BoundingRect -Element $Element
    children = @()
  }

  if ($Depth -ge $MaxDepth) {
    return [pscustomobject]$node
  }

  try {
    $children = $Element.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    $limit = [math]::Min($children.Count, $MaxChildrenPerNode)
    for ($i = 0; $i -lt $limit; $i++) {
      $child = $children.Item($i)
      $converted = Convert-AutomationNode -Element $child -Depth ($Depth + 1) -MaxDepth $MaxDepth -MaxChildrenPerNode $MaxChildrenPerNode
      if ($converted) {
        $node.children += $converted
      }
    }
  } catch {
    $node.children_error = $_.Exception.Message
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

$candidateWindows = @(
  Get-TopLevelWindows |
    ForEach-Object {
      $_ |
        Add-Member -NotePropertyName process_name -NotePropertyValue $processMap[$_.pid] -PassThru |
        Add-Member -NotePropertyName candidate_score -NotePropertyValue (Get-CandidateScore -Window $_) -PassThru
    } |
    Where-Object {
      $_.process_name -match 'GameBar|Xbox|Widget|ApplicationFrameHost|explorer|TextInputHost' -or
      $_.class_name -match 'ApplicationFrameWindow|WindowsDashboard|Xaml|DesktopWindowXamlSource'
    } |
    Sort-Object @{ Expression = 'candidate_score'; Descending = $true }, @{ Expression = 'is_visible'; Descending = $true }, @{ Expression = 'pid'; Descending = $false } |
    Select-Object -First $MaxRoots
)

$roots = foreach ($window in $candidateWindows) {
  try {
    $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($window.hwnd_value))
    if (-not $element) {
      continue
    }

    [pscustomobject]@{
      hwnd = $window.hwnd
      process_name = $window.process_name
      pid = $window.pid
      title = $window.title
      class_name = $window.class_name
      is_visible = $window.is_visible
      cloaked = $window.cloaked
      automation = Convert-AutomationNode -Element $element -Depth 0 -MaxDepth $MaxDepth -MaxChildrenPerNode $MaxChildrenPerNode
    }
  } catch {
    [pscustomobject]@{
      hwnd = $window.hwnd
      process_name = $window.process_name
      pid = $window.pid
      title = $window.title
      class_name = $window.class_name
      is_visible = $window.is_visible
      cloaked = $window.cloaked
      error = $_.Exception.Message
    }
  }
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  launch_gamebar = [bool]$LaunchGameBar
  max_depth = $MaxDepth
  max_roots = $MaxRoots
  max_children_per_node = $MaxChildrenPerNode
  root_count = $roots.Count
  roots = @($roots)
}

$json = $summary | ConvertTo-Json -Depth 12
Set-Content -Path $OutputPath -Value $json -Encoding UTF8
$json
