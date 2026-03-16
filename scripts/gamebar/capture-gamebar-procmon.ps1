param(
  [string]$ProcmonPath = 'C:\Users\esihun\Downloads\SysinternalsSuite\Procmon64.exe',
  [string]$OutputPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-procmon-capture.pml',
  [int]$CaptureSeconds = 8,
  [int]$MaxFileSizeMB = 64,
  [switch]$LaunchGameBar
)

$ErrorActionPreference = 'Stop'

function Stop-ProcmonInstances {
  param(
    [string]$ProcmonPath
  )

  & $ProcmonPath /Terminate 2>$null | Out-Null
  Start-Sleep -Seconds 2

  $leftovers = Get-Process Procmon64 -ErrorAction SilentlyContinue
  if ($leftovers) {
    $leftovers | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

if (-not (Test-Path $ProcmonPath)) {
  throw "Procmon 실행 파일을 찾지 못했습니다: $ProcmonPath"
}

$parent = Split-Path $OutputPath -Parent
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

if (Test-Path $OutputPath) {
  Remove-Item $OutputPath -Force
}

Stop-ProcmonInstances -ProcmonPath $ProcmonPath

$proc = Start-Process $ProcmonPath -ArgumentList @(
  '/AcceptEula',
  '/Quiet',
  '/Minimized',
  '/BackingFile',
  $OutputPath
) -PassThru

Start-Sleep -Seconds 2

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
}

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$stoppedEarly = $false

while ($stopwatch.Elapsed.TotalSeconds -lt $CaptureSeconds) {
  Start-Sleep -Milliseconds 250

  if (Test-Path $OutputPath) {
    $lengthMb = [math]::Round(((Get-Item $OutputPath).Length / 1MB), 2)
    if ($lengthMb -ge $MaxFileSizeMB) {
      $stoppedEarly = $true
      break
    }
  }
}

$stopwatch.Stop()

Stop-ProcmonInstances -ProcmonPath $ProcmonPath

if (-not (Test-Path $OutputPath)) {
  throw "Procmon 캡처 파일이 생성되지 않았습니다: $OutputPath"
}

$item = Get-Item $OutputPath

[pscustomobject]@{
  FullName = $item.FullName
  Length = $item.Length
  LastWriteTime = $item.LastWriteTime
  StoppedEarly = $stoppedEarly
  ObservedCaptureSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
  MaxFileSizeMB = $MaxFileSizeMB
}
