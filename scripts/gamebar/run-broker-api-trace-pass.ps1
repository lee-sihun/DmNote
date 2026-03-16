param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [string[]]$Methods = @(
    'hide',
    'show',
    'reset_window_rect',
    'set_click_through_true',
    'set_click_through_false'
  ),
  [int]$DurationSeconds = 6,
  [int]$AttachLeadSeconds = 2,
  [int]$WaitSeconds = 5,
  [int]$MaxSamples = 4
)

$ErrorActionPreference = 'Stop'

$processGroups = @(
  @('GameBar.exe', 'explorer.exe', 'ShellHost.exe', 'ApplicationFrameHost.exe'),
  @('StartMenuExperienceHost.exe', 'Widgets.exe', 'WidgetService.exe', 'TextInputHost.exe')
)

function Invoke-TraceRun {
  param(
    [string]$OutputPath,
    [string]$ErrorPath,
    [string[]]$ProcessNames,
    [string]$Method
  )

  $argList = @(
    'scripts/gamebar/trace_gamebar_frida.py',
    '--output',
    $OutputPath,
    '--duration',
    $DurationSeconds,
    '--wait-seconds',
    $WaitSeconds,
    '--max-samples',
    $MaxSamples
  )

  foreach ($processName in $ProcessNames) {
    $argList += '--process-name'
    $argList += $processName
  }

  $python = Start-Process python `
    -ArgumentList $argList `
    -WorkingDirectory (Get-Location).Path `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardError $ErrorPath

  try {
    Start-Sleep -Seconds $AttachLeadSeconds
    & (Join-Path $PSScriptRoot 'probe-gamebar-broker-win32.ps1') `
      -Methods @($Method) `
      -TerminateGameBar:$false | Out-Null
    $python.WaitForExit()
  }
  finally {
    if (-not $python.HasExited) {
      Stop-Process -Id $python.Id -Force -ErrorAction SilentlyContinue
    }
  }

  return $python.ExitCode
}

function Get-TraceHighlights {
  param(
    [string]$JsonPath
  )

  $json = Get-Content -Path $JsonPath -Raw | ConvertFrom-Json
  $interesting = @()

  foreach ($proc in @($json.processes)) {
    $callProps = @($proc.call_counts.PSObject.Properties)
    $calls = [ordered]@{}
    foreach ($prop in $callProps) {
      if ($null -ne $prop.Value -and [int]$prop.Value -gt 0) {
        $calls[$prop.Name] = [int]$prop.Value
      }
    }

    $attachFailures = @(
      @($proc.messages) |
        Where-Object { $_.type -eq 'attach_failed' } |
        ForEach-Object {
          [pscustomobject]@{
            pid = $_.pid
            process_name = $_.process_name
            error = $_.error
          }
        }
    )

    if ($calls.Count -gt 0 -or $attachFailures.Count -gt 0) {
      $interesting += [pscustomobject]@{
        pid = $proc.pid
        name = $proc.name
        call_counts = $calls
        attach_failures = $attachFailures
      }
    }
  }

  return [pscustomobject]@{
    targets_found = @($json.targets_found)
    interesting_processes = $interesting
  }
}

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $ArtifactsDir "gamebar-broker-api-trace-$timestamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

Start-Process 'ms-gamebar:' | Out-Null
Start-Sleep -Seconds 3

$runs = @()

for ($groupIndex = 0; $groupIndex -lt $processGroups.Count; $groupIndex++) {
  $processNames = $processGroups[$groupIndex]

  foreach ($method in $Methods) {
    $baseName = "group$($groupIndex + 1)-$method"
    $jsonPath = Join-Path $runDir "$baseName.json"
    $errPath = Join-Path $runDir "$baseName.stderr.txt"

    $exitCode = Invoke-TraceRun `
      -OutputPath $jsonPath `
      -ErrorPath $errPath `
      -ProcessNames $processNames `
      -Method $method

    $highlights = $null
    if (Test-Path $jsonPath) {
      $highlights = Get-TraceHighlights -JsonPath $jsonPath
    }

    $stderr = ''
    if (Test-Path $errPath) {
      $stderr = Get-Content -Path $errPath -Raw
    }

    $runs += [pscustomobject]@{
      group = $groupIndex + 1
      process_names = $processNames
      method = $method
      exit_code = $exitCode
      json_path = $jsonPath
      stderr_path = $errPath
      stderr_nonempty = -not [string]::IsNullOrWhiteSpace($stderr)
      highlights = $highlights
    }
  }
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  run_dir = $runDir
  methods = $Methods
  duration_seconds = $DurationSeconds
  wait_seconds = $WaitSeconds
  process_groups = $processGroups
  runs = $runs
}

$summaryPath = Join-Path $runDir 'summary.json'
$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding UTF8
$summaryPath
