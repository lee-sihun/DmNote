param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts'
)

$ErrorActionPreference = 'Stop'

function Invoke-Capture {
  param(
    [string]$ScriptPath,
    [string]$OutputPath
  )

  powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath -OutputPath $OutputPath | Out-Null
}

function Get-RootSummary {
  param(
    [string]$Path
  )

  $json = Get-Content -Path $Path -Raw | ConvertFrom-Json
  $roots = @($json.roots)

  return [pscustomobject]@{
    path = $Path
    root_count = $roots.Count
    visible_root_count = @($roots | Where-Object { $_.is_visible }).Count
    visible_roots = @(
      $roots |
        Where-Object { $_.is_visible } |
        Select-Object process_name, pid, class_name, title, hwnd
    )
  }
}

function Invoke-BrokerMethodSet {
  param(
    [string[]]$Methods,
    [string]$OutputPath
  )

  & (Join-Path $PSScriptRoot 'probe-gamebar-broker-win32.ps1') -Methods $Methods -TerminateGameBar:$false -OutputPath $OutputPath | Out-Null
}

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$uiaCapture = Join-Path $PSScriptRoot 'capture-gamebar-uia-tree.ps1'
$runDir = Join-Path $ArtifactsDir "gamebar-broker-visibility-$timestamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$beforePath = Join-Path $runDir 'uia-before.json'
$afterHidePath = Join-Path $runDir 'uia-after-hide.json'
$afterShowPath = Join-Path $runDir 'uia-after-show.json'
$hideProbePath = Join-Path $runDir 'broker-hide.json'
$showProbePath = Join-Path $runDir 'broker-show.json'
$summaryPath = Join-Path $runDir 'summary.json'

Start-Process 'ms-gamebar:' | Out-Null
Start-Sleep -Seconds 3

Invoke-Capture -ScriptPath $uiaCapture -OutputPath $beforePath
Invoke-BrokerMethodSet -Methods @('hide') -OutputPath $hideProbePath
Start-Sleep -Seconds 2
Invoke-Capture -ScriptPath $uiaCapture -OutputPath $afterHidePath
Invoke-BrokerMethodSet -Methods @('show') -OutputPath $showProbePath
Start-Sleep -Seconds 2
Invoke-Capture -ScriptPath $uiaCapture -OutputPath $afterShowPath

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  run_dir = $runDir
  before = Get-RootSummary -Path $beforePath
  after_hide = Get-RootSummary -Path $afterHidePath
  after_show = Get-RootSummary -Path $afterShowPath
  hide_probe = (Get-Content -Path $hideProbePath -Raw | ConvertFrom-Json)
  show_probe = (Get-Content -Path $showProbePath -Raw | ConvertFrom-Json)
}

$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $summaryPath -Encoding UTF8
$summaryPath
